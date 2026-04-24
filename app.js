let envConfig = {};
try {
  envConfig = require('./env.local');
} catch (e) {
  envConfig = require('./env.example');
}

const CLOUD_ENV_ID = envConfig.cloudEnvId || '';

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      return;
    }
    wx.cloud.init({
      env: CLOUD_ENV_ID,
      traceUser: true
    });

    // 全局音频设置：iOS 静音模式下仍播放语音（教育类 App 必须）
    wx.setInnerAudioOption({
      obeyMuteSwitch: false,
      mixWithOther: true
    });

    // 恢复本地登录缓存（游客态也会读到 openid）
    this.restoreCachedSession();

    // 保证 openid 可用（游客态也需要，用于后续云函数调用上下文）
    // 延迟到下一 tick：此时 App 已注册完成，getApp() 可用
    const auth = require('./utils/auth');
    setTimeout(() => {
      auth.ensureOpenid().catch((err) => {
        console.error('ensureOpenid 失败:', err);
      });
    }, 0);
  },

  restoreCachedSession() {
    const userInfo = wx.getStorageSync('userInfo');
    const openid = wx.getStorageSync('openid');
    const isLoggedIn = wx.getStorageSync('isLoggedIn');
    if (openid) this.globalData.openid = openid;
    if (isLoggedIn && userInfo) {
      this.globalData.userInfo = userInfo;
      this.globalData.isLoggedIn = true;
    }
  },

  globalData: {
    userInfo: null,
    isLoggedIn: false,
    openid: '',
    envId: CLOUD_ENV_ID
  }
});
