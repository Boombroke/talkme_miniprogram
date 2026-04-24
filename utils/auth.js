/**
 * 登录授权工具
 *
 * 账号状态：
 *   - guest：拿到 openid，但 user 集合里没有记录（未注册）
 *   - registered：user 集合里有记录，app.globalData.isLoggedIn === true
 *
 * 启动时先 ensureOpenid() 拿到 openid（游客态也需要），注册只在用户主动
 * 点击「登录」时触发 loginWithProfile()（弹 wx.getUserProfile 授权）。
 */

const api = require('./api');

// 是否已注册登录
function isLoggedIn() {
  const app = getApp();
  return !!(app && app.globalData.isLoggedIn && app.globalData.userInfo);
}

// 兼容旧代码：checkAuth 是 isLoggedIn 的别名
function checkAuth() {
  return isLoggedIn();
}

/**
 * 上传用户选择的微信头像到云存储
 * chooseAvatar 返回的是本地临时路径（http://tmp/...），需要上传后才能长期使用
 */
async function uploadAvatarToCloud(tempPath) {
  if (!tempPath) return '';
  // 本地临时路径的情况：上传云存储拿 fileID
  if (tempPath.indexOf('http://') === 0 || tempPath.indexOf('wxfile://') === 0) {
    const cloudPath = 'avatar/' + Date.now() + '-' + Math.random().toString(36).substr(2, 6) + '.jpg';
    const res = await wx.cloud.uploadFile({ cloudPath, filePath: tempPath });
    return res.fileID || '';
  }
  return tempPath; // 已经是 cloud:// 或远程 URL，直接用
}

// 启动即调，确保 openid 可用（游客态也需要）。不会创建 user 记录。
// 注意：onLaunch 中调用时 getApp() 可能尚未可用，由调用方负责延迟调用（见 app.js）。
async function ensureOpenid() {
  const app = getApp();
  const g = (app && app.globalData) || {};

  if (g.openid) return g.openid;

  const cached = wx.getStorageSync('openid');
  if (cached) {
    if (app && app.globalData) app.globalData.openid = cached;
    return cached;
  }

  const res = await api.callCloudFunction(
    'login',
    { action: 'getOpenidOnly' },
    { showLoading: false }
  );
  const openid = (res && res.openid) || '';
  if (openid) {
    if (app && app.globalData) app.globalData.openid = openid;
    wx.setStorageSync('openid', openid);
  }
  return openid;
}

/**
 * 注册登录：调用方通过 chooseAvatar 拿到了用户确认的头像临时路径
 * 昵称可选 — 不传则由云函数填默认值 "英语学习者-<openid 后 4 位>"，用户登录后可在
 * 「编辑资料」里改。微信 2022-10 起 getUserProfile 已废弃，无法再拿到真实昵称，所以
 * 我们只靠 chooseAvatar 走一步登录，昵称后补。
 * @param {object} profile { avatarUrl, nickName? }  avatarUrl 是本地临时路径
 */
async function loginWithProfile(profile) {
  const rawAvatar = (profile && profile.avatarUrl) || '';
  const nickName = (profile && profile.nickName || '').trim(); // 可空

  // 先把临时头像上传到云存储（没选头像也允许，走默认）
  const avatarUrl = rawAvatar ? await uploadAvatarToCloud(rawAvatar) : '';

  const res = await api.callCloudFunction(
    'login',
    { action: 'register', nickName, avatarUrl },
    { loadingText: '登录中...' }
  );

  const userInfo = (res && res.userInfo) || {};
  const app = getApp();
  app.globalData.userInfo = userInfo;
  app.globalData.isLoggedIn = true;
  if (res && res.openid) app.globalData.openid = res.openid;

  wx.setStorageSync('userInfo', userInfo);
  wx.setStorageSync('isLoggedIn', true);
  if (res && res.openid) wx.setStorageSync('openid', res.openid);

  return userInfo;
}

// 修改已登录用户资料
async function updateUserInfo(userInfo) {
  const res = await api.callCloudFunction('login', {
    action: 'updateUserInfo',
    userInfo
  });
  const app = getApp();
  app.globalData.userInfo = Object.assign({}, app.globalData.userInfo, userInfo);
  wx.setStorageSync('userInfo', app.globalData.userInfo);
  return res;
}

// ========= 账号密码登录 =========

/**
 * 校验账号/密码格式。纯同步函数，失败时返回 {ok:false, error}，前端拦截掉非法请求。
 * 规则必须与云函数侧保持一致。
 * - username: 4-20 位字母/数字/下划线
 * - password: 至少 6 位，且必须同时含有字母和数字
 */
function validateAccountCreds(username, password) {
  const uname = (username || '').trim();
  if (!/^[a-zA-Z0-9_]{4,20}$/.test(uname)) {
    return { ok: false, error: '用户名需 4-20 位字母、数字或下划线' };
  }
  const pwd = password || '';
  if (pwd.length < 6) {
    return { ok: false, error: '密码至少 6 位' };
  }
  if (!/[a-zA-Z]/.test(pwd) || !/\d/.test(pwd)) {
    return { ok: false, error: '密码必须包含字母和数字' };
  }
  return { ok: true };
}

