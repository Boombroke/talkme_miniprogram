/**
 * Stale-While-Revalidate 缓存工具
 *
 * 用法：页面 onShow 时调 swr(key, fetcher, { onStale, onFresh })
 *   - onStale(cached): 命中缓存时立即调（0ms，感知无感）
 *   - onFresh(fresh):  云函数返回新数据时再调，覆盖上一步渲染
 *   - 若无缓存，onStale 不调；直接等 onFresh
 *
 * 存储：wx.getStorageSync，key 统一加 'swr:' 前缀避免撞名
 */

const STORAGE_PREFIX = 'swr:';

function loadCache(key) {
  try {
    const raw = wx.getStorageSync(STORAGE_PREFIX + key);
    return raw || null;
  } catch (e) {
    return null;
  }
}

function saveCache(key, value) {
  if (value == null) return;
  try {
    wx.setStorageSync(STORAGE_PREFIX + key, value);
  } catch (e) {
    // 缓存写失败不影响主流程
    console.warn('swr 缓存写失败:', key, e && e.message);
  }
}

// 登出时清空所有 swr 缓存，防止下个账号闪出上个账号的数据
function clearAllCache() {
  try {
    const info = wx.getStorageInfoSync();
    (info.keys || []).forEach(k => {
      if (k.indexOf(STORAGE_PREFIX) === 0) wx.removeStorageSync(k);
    });
  } catch (e) { /* ignore */ }
}

/**
 * @param {string} key  缓存键（不带前缀）
 * @param {() => Promise<any>} fetcher  拉新数据的函数
 * @param {object} opts
 *   - onStale(cached): 命中缓存立即调
 *   - onFresh(fresh):  拿到新数据后调
 *   - onError(err):    fetcher 失败时调
 *   - ttl: 缓存保鲜时长（ms）。命中但已过期 → 仍会 onStale（展示旧值），但会立刻重新 fetch。
 *          不传 = 无限期保留，总是会后台 revalidate
 * @returns Promise<fresh|undefined>
 */
function swr(key, fetcher, opts = {}) {
  const { onStale, onFresh, onError } = opts;

  const cached = loadCache(key);
  if (cached && typeof onStale === 'function') {
    try { onStale(cached); } catch (e) { console.warn('swr onStale err:', key, e); }
  }

  return Promise.resolve()
    .then(() => fetcher())
    .then((fresh) => {
      if (fresh != null) {
        saveCache(key, fresh);
        if (typeof onFresh === 'function') {
          try { onFresh(fresh); } catch (e) { console.warn('swr onFresh err:', key, e); }
        }
      }
      return fresh;
    })
    .catch((err) => {
      console.error('swr fetch 失败:', key, err && err.message);
      if (typeof onError === 'function') {
        try { onError(err); } catch (e) { /* ignore */ }
      }
    });
}

module.exports = { swr, loadCache, saveCache, clearAllCache, STORAGE_PREFIX };
