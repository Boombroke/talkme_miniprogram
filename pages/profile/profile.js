const auth = require('../../utils/auth');
const api = require('../../utils/api');
const { showModal, showToast } = require('../../utils/util');
const { swr } = require('../../utils/swr');

Page({
  data: {
    isLoggedIn: false,
    userInfo: null,
    stats: {
      totalDays: 0,
      totalPracticeTime: 0,
      averageScore: 0,
      consecutiveDays: 0
    },
    hasEvalData: false,

    loggingIn: false,

    // 未登录态：登录方式切换（微信一键 / 账号密码）
    loginMode: 'wechat',            // 'wechat' | 'account'
    accountForm: { username: '', password: '', nickName: '' },
    accountIsRegister: false,       // false=登录，true=注册
    accountError: ''
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setActive(3);
    }

    const loggedIn = auth.isLoggedIn();
    const app = getApp();
    this.setData({
      isLoggedIn: loggedIn,
      userInfo: loggedIn ? app.globalData.userInfo : null
    });

    if (loggedIn) {
      this.loadStats();
    } else {
      this.setData({
        stats: { totalDays: 0, totalPracticeTime: 0, averageScore: 0, consecutiveDays: 0 },
        hasEvalData: false
      });
    }
  },

  // ========= 登录：一键 chooseAvatar 后立即完成注册 =========
  // 用户点头像按钮 → 微信弹头像选择器 → 选完就直接登录，昵称走默认值
  async onChooseAvatar(e) {
    if (this.data.loggingIn) return;
    const avatarUrl = e.detail.avatarUrl;
    if (!avatarUrl) return;

    this.setData({ loggingIn: true });
    try {
      const userInfo = await auth.loginWithProfile({ avatarUrl });
      this.setData({ isLoggedIn: true, userInfo });
      this.loadStats();
      showToast('登录成功');
    } catch (err) {
      console.error('登录失败:', err);
      showToast(err && err.message ? err.message : '登录失败，请重试');
    } finally {
      this.setData({ loggingIn: false });
    }
  },

  // ========= 登录：账号密码 =========

  // 切换登录方式（微信 / 账号）
  switchLoginMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode !== 'wechat' && mode !== 'account') return;
    if (mode === this.data.loginMode) return;
    this.setData({ loginMode: mode, accountError: '' });
  },

  // 登录 <-> 注册 切换
  toggleAccountMode() {
    this.setData({
      accountIsRegister: !this.data.accountIsRegister,
      accountError: ''
    });
  },

  onAccountInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    const value = e.detail.value || '';
    this.setData({
      [`accountForm.${field}`]: value,
      accountError: ''
    });
  },

  async onSubmitAccount() {
    if (this.data.loggingIn) return;
    const { username, password, nickName } = this.data.accountForm;

    // 前端先做一次格式校验，避免无效请求
    const check = auth.validateAccountCreds(username, password);
    if (!check.ok) {
      this.setData({ accountError: check.error });
      return;
    }

    this.setData({ loggingIn: true, accountError: '' });
    try {
      const userInfo = this.data.accountIsRegister
        ? await auth.accountRegister({ username, password, nickName })
        : await auth.accountLogin(username, password);

      this.setData({
        isLoggedIn: true,
        userInfo,
        accountForm: { username: '', password: '', nickName: '' }
      });
      this.loadStats();
      showToast('登录成功');
    } catch (err) {
      console.error('账号登录/注册失败:', err);
      this.setData({ accountError: (err && err.message) || '操作失败，请重试' });
    } finally {
      this.setData({ loggingIn: false });
    }
  },

  // ========= 已登录：统计 =========

  loadStats() {
    const apply = (stats) => this.setData({ stats });
    swr('profile_stats',
      async () => {
        const res = await api.getUserInfo();
        if (!res || !res.userInfo) return null;
        // totalPracticeTime 以秒存储，展示为分钟（向下取整）
        const seconds = res.userInfo.totalPracticeTime || 0;
        return {
          totalDays: res.userInfo.totalDays || 0,
          totalPracticeTime: Math.floor(seconds / 60),
          averageScore: res.userInfo.averageScore || 0,
          consecutiveDays: res.userInfo.consecutiveDays || 0
        };
      },
      { onStale: apply, onFresh: apply }
    );
    // 图表有独立的云函数调用，单独走一条 swr 通道
    this.drawStatsChart();
  },

  drawStatsChart() {
    const that = this;
    const applyEvals = (evals) => {
      if (!evals || evals.length === 0) {
        that.setData({ hasEvalData: false });
        return;
      }
      that.setData({ hasEvalData: true });
      // 延迟 50ms 让文字先上屏，再启动 canvas 绘制，避免 onShow 抖动
      setTimeout(() => that._paintChart(evals), 50);
    };
    swr('profile_chart',
      async () => {
        const res = await wx.cloud.callFunction({
          name: 'login',
          data: { action: 'getRecentEvaluations', limit: 7 }
        });
        return (res.result && res.result.evaluations) || [];
      },
      { onStale: applyEvals, onFresh: applyEvals }
    );
  },

  _paintChart(evals) {
    const query = wx.createSelectorQuery();
    query.select('#statsChart').fields({ node: true, size: true }).exec((qRes) => {
      if (!qRes[0]) return;
      const canvas = qRes[0].node;
      const ctx = canvas.getContext('2d');
      const width = qRes[0].width;
      const height = qRes[0].height;
      const dpr = wx.getWindowInfo().pixelRatio;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      const padding = { top: 20, right: 20, bottom: 40, left: 40 };
      const chartW = width - padding.left - padding.right;
      const chartH = height - padding.top - padding.bottom;
      const barWidth = Math.min(chartW / evals.length * 0.6, 30);
      const gap = chartW / evals.length;

      ctx.strokeStyle = '#E8E8E8';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = padding.top + chartH * (1 - i / 4);
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();

        ctx.fillStyle = '#B2BEC3';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(String(i * 25), padding.left - 5, y + 4);
      }

      evals.forEach((ev, i) => {
        const score = ev.totalScore || 0;
        const barH = (score / 100) * chartH;
        const x = padding.left + gap * i + (gap - barWidth) / 2;
        const y = padding.top + chartH - barH;

        const gradient = ctx.createLinearGradient(x, y + barH, x, y);
        gradient.addColorStop(0, '#FF9F43');
        gradient.addColorStop(1, '#FF6B6B');
        ctx.fillStyle = gradient;

        ctx.beginPath();
        ctx.moveTo(x, y + barH);
        ctx.lineTo(x, y + 4);
        ctx.arcTo(x, y, x + 4, y, 4);
        ctx.lineTo(x + barWidth - 4, y);
        ctx.arcTo(x + barWidth, y, x + barWidth, y + 4, 4);
        ctx.lineTo(x + barWidth, y + barH);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#2D3436';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(score), x + barWidth / 2, y - 5);

        const date = new Date(ev.createTime);
        const label = (date.getMonth() + 1) + '/' + date.getDate();
        ctx.fillStyle = '#B2BEC3';
        ctx.font = '9px sans-serif';
        ctx.fillText(label, x + barWidth / 2, height - 10);
      });
    });
  },

  // ========= 菜单路由（带登录门禁） =========

  goToHistory() {
    if (auth.requireAuth('练习记录') !== 'allowed') return;
    wx.switchTab({ url: '/pages/history/list/list' });
  },

  goToEvaluation() {
    if (auth.requireAuth('评分记录') !== 'allowed') return;
    wx.navigateTo({ url: '/pages/evaluation/evaluation' });
  },

  goToCollection() {
    if (auth.requireAuth('我的收藏') !== 'allowed') return;
    wx.navigateTo({ url: '/pages/collection/collection' });
  },

  goToAbout() {
    showModal('关于', '英语口语练习 v1.0\nAI驱动的智能口语练习平台', false);
  },

  // ========= 已登录：编辑资料 =========

  onTapAvatar() {
    if (!this.data.isLoggedIn) return; // 未登录时头像区域由登录卡片承担
    this.onEditProfile();
  },

  onEditProfile() {
    wx.showActionSheet({
      itemList: ['修改昵称', '修改头像'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.editNickname();
        } else if (res.tapIndex === 1) {
          this.editAvatar();
        }
      }
    });
  },

  editNickname() {
    wx.showModal({
      title: '修改昵称',
      editable: true,
      placeholderText: '请输入新昵称',
      content: this.data.userInfo.nickName || '',
      success: async (res) => {
        if (res.confirm && res.content && res.content.trim()) {
          const newName = res.content.trim();
          try {
            await auth.updateUserInfo({ nickName: newName });
            this.setData({ 'userInfo.nickName': newName });
            wx.showToast({ title: '修改成功', icon: 'success' });
          } catch (err) {
            wx.showToast({ title: '修改失败', icon: 'none' });
          }
        }
      }
    });
  },

  editAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const tempPath = res.tempFiles[0].tempFilePath;
        try {
          const fileID = await auth.uploadAvatarToCloud(tempPath);
          await auth.updateUserInfo({ avatarUrl: fileID });
          this.setData({ 'userInfo.avatarUrl': fileID });
          wx.showToast({ title: '修改成功', icon: 'success' });
        } catch (err) {
          wx.showToast({ title: '修改失败', icon: 'none' });
        }
      }
    });
  },

  onSetReminder() {
    if (auth.requireAuth('练习提醒') !== 'allowed') return;

    const TEMPLATE_ID = '';
    if (!TEMPLATE_ID) {
      wx.showModal({
        title: '提示',
        content: '练习提醒功能需要在小程序管理后台配置订阅消息模板，请联系管理员设置。',
        showCancel: false
      });
      return;
    }

    wx.requestSubscribeMessage({
      tmplIds: [TEMPLATE_ID],
      success: (res) => {
        if (res[TEMPLATE_ID] === 'accept') {
          wx.showToast({ title: '已开启提醒', icon: 'success' });
          wx.setStorageSync('reminderEnabled', true);
        } else {
          wx.showToast({ title: '未授权提醒', icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '设置失败', icon: 'none' });
      }
    });
  },

  async onLogout() {
    const confirm = await showModal('退出登录', '确定要退出登录吗？');
    if (confirm) {
      // logout 现在是 async（会尝试通知云端吊销 token），但失败也不阻塞。
      await auth.logout();
      this.setData({
        isLoggedIn: false,
        userInfo: null,
        stats: { totalDays: 0, totalPracticeTime: 0, averageScore: 0, consecutiveDays: 0 },
        hasEvalData: false,
        loginMode: 'wechat',
        accountIsRegister: false,
        accountForm: { username: '', password: '', nickName: '' },
        accountError: ''
      });
      showToast('已退出');
    }
  }
});
