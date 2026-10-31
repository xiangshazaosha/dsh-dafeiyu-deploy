import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, lstatSync, renameSync, unlinkSync } from 'node:fs';
import { join, relative, isAbsolute, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { requestedArrangement, stripArrangement } from './arrangement.mjs';

const normal = value => String(value || '').normalize('NFKC').toLowerCase().replace(/開/g, '开').replace(/飛/g, '飞').replace(/靜/g, '静').replace(/[^\p{L}\p{N}]/gu, '');
const INDEX = '歌曲库索引.json';
export function libraryRoot(config) {
  if (!isAbsolute(String(config.workspaceDir || ''))) throw new Error('QQ 工作区未设置为绝对路径');
  return join(config.workspaceDir, '大肥鱼歌曲库');
}
export function readIndex(root) {
  const f = join(root, INDEX);
  if (!existsSync(f)) return [];
  const obj = JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
  if (!Array.isArray(obj.items)) throw new Error('歌曲库索引格式不正确');
  return obj.items.filter(x => x && typeof x.title === 'string' && typeof x.file === 'string');
}
export function safeFile(root, file) {
  if (!file || isAbsolute(file) || file !== basename(file) || !/\.mp3$/i.test(file)) throw new Error('歌曲库文件名不安全');
  const target = join(root, file);
  if (!existsSync(target) || !lstatSync(target).isFile() || lstatSync(target).isSymbolicLink()) throw new Error('歌曲库文件不存在或不是普通文件');
  const rr = realpathSync(root), rp = realpathSync(target), rel = relative(rr, rp);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('歌曲文件不在歌曲库中');
  return rp;
}
export function writeIndex(root, items) {
  const target = join(root, INDEX), tmp = target + '.tmp-' + process.pid + '-' + Date.now();
  writeFileSync(tmp, JSON.stringify({ version: 1, items }, null, 2), { encoding: 'utf8', flag: 'wx' });
  try { renameSync(tmp, target); } finally { if (existsSync(tmp)) unlinkSync(tmp); }
}
export function match(root, query, { songId, arrangement } = {}) {
  const mode = arrangement || requestedArrangement(query) || 'mixed';
  const clean = stripArrangement(query);
  const result = matchArrangement(root, clean, songId, mode);
  if (mode !== 'acappella') return result;
  const base = matchArrangement(root, clean, songId, 'mixed');
  if (base.kind === 'match') {
    const variants = readIndex(root).filter(e => !e.disabled && e.arrangement === 'acappella' && e.sourceSha256 === base.entry.sha256);
    if (variants.length === 1) return { kind: 'match', entry: variants[0], file: safeFile(root, variants[0].file) };
    if (variants.length > 1) return { kind: 'ambiguous', entries: variants };
    if (result.kind === 'match' && result.entry.artist === base.entry.artist && result.entry.songId && result.entry.songId === base.entry.songId) return result;
    return { kind: base.entry.vocalFile ? 'needs-acappella' : 'no-vocal-source', entry: base.entry };
  }
  if (base.kind !== 'none') return base;
  if (result.kind === 'match' || result.kind === 'ambiguous') return result;
  return { kind: 'no-vocal-source' };
}
function matchArrangement(root, query, songId, mode) {
  const q = normal(query);
  if (!q && !songId) return { kind: 'none' };
  const entries = readIndex(root).filter(entry => !entry.disabled && (entry.arrangement || 'mixed') === mode);
  if (songId) {
    const exact = entries.filter(entry => String(entry.songId || '') === String(songId));
    if (exact.length === 1) return { kind: 'match', entry: exact[0], file: safeFile(root, exact[0].file) };
    if (exact.length > 1) return { kind: 'ambiguous', entries: exact };
    if (entries.some(entry => [entry.title, ...(entry.aliases || [])].map(normal).filter(Boolean).some(term => q.includes(term)))) return { kind: 'different' };
    return { kind: 'none' };
  }
  const ranked = entries.map(entry => {
    const terms = [entry.title, ...(Array.isArray(entry.aliases) ? entry.aliases : [])].map(normal).filter(x => x.length >= 2);
    return { entry, score: Math.max(0, ...terms.filter(x => q.includes(x)).map(x => x.length)) };
  }).filter(x => x.score > 0);
  const best = Math.max(0, ...ranked.map(x => x.score));
  const matches = ranked.filter(x => x.score === best).map(x => x.entry);
  if (!matches.length) return { kind: 'none' };
  let e = matches[0];
  if (matches.length > 1) {
    const selected = matches.filter(e => [e.artist, e.version].map(normal).filter(x => x.length >= 2).some(x => q.includes(x)));
    if (selected.length === 1) e = selected[0];
    else {
      const preferred = matches.filter(e => e.preferred === true);
      if (selected.length || preferred.length !== 1) return { kind: 'ambiguous', entries: matches.map(e => ({ title: e.title, artist: e.artist || '', version: e.version || '' })) };
      e = preferred[0]; // only a version previously chosen by the user can be preferred
    }
  }
  // A request for a different singer, original, pitch, or a fresh performance must not silently reuse a cover.
  if (/原唱|原版|原曲|重新|重做|换版|其他版本|另一个版本|新版本|升调|降调|变调/.test(q)) return { kind: 'different', entry: e };
  let remainder = q;
  const known = [e.title, e.artist, e.version, ...(e.aliases || [])].map(normal).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const part of known) remainder = remainder.split(part).join('');
  for (const piece of ['曼波', 'dj', '版']) if (known.some(x => x.includes(piece))) remainder = remainder.split(piece).join('');
  remainder = remainder.replace(/上一首|上首|改成|换成|换回|改为|换为|我说的是|我要听|要听|刚刚|之前|上次|以前|刚才|原来|做过|唱过|做好的|唱好的|现成|这首|那首|一下|一遍|一首|一曲|给我|帮我|麻烦|可以|能不能|好不好|大肥鱼|肥鱼|播放|语音|点歌|再来|想要|想听|请|帮|我|你|把|将|发|来|再|放|唱|听|歌|的|了|一|个|这|那|还|又|想|啊|呀|吧|吗|嘛/g, '');
  if (remainder) return { kind: 'different', entry: e };
  return { kind: 'match', entry: e, file: safeFile(root, e.file) };
}
export function saveNewCover(root, note, segments) {
  if (!String(note || '').startsWith('[翻唱] ')) return false;
  const record = Array.isArray(segments) && segments.find(x => x?.type === 'record' && typeof x.data?.file === 'string' && x.data.file.startsWith('base64://'));
  if (!record) return false;
  const raw = record.data.file.slice(9);
  if (raw.length > 28_000_000 || !/^[A-Za-z0-9+/=]+$/.test(raw)) return false;
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length < 1024 || bytes.length > 20_000_000) return false;
  const name = String(note).slice(5).trim().slice(0, 160);
  if (!name) return false;
  const parts = name.split(/\s+-\s+/), title = parts[0].trim(), artist = (parts[1] || '').trim();
  const sha = createHash('sha256').update(bytes).digest('hex');
  const safeTitle = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 65) || '翻唱';
  const file = `${safeTitle}-${sha.slice(0, 12)}.mp3`;
  mkdirSync(root, { recursive: true });
  const entries = readIndex(root);
  if (entries.some(e => e.sha256 === sha || e.file === file)) return false;
  const path = join(root, file);
  if (existsSync(path)) return false;
  writeFileSync(path, bytes, { flag: 'wx' });
  entries.push({ title, artist, version: '已制作', arrangement: 'mixed', aliases: [title], file, sha256: sha, createdAt: new Date().toISOString() });
  writeIndex(root, entries);
  return true;
}
