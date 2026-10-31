import { libraryRoot, match, saveNewCover, readIndex, writeIndex } from './library.mjs';
import { installRequestGuard } from './request-guard.mjs';
import { requestedArrangement, isArrangementFollowUp, readLastSong, rememberSong } from './arrangement.mjs';
import { ensureAcappella, captureVocalStem } from './acappella.mjs';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export default {
  id: 'song-library', name: '翻唱成品优先', version: '1.2.0', api: 1,
  description: '主人私聊点歌优先发送歌曲库中的既有翻唱；没有匹配时保留原有点歌流程。',
  setup(api) {
    const allowed = msg => msg?.kind === 'private' && api.isOwner(msg.userId) &&
      String(msg.chatId) === 'private:' + String(msg.userId);
    let simulatedLast = null;
    let nativeVocalLast = null;
    const resolveSong = (text, options = {}) => {
      const root = libraryRoot(api.config());
      if (isArrangementFollowUp(text)) {
        const last = options.simulated ? simulatedLast : readLastSong(root);
        if (!last) return { kind: 'needs-title' };
        text = `${last.title} ${last.artist} ${text}`;
      }
      return match(root, text, options);
    };
    const ambiguous = r => '歌曲库有多个同名版本，请说歌手或版本：' + r.entries.map(e => `${e.title} ${e.artist} ${e.version}`.trim()).join('；');
    const play = async (chatId, r, options = {}) => {
      const cfg = api.config();
      if (!cfg.enabled || !cfg.song?.enabled) return '翻唱功能目前关闭，请先打开。';
      if (cfg.dryRun) return '当前是试运行，未发送语音。';
      if (r.kind === 'ambiguous') return ambiguous(r);
      if (r.kind === 'needs-title') return '我还不能确定“上一首”是哪首。请说“歌名＋清唱版”，不会拿带伴奏版冒充。';
      if (r.kind === 'no-vocal-source') return '这首目前没有可复用的清唱人声轨；没有发送带伴奏版，也没有自动重新下载或制作。需要先准备对应换声后的人声。';
      if (r.kind === 'different') return '歌曲库中有同名成品，但你指定的版本可能不同；请说清版本，需要新制作时明确说“重新制作”。';
      if (r.kind === 'needs-acappella') {
        if (!isAbsolute(String(cfg.song.root || ''))) throw new Error('翻唱环境路径不正确');
        r = await ensureAcappella(libraryRoot(cfg), r.entry, join(cfg.song.root, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
      }
      if (r.kind !== 'match') return null;
      const mode = r.entry.arrangement === 'acappella' ? '清唱无伴奏' : '带伴奏';
      await api.sendVoiceFile(chatId, r.file, `[歌曲库·${mode}] ${r.entry.title} ${r.entry.artist || ''}`.trim());
      if (options.simulated) simulatedLast = r.entry;
      else { try { rememberSong(libraryRoot(cfg), r.entry); } catch (error) { api.log.warn('记录上一首失败：', error.message); } }
      try { await api.sendText(chatId, `《${r.entry.title}》${mode === '清唱无伴奏' ? '清唱版（不混入伴奏轨）' : '带伴奏版'}。`); } catch (error) { api.log.warn('曲目版本说明发送失败：', error.message); }
      return '找到之前做好的版本，已经发给你啦。';
    };
    api.on('message', async msg => {
      if (!allowed(msg) || !api.config().song?.enabled || (!requestedArrangement(msg.text) && !/(唱|点歌|放歌|播放|放一|放给|再放|发.*(?:歌|语音)|再听|想听|要听|我说的是|听一听|听一下|听听|再来|来一遍|再发|发给我|发一遍|重播|回放)/.test(String(msg.text || '')))) return false;
      let result;
      try { result = resolveSong(msg.text, { simulated: Boolean(msg.raw?.simulated) }); } catch (error) {
        api.log.warn('歌曲库读取失败：', error.message);
        await api.sendText(msg.chatId, '歌曲库暂时无法读取，我没有开始重新制作。');
        return true;
      }
      if (result.kind === 'none') return false;
      if (result.kind === 'no-vocal-source' && !result.entry && !isArrangementFollowUp(msg.text)) {
        if (msg.raw?.simulated) { await api.sendText(msg.chatId, '这是新歌清唱请求；模拟中不开始制作。'); return true; }
        const response = api.use('song')?.request({ song: msg.text, chatId: msg.chatId });
        await api.sendText(msg.chatId, response?.message || '翻唱模块暂不可用。');
        return true;
      }
      if (/重新制作|重新翻唱|重新唱|重做/.test(msg.text)) return false;
      try {
        const response = await play(msg.chatId, result, { simulated: Boolean(msg.raw?.simulated) });
        if (!['match', 'needs-acappella'].includes(result.kind) && response) await api.sendText(msg.chatId, response);
      } catch (error) { api.log.warn('歌曲库播放失败：', error.message); await api.sendText(msg.chatId, '成品发送或清唱导出失败；没有改发带伴奏版，也没有重新制作。'); }
      return true;
    });
    api.command({ name: 'sing', aliases: ['唱', '点歌', '翻唱'], desc: '点歌优先查已有翻唱',
      run: async (arg, msg) => {
        const cfg = api.config();
        if (!cfg.enabled || !cfg.song?.enabled) return '翻唱功能目前关闭，请先打开。';
        if (!allowed(msg)) return '歌曲库点歌目前只支持主人私聊。';
        if (!arg.trim()) return '唱哪首？可以说歌名和版本。';
        const pitch = arg.match(/^(.*?)\s+([+-]\d{1,2})$/);
        if (pitch && Number(pitch[2]) !== Number(cfg.song.pitch || 0)) return api.use('song')?.request({ song: pitch[1], pitch: Number(pitch[2]), chatId: msg.chatId })?.message || '翻唱模块不可用';
        const name = pitch ? pitch[1].trim() : arg.trim();
        if (/重新制作|重新翻唱|重做/.test(name)) return '已有成品默认不重做；另做新版本请明确歌曲来源和制作参数。';
        const result = resolveSong(name, { simulated: Boolean(msg.raw?.simulated) });
        if (result.kind === 'no-vocal-source' && !result.entry) {
          if (msg.raw?.simulated) return '这是新歌清唱请求；模拟中不开始制作。';
          return api.use('song')?.request({ song: name, chatId: msg.chatId })?.message || '翻唱模块不可用';
        }
        if (result.kind === 'none') return api.use('song')?.request({ song: name, chatId: msg.chatId })?.message || '翻唱模块不可用';
        return await play(msg.chatId, result, { simulated: Boolean(msg.raw?.simulated) });
      }
    });
    api.on('send', async (segments, context) => {
      const cfg = api.config();
      if (!cfg.enabled || cfg.dryRun || context?.chatId !== `private:${cfg.ownerQQ}`) return;
      const active = api.use('song')?.status?.().current;
      const wantsClear = String(context.note || '').startsWith('[翻唱] ') && active?.chatId === context.chatId && requestedArrangement(active.query) === 'acappella';
      if (String(context.note || '').startsWith('[翻唱] ')) nativeVocalLast = null;
      try {
        const root = libraryRoot(cfg);
        if (saveNewCover(root, context.note, segments)) api.log.info('新翻唱已保存到歌曲库及索引');
        if (String(context.note || '').startsWith('[翻唱] ')) {
          const record = segments?.find(s => s.type === 'record' && s.data?.file?.startsWith('base64://'));
          if (record && api.lib) {
            const sha = createHash('sha256').update(Buffer.from(record.data.file.slice(9), 'base64')).digest('hex');
            const work = api.lib('core/store.js').dataDir('songs');
            if (captureVocalStem(root, sha, work)) api.log.info('对应换声后人声已保留，可按需导出清唱');
            if (wantsClear) {
              const source = readIndex(root).find(e => e.sha256 === sha && (e.arrangement || 'mixed') === 'mixed');
              if (!source?.vocalFile) throw new Error('这次没有找到对应换声人声轨，拒绝把混音当清唱发送');
              if (!isAbsolute(String(cfg.song.root || ''))) throw new Error('翻唱环境路径不正确');
              const clean = await ensureAcappella(root, source, join(cfg.song.root, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
              nativeVocalLast = { title: String(context.note).slice(5).trim(), entry: clean.entry };
              await api.sendText(context.chatId, `《${clean.entry.title}》清唱版（不混入伴奏轨）。`);
              return segments.map(s => s === record ? { ...s, data: { ...s.data, file: 'base64://' + readFileSync(clean.file).toString('base64') } } : s);
            }
          }
          if (!wantsClear) await api.sendText(context.chatId, `《${String(context.note).slice(5).trim()}》带伴奏版。`);
        }
      }
      catch (error) {
        api.log.warn(wantsClear ? '清唱输出失败，已拦截带伴奏音频：' : '新翻唱保存到歌曲库失败：', error.message);
        if (wantsClear) {
          await api.sendText(context.chatId, '清唱导出没有成功；我已停止发送这条带伴奏音频，没有把它冒充清唱。');
          return null;
        }
      }
      if (wantsClear) return null; // missing record/API is never a reason to send the mixed track
    });
    api.on('song/sung', info => {
      const cfg = api.config();
      if (!cfg.enabled || cfg.dryRun || info?.chatId !== `private:${cfg.ownerQQ}`) return;
      try {
        const root = libraryRoot(cfg), entries = readIndex(root);
        const entry = entries.find(e => (e.arrangement || 'mixed') === 'mixed' && `${e.title}${e.artist ? ' - ' + e.artist : ''}` === info.title);
        if (!entry) return;
        const h = api.use('song')?.status?.().history?.[0];
        if (h?.ok && h.title === info.title) { entry.voice = h.voice; entry.pitch = h.pitch; writeIndex(root, entries); }
        let last = entry;
        if (nativeVocalLast?.title === info.title) {
          last = entries.find(e => e.sha256 === nativeVocalLast.entry.sha256) || nativeVocalLast.entry;
          if (h?.ok && h.title === info.title) { last.voice = h.voice; last.pitch = h.pitch; writeIndex(root, entries); }
          nativeVocalLast = null;
        }
        rememberSong(root, last);
      } catch (error) { api.log.warn('更新新歌索引/上一首失败：', error.message); }
    });
    const requestGuard = installRequestGuard(api, resolveSong, play);
    api.context(() => '歌曲库优先发送已有成品；清唱=只发换声后人声、不混伴奏。请求清唱时须在工具song字段保留“清唱版”，不能省略为普通歌名。用户说“上一首改成清唱/我要听清唱版的”由歌曲库上一首记录解析，不擅自更换歌曲。没有人声源时说明缺失，不把混音成品冒充清唱；用户只想重听时不自行添加歌手、升降调或换版。');
    api.route('/match', async req => {
      const query = api.core.http.query(req).q || '';
      try { const r = resolveSong(query); return { ok: true, kind: r.kind, title: r.entry?.title || '', artist: r.entry?.artist || '', arrangement: r.entry?.arrangement || (r.kind === 'match' ? 'mixed' : ''), count: r.entries?.length || 0, guard: requestGuard.status() }; }
      catch (error) { return { ok: false, message: error.message }; }
    });
    return { guardStatus: requestGuard.status };
  }
};
