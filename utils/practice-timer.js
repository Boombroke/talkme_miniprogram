/**
 * 练习计时器 —— 只累积"用户有动作"的时间，挂机间隔自动丢弃
 *
 * 使用模式：
 *   const timer = createPracticeTimer();
 *   timer.touch();           // 每次用户有效操作都调一次（发消息/点开始录音/点播放…）
 *   timer.flushAndReport();  // 在 onHide / onUnload 里调，上报并重置
 *
 * 计时规则：
 *   - 每次 touch()：若距上次 touch 不超过 idleMs，则把间隔加入累计；否则视为挂机，丢弃间隔
 *   - 单次上报上限 maxMs（默认 60 分钟），防止异常页面卡死后攒巨量时间
 */

const api = require('./api');
const auth = require('./auth');

const DEFAULT_IDLE_MS = 90 * 1000;         // 90 秒无动作视为挂机
const DEFAULT_MAX_MS = 60 * 60 * 1000;     // 单次 session 最多计 60 分钟

function createPracticeTimer(opts = {}) {
  const idleMs = opts.idleMs || DEFAULT_IDLE_MS;
  const maxMs = opts.maxMs || DEFAULT_MAX_MS;
  const mode = opts.mode || '';

  let lastActive = 0;  // 上次 touch 的时间戳，0 = 尚未启动
  let accumMs = 0;     // 已累积时长（毫秒）
  let reporting = false;

  function now() { return Date.now(); }

  // 把"距离上次 touch 的间隔"并入累计（如果没超过挂机阈值）
  function _consumeGap(t) {
    if (!lastActive) return;
    const gap = t - lastActive;
    if (gap > 0 && gap <= idleMs) accumMs += gap;
    // gap > idleMs：视为挂机，不计入
  }

  function touch() {
    const t = now();
    _consumeGap(t);
    lastActive = t;
  }

  // 计算最终 session 秒数，重置内部状态
  function _drain() {
    if (lastActive) _consumeGap(now());
    const sec = Math.min(accumMs, maxMs) / 1000;
    accumMs = 0;
    lastActive = 0;
    return Math.floor(sec);
  }

  // 上报到云函数（幂等可靠上报用户未登录直接跳过）
  async function flushAndReport() {
    if (reporting) return 0;
    reporting = true;
    try {
      const seconds = _drain();
      if (seconds < 1) return 0;
      if (!auth.isLoggedIn()) return 0;
      await api.callCloudFunction(
        'login',
        { action: 'addPracticeTime', seconds, mode },
        { showLoading: false, retry: 0 }
      );
      return seconds;
    } catch (err) {
      console.error('上报练习时长失败:', err);
      return 0;
    } finally {
      reporting = false;
    }
  }

  function reset() {
    accumMs = 0;
    lastActive = 0;
  }

  return { touch, flushAndReport, reset };
}

module.exports = { createPracticeTimer };
