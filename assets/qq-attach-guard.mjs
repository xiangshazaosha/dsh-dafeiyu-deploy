// Local safety wrapper; never modifies SnowLuma or its proprietary components.
export function createAttachVerifier({ api, alive, blockedReason = () => '', sleep = ms => new Promise(r => setTimeout(r, ms)), attempts = 20 }) {
  const attempted = new Set()
  let busy = false
  const identity = p => String(p?.account?.uin ?? p?.uin ?? '').trim()
  const result = (ok, message, extra = {}) => ({ at: Date.now(), ok, message, ...extra })
  return async function verify(proc, bot, unverified = false) {
    const pid = Number(proc?.pid)
    if (!Number.isInteger(pid) || pid <= 0 || !bot || unverified || identity(proc) !== String(bot)) {
      return result(false, '未能在加载前核对机器人账号，已阻止注入；不要用个人主号试加载')
    }
    if (!alive(pid)) return result(false, '目标 QQ 进程已经退出，未加载')
    if (proc.injected && proc.connected && proc.loggedIn) return result(true, '机器人进程已连接；仍需 OneBot 身份及收发验收')
    const blocked = blockedReason()
    if (blocked) return result(false, blocked)
    if (busy) return result(false, '已有接入检查进行中，不重复加载', { pending: true })
    if (attempted.has(pid)) return result(false, '此 QQ 进程已经尝试过加载，不自动重复；请先排查故障')
    busy = true
    attempted.add(pid)
    try {
      const r = await api(`/api/processes/${pid}/load`, { method: 'POST' })
      if (!r?.success || r?.process?.error || ['error', 'failed'].includes(r?.process?.status)) {
        return result(false, '加载请求失败；未建立连接，不自动重试')
      }
      // A successful HTTP response can precede an asynchronous native crash.
      for (let i = 0; i < attempts; i++) {
        await sleep(500)
        if (!alive(pid)) return result(false, '加载后 QQ 进程退出，已停止重试；请核对崩溃记录')
        const state = await api('/api/processes')
        if (!Array.isArray(state?.list)) return result(false, '进程状态响应不完整，不能确认接入成功')
        const current = state.list.find(p => Number(p.pid) === pid)
        if (!current) return result(false, '加载后目标进程消失，不能确认接入成功')
        if (current.error || ['error', 'failed'].includes(current.status)) return result(false, '组件加载进入错误状态，已停止重试')
        const uin = identity(current)
        if (uin && uin !== '0' && uin !== String(bot)) return result(false, '加载后账号不匹配，停止接入')
        if (current.injected && current.connected && current.loggedIn && uin === String(bot)) {
          return result(true, '机器人进程已连接并核对账号；仍需 OneBot 及收发验收')
        }
      }
      return result(false, '加载请求已接受，但尚未验证连接，不重复加载', { pending: true })
    } catch {
      return result(false, '加载或后续状态检查失败，不自动重复请求；请查看脱敏日志')
    } finally {
      busy = false
    }
  }
}
