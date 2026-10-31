import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const norm = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function requestedArrangement(text) {
  const q = norm(text);
  if (/不要清唱|不听清唱|不是清唱|不用清唱/.test(q)) return 'mixed';
  if (/清唱|无伴奏|没有伴奏|不带伴奏|不要伴奏|去掉伴奏|去除伴奏|纯人声|仅人声|只要人声/.test(q)) return 'acappella';
  if (/带伴奏|有伴奏|加上伴奏|恢复伴奏/.test(q)) return 'mixed';
  return null;
}
export function stripArrangement(text) {
  return String(text || '').replace(/不要清唱|不听清唱|不是清唱|不用清唱|清唱版本|清唱版|清唱|没有伴奏|不带伴奏|不要伴奏|去掉伴奏|去除伴奏|无伴奏版|无伴奏|纯人声版|纯人声|仅人声|只要人声|加上伴奏|恢复伴奏|带伴奏版|带伴奏|有伴奏/g, '');
}
export function isArrangementFollowUp(text) {
  if (!requestedArrangement(text)) return false;
  const rest = norm(stripArrangement(text)).replace(/上一首|上首|刚才那首|刚刚那首|那一首|这一首|这首|那首|刚才|刚刚|之前|上次|先前|版本|改成|换成|换回|改为|换为|我要听|我想听|想听|给我|帮我|麻烦|可以|能不能|能否|我要|我想|请|把|将|再|来|个|发|放|唱|听|的|了|一遍|一下|吧|吗|呀|啊/g, '');
  return !rest;
}
export function newAcappellaQuery(text) {
  let name = stripArrangement(text).trim();
  let previous;
  do { previous = name; name = name.replace(/^(?:请|麻烦|能不能|可以|我要听|我想听|想听|给我|帮我|播放|点歌|唱|听|发|放)\s*/u, '').trim(); } while (name !== previous);
  name = name.replace(/[“”「」《》]/g, '').replace(/[的吧呀啊。！!，,？?\s]+$/g, '').trim();
  return name ? `${name} 清唱` : '';
}
const lastFile = root => join(root, '.last-song.json');
export function readLastSong(root) {
  if (!existsSync(lastFile(root))) return null;
  const entry = JSON.parse(readFileSync(lastFile(root), 'utf8').replace(/^\uFEFF/, ''));
  return typeof entry.title === 'string' && typeof entry.artist === 'string' ? entry : null;
}
export function rememberSong(root, entry) {
  mkdirSync(root, { recursive: true });
  const value = { title: entry.title, artist: entry.artist || '', songId: entry.songId || '', file: entry.file, sha256: entry.sha256, arrangement: entry.arrangement || 'mixed', at: new Date().toISOString() };
  const temp = lastFile(root) + '.tmp-' + process.pid + '-' + Date.now();
  writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' });
  renameSync(temp, lastFile(root));
}
