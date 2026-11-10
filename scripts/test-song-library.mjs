// Isolated: no QQ/network/models. An explicitly supplied local FFmpeg enables synthetic test-tone rendering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import extension from '../assets/song-library/index.mjs';
import { match, libraryRoot, safeFile, saveNewCover, readIndex } from '../assets/song-library/library.mjs';
import { requestedArrangement, isArrangementFollowUp, readLastSong } from '../assets/song-library/arrangement.mjs';
import { captureVocalStem, ensureAcappella } from '../assets/song-library/acappella.mjs';

const parent = realpathSync(dirname(fileURLToPath(import.meta.url)));
async function fixture(run) {
  const workspaceDir = mkdtempSync(join(parent, '.library-test-'));
  const root = libraryRoot({ workspaceDir });
  mkdirSync(root);
  const bytes = Buffer.alloc(2048, 42); // deliberately not a real MP3; matching/persistence tests only
  const entries = [{ title: '测试曲目', artist: '测试歌手', version: '片段版', aliases: ['测试别名'], file: 'test.mp3', voice: 'test-voice', pitch: 0, songId: 'test-song-id', sha256: createHash('sha256').update(bytes).digest('hex') }];
  writeFileSync(join(root, 'test.mp3'), bytes);
  const write = () => writeFileSync(join(root, '歌曲库索引.json'), JSON.stringify({ version: 1, items: entries }));
  write();
  try { return await run({ workspaceDir, root, entries, write, bytes }); }
  finally {
    const target = realpathSync(workspaceDir);
    if (dirname(target) !== parent || !basename(target).startsWith('.library-test-') || target !== resolve(workspaceDir)) throw new Error('Unsafe test cleanup path');
    rmSync(target, { recursive: true });
  }
}
function fakeApi(workspaceDir) {
  const cfg = { workspaceDir, enabled: true, dryRun: false, ownerQQ: 'test-owner', song: { enabled: true, pitch: 0 } };
  const handlers = {}, voices = [], texts = [], requests = [], disposers = [];
  const song = { request: args => { requests.push(args); return { ok: true, message: 'mock queued' }; } };
  const original = song.request;
  let command;
  const api = {
    config: () => cfg, isOwner: id => id === cfg.ownerQQ,
    on: (name, fn) => { handlers[name] = fn; },
    command: c => { command = c; }, route: (p,f) => { handlers['route:'+p]=f; },
    sendVoiceFile: async (...args) => { voices.push(args); },
    sendText: async (...args) => { texts.push(args); },
    use: () => song,
    every: () => {}, onDispose: fn => disposers.push(fn), context: () => {},
    log: { info() {}, warn() {} },
  };
  const exports = extension.setup(api);
  const msg = text => ({ kind: 'private', userId: cfg.ownerQQ, chatId: `private:${cfg.ownerQQ}`, text });
  return { cfg, api, handlers, voices, texts, requests, command, msg, song, original, disposers, exports };
}

