import { existsSync, lstatSync, realpathSync, readFileSync, writeFileSync, readdirSync, copyFileSync, renameSync, unlinkSync } from 'node:fs';
import { join, basename, isAbsolute, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readIndex, writeIndex, safeFile } from './library.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function safeVocalFile(root, name) {
  if (!name || name !== basename(name) || isAbsolute(name) || !/\.(wav|flac)$/i.test(name)) throw new Error('人声轨文件名不安全');
  const file = join(root, name);
  const s = lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink() || s.size <= 44 || s.size > 200_000_000) throw new Error('人声轨不存在或体积不合适');
  const rel = relative(realpathSync(root), realpathSync(file));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('人声轨不在歌曲库内');
  return file;
}
// The send hook runs before Aurabot deletes the work directory. Only copy a stem
// when its sibling final MP3 has exactly the hash of the produced/sent recording.
export function captureVocalStem(root, mixedSha, workRoot) {
  const entries = readIndex(root), entry = entries.find(e => e.sha256 === mixedSha && (e.arrangement || 'mixed') === 'mixed');
  if (!entry || !existsSync(workRoot)) return false;
  if (entry.vocalFile) { safeVocalFile(root, entry.vocalFile); return true; }
  const candidates = readdirSync(workRoot, { withFileTypes: true }).filter(d => d.isDirectory() && !d.isSymbolicLink() && d.name !== 'cache')
    .map(d => join(workRoot, d.name)).sort((a, b) => lstatSync(b).mtimeMs - lstatSync(a).mtimeMs).slice(0, 80);
  const realWork = realpathSync(workRoot);
  for (const dir of candidates) {
    const contained = relative(realWork, realpathSync(dir));
    if (!contained || contained.startsWith('..') || isAbsolute(contained)) continue;
    const vocal = join(dir, 'vocals_rvc.wav');
    if (!existsSync(vocal) || lstatSync(vocal).isSymbolicLink() || !lstatSync(vocal).isFile()) continue;
    const size = lstatSync(vocal).size;
    if (size <= 44 || size > 200_000_000 || relative(realpathSync(dir), realpathSync(vocal)) !== 'vocals_rvc.wav') continue;
    let matchingOutput = false;
    for (const name of ['voice.mp3', 'cover.mp3']) {
      const out = join(dir, name);
      if (existsSync(out) && lstatSync(out).isFile() && !lstatSync(out).isSymbolicLink() && lstatSync(out).size <= 20_000_000 && hash(readFileSync(out)) === mixedSha) matchingOutput = true;
    }
    if (!matchingOutput) continue;
    const vocalSha = hash(readFileSync(vocal));
    const name = `人声-${mixedSha.slice(0, 16)}-${vocalSha.slice(0, 12)}.wav`;
    const dest = join(root, name);
    if (!existsSync(dest)) copyFileSync(vocal, dest, 1); // COPYFILE_EXCL
    if (hash(readFileSync(safeVocalFile(root, name))) !== vocalSha) throw new Error('保留人声轨的校验失败');
    const fresh = readIndex(root), update = fresh.find(e => e.sha256 === mixedSha);
    if (!update) return false;
    update.vocalFile = name; update.vocalSha256 = vocalSha;
    writeIndex(root, fresh);
    return true;
  }
  return false;
}
function ffmpegRun(exe, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let error = '', timeout = false;
    const timer = setTimeout(() => { timeout = true; p.kill(); }, 180_000);
    p.stderr.on('data', bytes => { error = (error + bytes.toString()).slice(-1500); });
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => { clearTimeout(timer); if (code === 0 && !timeout) resolve(); else reject(new Error(timeout ? '清唱导出超时' : '清唱导出失败：' + error)); });
  });
}
const renders = new Map();
export async function ensureAcappella(root, source, ffmpeg) {
  const key = root + '\0' + source.sha256;
  if (renders.has(key)) return renders.get(key);
  const pending = render(root, source, ffmpeg).finally(() => renders.delete(key));
  renders.set(key, pending);
  return pending;
}
async function render(root, source, ffmpeg) {
  if (!isAbsolute(ffmpeg) || !existsSync(ffmpeg)) throw new Error('未找到本机 FFmpeg');
  if (!/^[a-f0-9]{64}$/i.test(source.sha256 || '')) throw new Error('缺少原成品哈希，不能确认对应人声');
  const existing = readIndex(root).find(e => e.arrangement === 'acappella' && e.sourceSha256 === source.sha256);
  if (existing) return { kind: 'match', entry: existing, file: safeFile(root, existing.file) };
  const input = safeVocalFile(root, source.vocalFile);
  const vocalSha = hash(readFileSync(input));
  if (!source.vocalSha256 || vocalSha !== source.vocalSha256) throw new Error('人声轨校验失败；没有使用带伴奏成品代替');
  const output = join(root, '.acappella-' + randomUUID() + '.mp3');
  try {
    // One input only: the already converted RVC vocal, never the mixed song.
    await ffmpegRun(ffmpeg, ['-n', '-hide_banner', '-loglevel', 'error', '-i', input, '-vn', '-af', 'loudnorm=I=-18:TP=-1.5:LRA=11', '-ac', '2', '-ar', '44100', '-b:a', '192k', output]);
    const bytes = readFileSync(output);
    if (bytes.length < 1024 || bytes.length > 20_000_000) throw new Error('清唱输出体积异常');
    const sha = hash(bytes);
    const name = `清唱-${source.sha256.slice(0, 12)}-${sha.slice(0, 12)}.mp3`;
    const final = join(root, name);
    if (!existsSync(final)) renameSync(output, final);
    if (hash(readFileSync(safeFile(root, name))) !== sha) throw new Error('清唱成品校验失败');
    const entry = { ...source, arrangement: 'acappella', version: `${source.version || source.artist || '已制作'}·清唱无伴奏`, file: name, sha256: sha, sourceSha256: source.sha256, sourceVocalSha256: vocalSha, createdAt: new Date().toISOString() };
    const fresh = readIndex(root);
    fresh.push(entry);
    writeIndex(root, fresh);
    return { kind: 'match', entry, file: final };
  } finally { if (existsSync(output)) unlinkSync(output); }
}