// 账号登录 + 注册共用的后处理：写 token / 全局状态 / 本地缓存
function _applyAccountAuthResult(res) {
  const userInfo = (res && res.userInfo) || {};
  const token = (res && res.token) || '';

  const app = getApp();
  app.globalData.userInfo = userInfo;
  app.globalData.isLoggedIn = true;
  if (userInfo.openid) app.globalData.openid = userInfo.openid;

  if (token) wx.setStorageSync('_sessionToken', token);
  wx.setStorageSync('userInfo', userInfo);
  wx.setStorageSync('isLoggedIn', true);
  if (userInfo.openid) wx.setStorageSync('openid', userInfo.openid);

  return userInfo;
}

/**
 * 账号密码登录。成功返回 userInfo，失败抛错。
 * 调用方应自行做 validateAccountCreds 预校验。
 */
async function accountLogin(username, password) {
  const res = await api.callCloudFunction(
    'login',
    { action: 'accountLogin', username: (username || '').trim(), password: password || '' },
    { loadingText: '登录中...' }
  );
  // callCloudFunction 在 res.success===false 时已经 reject 了；这里是双保险
  if (res && res.success === false) {
    throw new Error(res.error || '登录失败');
  }
  return _applyAccountAuthResult(res);
}

/**
 * 账号注册（注册后自动登录）。成功返回 userInfo，失败抛错。
 */
async function accountRegister(params) {
  const username = (params && params.username || '').trim();
  const password = (params && params.password) || '';
  const nickName = (params && params.nickName || '').trim();

  const res = await api.callCloudFunction(
    'login',
    { action: 'accountRegister', username, password, nickName },
    { loadingText: '注册中...' }
  );
  if (res && res.success === false) {
    throw new Error(res.error || '注册失败');
  }
  return _applyAccountAuthResult(res);
}

// 登出
async function logout() {
  // 账号登录的用户需要通知服务端使 token 失效；失败不阻塞本地登出。
  const token = wx.getStorageSync('_sessionToken');
  if (token) {
    try {
      await api.callCloudFunction(
        'login',
        { action: 'accountLogout', _sessionToken: token },
        { showLoading: false }
      );
    } catch (e) {
      // 忽略：网络/服务端错误不应阻止用户登出
      console.warn('accountLogout 失败（忽略）:', e && e.message);
    }
  }

  const app = getApp();
  app.globalData.userInfo = null;
  app.globalData.isLoggedIn = false;
  // 注意：不清 openid，因为游客态也要用
  wx.removeStorageSync('userInfo');
  wx.removeStorageSync('isLoggedIn');
  wx.removeStorageSync('hasUsedTrial');
  wx.removeStorageSync('_sessionToken');

  // 清所有 swr 缓存（避免下个账号看到上个账号的数据残影）
  try {
    const { clearAllCache } = require('./swr');
    clearAllCache();
  } catch (e) { /* ignore */ }
}

// 获取缓存 openid
function getOpenid() {
  const app = getApp();
  return (app && app.globalData.openid) || wx.getStorageSync('openid') || '';
}

/**
 * 受保护操作拦截。已登录直接放行；否则弹 Modal 让用户决定是否去登录。
 * 游客试用：首次进入任一练习功能可免登录试一次；消费 trial 额度后再次触发会强制登录。
 *
 * @param {string} actionName 功能名（出现在 Modal 里）
 * @param {object} opts { allowTrial: boolean } — true 时游客可试用一次
 * @return 'allowed' | 'trial' | 'blocked'
 *   - 'allowed': 已登录，直接做
 *   - 'trial':   未登录但允许试用且试用未用过 —— 消费掉 trial，放行
 *   - 'blocked': 弹了登录 Modal，调用方应 return
 */
function requireAuth(actionName, opts) {
  if (isLoggedIn()) return 'allowed';

  const allowTrial = !!(opts && opts.allowTrial);
  if (allowTrial && !wx.getStorageSync('hasUsedTrial')) {
    wx.setStorageSync('hasUsedTrial', true);
    wx.showToast({ title: '游客试用 1 次', icon: 'none', duration: 1500 });
    return 'trial';
  }

  const msg = allowTrial
    ? `已用完游客试用次数，登录后可无限使用${actionName || ''}`
    : `${actionName || '该功能'}需要登录后使用`;
  wx.showModal({
    title: '登录后继续',
    content: msg,
    confirmText: '去登录',
    cancelText: '取消',
    success: (r) => {
      if (r.confirm) wx.switchTab({ url: '/pages/profile/profile' });
    }
  });
  return 'blocked';
}

module.exports = {
  isLoggedIn,
  checkAuth,        // 别名，兼容旧代码
  uploadAvatarToCloud,
  ensureOpenid,
  loginWithProfile,
  updateUserInfo,
  logout,
  getOpenid,
  requireAuth,
  // 账号密码登录
  validateAccountCreds,
  accountLogin,
  accountRegister
};
