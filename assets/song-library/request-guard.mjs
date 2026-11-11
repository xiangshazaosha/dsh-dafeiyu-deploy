// Keep the public request method synchronous, like Aurabot 1.1.11.
// The model tool, HTTP panel and /sing all call this same exported song object.
import { requestedArrangement, isArrangementFollowUp, newAcappellaQuery } from './arrangement.mjs';
const nativeGuard=Symbol.for('dsh.cover.native.dispatch.v1');
const currentRequest=song=>song.request?.[nativeGuard]?.inner||song.request;
const setRequest=(song,fn)=>{const outer=song.request?.[nativeGuard];if(outer)outer.inner=fn;else song.request=fn;};
export function installRequestGuard(api, resolveSong, play) {
  let mounted = null;
  const inFlight = new Set();
  function decide(args = {}) {
    if (args.file) return { kind: 'none' }; // a new explicit input is not an old cover
    const result = resolveSong(args.song || '', { songId: args.songId });
    if (!['match', 'needs-acappella'].includes(result.kind)) return result;
    const e = result.entry;
    // An explicit parameter mismatch must not silently start a fresh rendering.
    if (args.voice && (!e.voice || args.voice !== e.voice)) return { kind: 'parameters', entry: e };
    if (args.pitch != null && (!Number.isFinite(Number(e.pitch)) || Number(args.pitch) !== Number(e.pitch))) return { kind: 'parameters', entry: e };
    return result;
  }
  function restore() {
    if (mounted && currentRequest(mounted.song) === mounted.wrapped) setRequest(mounted.song,mounted.original);
    mounted = null;
  }
  function ensure() {
    const song = api.use('song');
    if (!song || typeof song.request !== 'function') return false;
    if (mounted?.song === song && currentRequest(song) === mounted.wrapped) return true;
    restore();
    const original = currentRequest(song);
    function wrapped(args = {}) {
      const cfg = api.config();
      if (args.chatId !== `private:${cfg.ownerQQ}`) return original.call(song, args);
      if (!cfg.enabled || !cfg.song?.enabled) return { ok: false, message: '翻唱功能目前关闭，没有开始制作。' };
      if(cfg.ext?.['breeze-cover']?.reuseFinished===false||/重新制作|重新翻唱|重新唱|重唱|重做|另做一版|换个新音色|用新音色/.test(String(args.song||'')))return {ok:false,message:'重新翻唱需要统一制作路由接管；当前没有复用旧成品或启动旧引擎缓存，请检查翻唱制作扩展。'};
      if(cfg.ext?.['breeze-cover']?.rvcArrangement==='acappella'&&!requestedArrangement(args.song)){const name=String(args.song||args.file?.split(/[\\/]/).pop()||'').trim();args={...args,song:name+' 清唱版'};}
      let result;
      try { result = decide(args); }
      catch (error) { api.log.warn('制作入口读取歌曲库失败：', error.message); return { ok: false, message: '歌曲库读取失败；为避免重复制作，这次没有联网或排队。' }; }
      if (result.kind === 'none') return original.call(song, args);
      if (result.kind === 'no-vocal-source' && !result.entry && requestedArrangement(args.song) === 'acappella' && !isArrangementFollowUp(args.song)) {
        if (cfg.dryRun) return { ok: true, queued: false, sent: false, message: '当前试运行，没有开始新清唱制作。' };
        const name = newAcappellaQuery(args.song);
        if (!name) return { ok: false, message: '请指定要清唱的歌名。' };
        const result = original.call(song, { ...args, song: name });
        return result.ok ? { ...result, message: '正在准备新歌清唱版；CPU分离/换声可能较慢，完成后只发送换声后人声，不混入伴奏。' } : result;
      }
      if (result.kind === 'parameters') return { ok: false, message: '歌曲库已有这首成品，但请求的音色或音调与记录不同。请先确认要重发旧成品还是另做参数不同的版本；我没有重新制作。' };
      if (!['match', 'needs-acappella'].includes(result.kind)) return { ok: false, message: result.kind === 'needs-title' ? '上一首记录不足，请明确歌名和清唱/带伴奏版本。' : result.kind === 'no-vocal-source' ? '没有对应清唱人声源；没有改发带伴奏版，也没有自动重新制作。' : result.kind === 'ambiguous' ? '歌曲库有多个版本，请指定演唱者或版本；没有开始新制作。' : '歌曲库有同名成品，但你指定的版本与记录不同；请先确认版本，没有开始新制作。' };
      if (cfg.dryRun) return { ok: true, reused: true, sent: false, queued: false, message: '命中已有成品；当前试运行，不发送、不制作。' };
      const key = `${args.chatId}\0${result.file || result.entry?.sha256}\0${result.kind}`;
      if (inFlight.has(key)) return { ok: true, reused: true, queued: false, message: '已有成品正在发送，无需重新制作。' };
      inFlight.add(key);
      Promise.resolve().then(() => play(args.chatId, result)).catch(async error => {
        api.log.warn('制作入口发送已有成品失败：', error.message);
        try { await api.sendText(args.chatId, '已有成品发送失败，但没有重新制作。请稍后再发一次。'); } catch {}
      }).finally(() => inFlight.delete(key));
      api.log.info('制作入口命中歌曲库，跳过网易云与RVC：' + result.entry.title);
      return { ok: true, reused: true, queued: false, message: result.kind === 'needs-acappella' ? '正在用已保留的人声导出清唱，不联网取歌、不重跑RVC，完成后直接发送。' : '找到已制作的成品，正在直接发送，无需网易云下载或重新翻唱。' };
    }
    setRequest(song,wrapped);
    mounted = { song, original, wrapped };
    return true;
  }
  if (!ensure()) api.log.warn('翻唱模块暂不可用，等待加载后安装歌曲库入口保护');
  api.on('module/start', id => { if (id === 'song') ensure(); });
  api.every(1000, ensure, '保持成品库制作入口保护');
  api.onDispose(restore);
  return { status: () => ({ mounted: Boolean(mounted && api.use('song') === mounted.song && currentRequest(mounted.song) === mounted.wrapped), pendingSends: inFlight.size }), preview: decide };
}