test('unique title and alias reuse; unknown and different versions do not match', () => fixture(({ root }) => {
  assert.equal(match(root, '再给我唱之前的测试曲目').kind, 'match');
  assert.equal(match(root, '唱测试别名').kind, 'match');
  assert.equal(match(root, '唱未制作歌曲').kind, 'none');
  assert.equal(match(root, '唱测试曲目别的歌手').kind, 'different');
  assert.equal(match(root, '唱测试曲目原唱').kind, 'different');
}));
test('multiple versions require unique choice and still reject different qualifiers', () => fixture(({ root, entries, write }) => {
  entries.push({ ...entries[0], artist: '另一歌手', version: '完整版' }); write();
  assert.equal(match(root, '唱测试曲目').kind, 'ambiguous');
  assert.equal(match(root, '唱测试曲目另一歌手').kind, 'match');
  assert.equal(match(root, '唱测试曲目另一歌手原唱').kind, 'different');
  assert.equal(match(root, '唱测试曲目另一歌手其他版本').kind, 'different');
}));
test('artist names are metadata rather than developer-specific blocked names', () => fixture(({ root, entries, write }) => {
  entries[0].artist = '李晓杰'; write();
  assert.equal(match(root, '唱测试曲目李晓杰').kind, 'match');
}));
test('unsafe paths and missing files fail closed', () => fixture(({ root }) => {
  assert.throws(() => safeFile(root, '../test.mp3'));
  assert.throws(() => safeFile(root, join(root, 'test.mp3')));
  assert.throws(() => safeFile(root, 'missing.mp3'));
  assert.throws(() => libraryRoot({ workspaceDir: 'relative' }));
}));
test('new send content persists once; existing index and file preserved', () => fixture(({ root, bytes }) => {
  const otherBytes = Buffer.alloc(2048, 43);
  const segments = [{ type: 'record', data: { file: 'base64://' + otherBytes.toString('base64') } }];
  assert.equal(saveNewCover(root, '[歌曲库] 已有', segments), false);
  assert.equal(saveNewCover(root, '[翻唱] 新曲 - 新歌手', segments), true);
  assert.equal(saveNewCover(root, '[翻唱] 新曲 - 新歌手', segments), false);
  assert.equal(readIndex(root).length, 2);
  assert.deepEqual(readFileSync(join(root, 'test.mp3')), bytes);
  assert.equal(match(root, '唱新曲').kind, 'match');
}));
test('private repeated requests and slash command send files without rendering', () => fixture(async ({ workspaceDir }) => {
  const f = fakeApi(workspaceDir);
  for (let i = 0; i < 2; i++) assert.equal(await f.handlers.message(f.msg('再唱测试曲目')), true);
  await f.command.run('测试曲目', f.msg('/sing 测试曲目'));
  assert.equal(f.voices.length, 3);
  assert.equal(f.requests.length, 0);
}));
test('owner/private gates and disabled/dry-run block voice sends', () => fixture(async ({ workspaceDir }) => {
  const f = fakeApi(workspaceDir);
  assert.equal(await f.handlers.message({ ...f.msg('唱测试曲目'), userId: 'other' }), false);
  assert.equal(await f.handlers.message({ ...f.msg('唱测试曲目'), kind: 'group', chatId: 'group:test' }), false);
  f.cfg.dryRun = true; await f.command.run('测试曲目', f.msg(''));
  f.cfg.dryRun = false; f.cfg.enabled = false; await f.command.run('测试曲目', f.msg(''));
  f.cfg.enabled = true; f.cfg.song.enabled = false; await f.command.run('测试曲目', f.msg(''));
  assert.equal(f.voices.length, 0); assert.equal(f.requests.length, 0);
}));
test('unknown command fallback and explicit pitch tested only with mock engine', () => fixture(async ({ workspaceDir }) => {
  const f = fakeApi(workspaceDir);
  await f.command.run('未知曲目', f.msg(''));
  await f.command.run('测试曲目 +2', f.msg(''));
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].song, '未知曲目');
  assert.equal(f.voices.length, 0);
}));
test('actual reported wording is claimed, including correction wording', () => fixture(async ({ workspaceDir, entries, write }) => {
  entries[0].title = '中国人能飞 边飞边发MJ';
  entries[0].aliases = ['中国人能飞', '中国人能飞边飞边发mg']; write();
  const f = fakeApi(workspaceDir);
  for (const text of ['我要听中国人能飞边飞边发mj', '我要听中国人能飞', '我说的是中国人能飞边飞边发MG']) {
    assert.equal(await f.handlers.message(f.msg(text)), true);
  }
  assert.equal(f.voices.length, 3); assert.equal(f.requests.length, 0);
}));
test('previously user-selected preferred version wins, explicit other version still wins', () => fixture(({ root, entries, write }) => {
  entries[0].preferred = true;
  entries.push({ ...entries[0], artist: '另一歌手', preferred: false }); write();
  assert.equal(match(root, '我要听测试曲目').entry.artist, '测试歌手');
  assert.equal(match(root, '我要听测试曲目另一歌手').entry.artist, '另一歌手');
  assert.equal(match(root, '唱测试曲目未知版本').kind, 'different');
}));
test('shared model/panel request reference reuses existing cover without any queue', () => fixture(async ({ workspaceDir }) => {
  const f = fakeApi(workspaceDir);
  const modelTool = args => f.song.request(args); // same object captured by built-in setup
  const result = modelTool({ song: '测试曲目', chatId: f.msg('').chatId, pitch: 0 });
  assert.equal(typeof result.then, 'undefined');
  assert.equal(result.reused, true); assert.equal(result.queued, false);
  assert.equal(f.exports.guardStatus().mounted, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.voices.length, 1); assert.equal(f.requests.length, 0);
  const byId = modelTool({ songId: 'test-song-id', chatId: f.msg('').chatId });
  assert.equal(byId.reused, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.voices.length, 2); assert.equal(f.requests.length, 0);
}));
test('central guard never renders on wrong parameters, missing file or bad index', () => fixture(({ workspaceDir, root }) => {
  const f = fakeApi(workspaceDir), chatId = f.msg('').chatId;
  assert.equal(f.song.request({ song: '测试曲目', chatId, pitch: 12 }).ok, false);
  assert.equal(f.song.request({ song: '测试曲目', chatId, voice: 'other' }).ok, false);
  assert.equal(f.song.request({ song: '测试曲目原唱', chatId }).ok, false);
  writeFileSync(join(root, '歌曲库索引.json'), 'invalid');
  assert.equal(f.song.request({ song: '测试曲目', chatId }).ok, false);
  assert.equal(f.requests.length, 0);
}));
test('guard restores original method on disposal, and non-owner calls are not expanded', () => fixture(({ workspaceDir }) => {
  const f = fakeApi(workspaceDir);
  f.song.request({ song: '测试曲目', chatId: 'group:test' });
  assert.equal(f.requests.length, 1); assert.equal(f.voices.length, 0);
  for (const dispose of f.disposers) dispose();
  assert.equal(f.song.request, f.original);
}));
test('broken index and send failure never start new rendering', () => fixture(async ({ workspaceDir, root }) => {
  const f = fakeApi(workspaceDir);
  f.api.sendVoiceFile = async () => { throw new Error('mock send failed'); };
  await f.handlers.message(f.msg('唱测试曲目'));
  writeFileSync(join(root, '歌曲库索引.json'), 'broken json');
  await f.handlers.message(f.msg('唱测试曲目'));
  assert.equal(f.requests.length, 0);
  assert.equal(f.texts.length, 2);
}));
function addVocalVariant({ root, entries, write }) {
  const entry = { ...entries[0], arrangement: 'acappella', file: 'acappella.mp3', sha256: 'a'.repeat(64), sourceSha256: entries[0].sha256 };
  writeFileSync(join(root, entry.file), Buffer.alloc(2048, 44));
  entries.push(entry); write();
  return entry;
}
test('arrangement words and title-free references are distinguished', () => {
  for (const text of ['清唱版', '纯人声', '不要伴奏', '不带伴奏']) assert.equal(requestedArrangement(text), 'acappella');
  assert.equal(requestedArrangement('不要清唱，带伴奏'), 'mixed');
  for (const text of ['上一首改成清唱', '我要听清唱版的', '刚才那首不要伴奏', '来个清唱版', '上一首换回带伴奏']) assert.equal(isArrangementFollowUp(text), true);
  assert.equal(isArrangementFollowUp('测试曲目清唱版'), false);
  assert.equal(isArrangementFollowUp('未知歌名清唱版'), false);
});
test('mixed and acappella have distinct lookup and exact IDs', () => fixture(data => {
  addVocalVariant(data);
  assert.equal(match(data.root, '我要听测试曲目').entry.file, 'test.mp3');
  assert.equal(match(data.root, '我要听测试曲目清唱版').entry.file, 'acappella.mp3');
  assert.equal(match(data.root, '清唱', { songId: 'test-song-id' }).entry.arrangement, 'acappella');
}));
test('existing mixed without vocal source never silently plays or rerenders as acappella', () => fixture(async ({ workspaceDir, root }) => {
  assert.equal(match(root, '测试曲目清唱版').kind, 'no-vocal-source');
  const f = fakeApi(workspaceDir);
  await f.handlers.message(f.msg('我要听测试曲目清唱版'));
  const result = f.song.request({ song: '测试曲目清唱版', chatId: f.msg('').chatId });
  assert.equal(result.ok, false); assert.equal(f.voices.length, 0); assert.equal(f.requests.length, 0);
}));
test('explicit vocal mode does not send another singer simply because only their acappella exists', () => fixture(data => {
  const variant = addVocalVariant(data);
  variant.artist = '另一歌手'; variant.sourceSha256 = 'b'.repeat(64); data.write();
  assert.equal(match(data.root, '测试曲目清唱版').kind, 'no-vocal-source');
}));
test('consecutive natural follow-up switches the same song, persists, and switches back', () => fixture(async data => {
  addVocalVariant(data);
  const f = fakeApi(data.workspaceDir);
  await f.handlers.message(f.msg('我要听测试曲目'));
  assert.equal(readLastSong(data.root).title, '测试曲目');
  await f.handlers.message(f.msg('上一首改成清唱'));
  await f.handlers.message(f.msg('我要听清唱版的'));
  assert.equal(f.voices[1][1], join(data.root, 'acappella.mp3'));
  assert.equal(f.voices[2][1], join(data.root, 'acappella.mp3'));
  assert.equal(readLastSong(data.root).arrangement, 'acappella');
  const restarted = fakeApi(data.workspaceDir);
  await restarted.handlers.message(restarted.msg('上一首换回带伴奏'));
  assert.equal(restarted.voices[0][1], join(data.root, 'test.mp3'));
  assert.equal(f.requests.length, 0); assert.equal(restarted.requests.length, 0);
}));
test('no prior track asks for a title; unknown named song does not inherit previous title', () => fixture(async data => {
  addVocalVariant(data);
  const f = fakeApi(data.workspaceDir);
  await f.handlers.message(f.msg('我要听清唱版的'));
  assert.equal(f.voices.length, 0); assert.match(f.texts[0][1], /哪首/);
  await f.handlers.message(f.msg('我要听测试曲目'));
  await f.handlers.message(f.msg('未知歌名清唱版'));
  assert.equal(f.voices.length, 1); assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].song, '未知歌名 清唱');
}));
test('simulation follow-up uses separate memory and never changes the real last-track file', () => fixture(async data => {
  addVocalVariant(data);
  const f = fakeApi(data.workspaceDir);
  await f.handlers.message({ ...f.msg('我要听测试曲目'), raw: { simulated: true } });
  await f.handlers.message({ ...f.msg('上一首改成清唱'), raw: { simulated: true } });
  assert.equal(readLastSong(data.root), null);
  assert.equal(f.voices[1][1], join(data.root, 'acappella.mp3'));
}));
test('model shared request handles relative acappella using persisted last track', () => fixture(async data => {
  addVocalVariant(data);
  const f = fakeApi(data.workspaceDir);
  await f.handlers.message(f.msg('我要听测试曲目'));
  const result = f.song.request({ song: '上一首改成清唱', chatId: f.msg('').chatId, pitch: 0 });
  assert.equal(result.reused, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.voices[1][1], join(data.root, 'acappella.mp3'));
  assert.equal(f.requests.length, 0);
}));
test('native new-song send saves file and index then preserves exactly corresponding RVC vocal', () => fixture(async data => {
  const work = join(data.workspaceDir, 'native-work'), job = join(work, 'job'); mkdirSync(job, { recursive: true });
  const mixed = Buffer.alloc(2048, 67), vocal = Buffer.alloc(4096, 68);
  writeFileSync(join(job, 'cover.mp3'), mixed); writeFileSync(join(job, 'vocals_rvc.wav'), vocal);
  const f = fakeApi(data.workspaceDir);
  f.api.lib = () => ({ dataDir: () => work });
  await f.handlers.send([{ type: 'record', data: { file: 'base64://' + mixed.toString('base64') } }], { note: '[翻唱] 新入库曲目 - 新歌手', chatId: f.msg('').chatId });
  const entry = readIndex(data.root).find(e => e.title === '新入库曲目');
  assert.ok(entry?.vocalFile); assert.ok(entry?.vocalSha256);
  assert.deepEqual(readFileSync(join(data.root, entry.vocalFile)), vocal);
  assert.equal(match(data.root, '新入库曲目清唱版').kind, 'needs-acappella');
  assert.equal(f.voices.length, 0); assert.equal(f.requests.length, 0);
}));
test('a work-directory stem is not linked to a different produced MP3', () => fixture(data => {
  const work = join(data.workspaceDir, 'work'), job = join(work, 'job'); mkdirSync(job, { recursive: true });
  writeFileSync(join(job, 'cover.mp3'), Buffer.alloc(2048, 99)); writeFileSync(join(job, 'vocals_rvc.wav'), Buffer.alloc(4096));
  assert.equal(captureVocalStem(data.root, data.entries[0].sha256, work), false);
  assert.equal(readIndex(data.root)[0].vocalFile, undefined);
}));
test('real local FFmpeg exports vocal-only media once and records a separate variant', { skip: !process.env.DSH_SONG_TEST_FFMPEG }, () => fixture(async data => {
  const exe = process.env.DSH_SONG_TEST_FFMPEG;
  const vocalFile = 'real-vocal-test.wav';
  const p = spawnSync(exe, ['-n', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ar', '44100', join(data.root, vocalFile)], { windowsHide: true });
  assert.equal(p.status, 0, String(p.stderr));
  data.entries[0].vocalFile = vocalFile;
  data.entries[0].vocalSha256 = createHash('sha256').update(readFileSync(join(data.root, vocalFile))).digest('hex'); data.write();
  const result = await ensureAcappella(data.root, data.entries[0], exe);
  assert.equal(result.entry.arrangement, 'acappella'); assert.equal(result.entry.sourceSha256, data.entries[0].sha256);
  const again = await ensureAcappella(data.root, data.entries[0], exe);
  assert.equal(again.entry.sha256, result.entry.sha256); assert.equal(readIndex(data.root).length, 2);
}));
test('new named acappella request preserves mode in actual queued query and dry-run does not queue', () => fixture(data => {
  const f = fakeApi(data.workspaceDir), chatId = f.msg('').chatId;
  const result = f.song.request({ song: '我要听新曲清唱版', chatId });
  assert.equal(result.ok, true); assert.equal(f.requests[0].song, '新曲 清唱');
  f.cfg.dryRun = true;
  const dry = f.song.request({ song: '另一新曲清唱版', chatId });
  assert.equal(dry.queued, false); assert.equal(f.requests.length, 1);
}));
test('native clear-request send filter replaces mixed bytes with vocal-only bytes and indexes both', { skip: !process.env.DSH_SONG_TEST_FFMPEG }, () => fixture(async data => {
  const exe = process.env.DSH_SONG_TEST_FFMPEG;
  const work = join(data.workspaceDir, 'native-work'), job = join(work, 'job'); mkdirSync(job, { recursive: true });
  const mixed = Buffer.alloc(2048, 85);
  writeFileSync(join(job, 'cover.mp3'), mixed);
  const result = spawnSync(exe, ['-n', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ar', '44100', join(job, 'vocals_rvc.wav')], { windowsHide: true });
  assert.equal(result.status, 0);
  const f = fakeApi(data.workspaceDir), chatId = f.msg('').chatId;
  f.cfg.song.root = dirname(dirname(exe));
  f.api.lib = () => ({ dataDir: () => work });
  f.song.status = () => ({ current: { chatId, query: '新清唱曲目 清唱' } });
  const returned = await f.handlers.send([{ type: 'record', data: { file: 'base64://' + mixed.toString('base64') } }], { note: '[翻唱] 新清唱曲目 - 歌手', chatId });
  assert.ok(Array.isArray(returned));
  assert.notEqual(returned[0].data.file, 'base64://' + mixed.toString('base64'));
  const items = readIndex(data.root).filter(e => e.title === '新清唱曲目');
  assert.equal(items.length, 2); assert.equal(items.filter(e => e.arrangement === 'acappella').length, 1);
  assert.match(f.texts[0][1], /不混入伴奏轨/);
}));
test('native clear request without a corresponding stem blocks mixed send rather than faking success', () => fixture(async data => {
  const f = fakeApi(data.workspaceDir), chatId = f.msg('').chatId;
  f.song.status = () => ({ current: { chatId, query: '新曲 清唱' } });
  f.api.lib = () => ({ dataDir: () => join(data.workspaceDir, 'absent') });
  const returned = await f.handlers.send([{ type: 'record', data: { file: 'base64://' + Buffer.alloc(2048, 87).toString('base64') } }], { note: '[翻唱] 新曲 - 歌手', chatId });
  assert.equal(returned, null); assert.match(f.texts[0][1], /停止发送/);
}));


test('saved RVC clear default reaches real request queue and explicit mixed overrides it',()=>fixture(data=>{
 const f=fakeApi(data.workspaceDir);f.cfg.ext={'breeze-cover':{rvcArrangement:'acappella'}};const chatId=f.msg('').chatId;
 const result=f.song.request({song:'测试新曲',chatId});assert.equal(result.ok,true);assert.equal(requestedArrangement(f.requests[0].song),'acappella');
 f.song.request({song:'另一新曲 带伴奏',chatId});assert.equal(requestedArrangement(f.requests[1].song),'mixed');
 f.cfg.dryRun=true;const dry=f.song.request({song:'第三新曲',chatId});assert.equal(dry.queued,false);assert.equal(f.requests.length,2);
}));
test('saved RVC clear default affects cached-library lookup, not only text labels',()=>fixture(async data=>{
 data.entries[0].vocalFile='retained-vocal.wav';data.write();const f=fakeApi(data.workspaceDir);f.cfg.ext={'breeze-cover':{rvcArrangement:'acappella'}};f.api.core={http:{query:x=>x}};
 assert.equal((await f.handlers['route:/match']({q:'测试曲目'})).kind,'needs-acappella');assert.equal((await f.handlers['route:/match']({q:'测试曲目 带伴奏'})).kind,'match');
}));
test('explicit Breeze request bypasses cached RVC interception',()=>fixture(async data=>{
 const f=fakeApi(data.workspaceDir);assert.equal(await f.handlers.message(f.msg('用Breeze翻唱测试曲目')),false);assert.equal(f.voices.length,0);assert.equal(f.requests.length,0);
}));
