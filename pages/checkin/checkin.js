const api = require('../../utils/api');
const auth = require('../../utils/auth');
const { showToast, showSuccess, getToday, getStreakFlame } = require('../../utils/util');
const { swr } = require('../../utils/swr');

Page({
  data: {
    isCheckedIn: false,
    consecutiveDays: 0,
    totalDays: 0,
    checkinDates: [],
    todayPractice: {
      count: 0,
      time: 0,
      score: 0
    },
    modeStats: { chat: 0, scene: 0, topic: 0, grammar: 0, shadow: 0, vocab: 0 },
    streakFlame: { emoji: '🕯️', label: '待点燃', level: 0 },
    totalFlame: { emoji: '🕯️', label: '待点燃', level: 0 },
    statsFilter: 'all',
    statsTotal: 0,
    statsFilterName: '',
    statsFilterEmoji: '',
    statsFilterCount: 0,
    leaderboard: [],
    isLoading: false
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setActive(1);
    }
    // 游客也能浏览，但所有统计和日历就是 0 / 空（未登录不发请求）
    if (!auth.isLoggedIn()) {
      this.setData({
        isCheckedIn: false,
        consecutiveDays: 0,
        totalDays: 0,
        checkinDates: [],
        leaderboard: [],
        modeStats: { chat: 0, scene: 0, topic: 0, grammar: 0, shadow: 0, vocab: 0 },
        statsTotal: 0
      });
      return;
    }
    this.loadCheckinData();
    this.loadLeaderboard();
    this.loadModeStats();
  },

  loadCheckinData() {
    const apply = (p) => this.setData({
      checkinDates: p.checkinDates,
      isCheckedIn: p.isCheckedIn,
      consecutiveDays: p.consecutiveDays,
      totalDays: p.totalDays,
      todayPractice: p.todayPractice,
      streakFlame: p.streakFlame,
      totalFlame: p.totalFlame
    });
    swr('checkin_main',
      async () => {
        const now = new Date();
        const res = await api.getCheckinRecords({
          year: now.getFullYear(),
          month: now.getMonth() + 1
        });
        if (!res) return null;
        const today = getToday();
        const checkinDates = (res.records || []).map(r => r.checkinDate);
        const isCheckedIn = checkinDates.indexOf(today) !== -1;
        const consecutiveDays = res.consecutiveDays || 0;
        const totalDays = res.totalDays || 0;
        // todayPractice.time 以秒存储，显示为分钟
        const rawToday = res.todayPractice || { count: 0, time: 0, score: 0 };
        return {
          checkinDates,
          isCheckedIn,
          consecutiveDays,
          totalDays,
          todayPractice: {
            count: rawToday.count || 0,
            time: Math.floor((rawToday.time || 0) / 60),
            score: rawToday.score || 0
          },
          streakFlame: getStreakFlame(consecutiveDays),
          totalFlame: getStreakFlame(totalDays)
        };
      },
      { onStale: apply, onFresh: apply }
    );
  },

  loadLeaderboard() {
    const apply = (p) => this.setData({ leaderboard: p.leaderboard });
    swr('checkin_leaderboard',
      async () => {
        const res = await wx.cloud.callFunction({
          name: 'login',
          data: { action: 'getChallengeLeaderboard' }
        });
        if (!res.result || !res.result.leaderboard) return null;
        return { leaderboard: res.result.leaderboard.slice(0, 10) };
      },
      { onStale: apply, onFresh: apply }
    );
  },

  loadModeStats() {
    const apply = (p) => this.setData({ modeStats: p.modeStats, statsTotal: p.statsTotal });
    swr('checkin_mode_stats',
      async () => {
        const res = await wx.cloud.callFunction({
          name: 'login',
          data: { action: 'getModeStats' }
        });
        if (!res.result || !res.result.stats) return null;
        const stats = res.result.stats;
        const total = (stats.chat || 0) + (stats.scene || 0) + (stats.topic || 0) + (stats.grammar || 0) + (stats.shadow || 0) + (stats.vocab || 0);
        return { modeStats: stats, statsTotal: total };
      },
      { onStale: apply, onFresh: apply }
    );
  },

  onStatsFilter(e) {
    const mode = e.currentTarget.dataset.mode;
    const nameMap = { shadow: '影子跟读', chat: '自由对话', scene: '情景实战', topic: '话题挑战', grammar: '语法专练', vocab: '词汇闪卡' };
    const emojiMap = { shadow: '🔁', chat: '💬', scene: '☕', topic: '🎯', grammar: '📝', vocab: '🎲' };
    this.setData({
      statsFilter: mode,
      statsFilterName: nameMap[mode] || '',
      statsFilterEmoji: emojiMap[mode] || '',
      statsFilterCount: mode === 'all' ? 0 : (this.data.modeStats[mode] || 0)
    });
  },

  async doCheckin() {
    if (this.data.isCheckedIn || this.data.isLoading) return;
    if (auth.requireAuth('打卡') !== 'allowed') return;

    this.setData({ isLoading: true });

    try {
      const res = await api.saveCheckin({
        checkinDate: getToday()
      });

      if (res) {
        const newConsecutive = res.consecutiveDays || this.data.consecutiveDays + 1;
        const newTotal = res.totalDays || this.data.totalDays + 1;
        const checkinDates = [...this.data.checkinDates, getToday()];
        this.setData({
          isCheckedIn: true,
          consecutiveDays: newConsecutive,
          totalDays: newTotal,
          checkinDates,
          streakFlame: getStreakFlame(newConsecutive),
          totalFlame: getStreakFlame(newTotal)
        });

        showSuccess('打卡成功！');
      }
    } catch (err) {
      console.error('打卡失败:', err);
      showToast('打卡失败，请重试');
    } finally {
      this.setData({ isLoading: false });
    }
  },

  onMonthChange(e) {
    // 游客态不加载任何月份数据，保持日历为空
    if (!auth.isLoggedIn()) {
      this.setData({ checkinDates: [] });
      return;
    }
    const { year, month } = e.detail;
    this.loadMonthRecords(year, month);
  },

  async loadMonthRecords(year, month) {
    if (!auth.isLoggedIn()) {
      this.setData({ checkinDates: [] });
      return;
    }
    try {
      const res = await api.getCheckinRecords({ year, month });
      if (res && res.records) {
        const checkinDates = res.records.map(r => r.checkinDate);
        this.setData({ checkinDates });
      }
    } catch (err) {
      console.error('加载月份记录失败:', err);
    }
  },

  async generatePoster() {
    wx.showLoading({ title: '生成海报...' });
    try {
      const query = wx.createSelectorQuery();
      query.select('#posterCanvas').fields({ node: true, size: true }).exec(async (res) => {
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getWindowInfo().pixelRatio;
        canvas.width = 600 * dpr;
        canvas.height = 900 * dpr;
        ctx.scale(dpr, dpr);

        // Background gradient
        const gradient = ctx.createLinearGradient(0, 0, 600, 900);
        gradient.addColorStop(0, '#FF6B6B');
        gradient.addColorStop(1, '#FF9F43');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 600, 900);

        // White card
        ctx.fillStyle = '#FFFFFF';
        this.roundRect(ctx, 40, 120, 520, 660, 24);
        ctx.fill();

        // App title
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Talkme 英语口语练习', 300, 80);

        // Streak info
        ctx.fillStyle = '#FF6B6B';
        ctx.font = 'bold 120px sans-serif';
        ctx.fillText(String(this.data.consecutiveDays), 300, 340);

        ctx.fillStyle = '#636E72';
        ctx.font = '32px sans-serif';
        ctx.fillText('天连续打卡', 300, 400);

        // Stats
        ctx.fillStyle = '#2D3436';
        ctx.font = 'bold 28px sans-serif';
        ctx.fillText('累计打卡 ' + this.data.totalDays + ' 天', 300, 500);

        // Date
        ctx.fillStyle = '#B2BEC3';
        ctx.font = '24px sans-serif';
        const today = new Date();
        ctx.fillText(today.getFullYear() + '/' + (today.getMonth() + 1) + '/' + today.getDate(), 300, 560);

        // Encouragement
        ctx.fillStyle = '#FF6B6B';
        ctx.font = 'bold 28px sans-serif';
        ctx.fillText('坚持就是胜利！', 300, 660);

        // QR hint
        ctx.fillStyle = '#B2BEC3';
        ctx.font = '22px sans-serif';
        ctx.fillText('扫码一起来练口语吧', 300, 840);

        // Save to temp file
        wx.canvasToTempFilePath({
          canvas,
          success: (tmpRes) => {
            wx.hideLoading();
            wx.previewImage({
              urls: [tmpRes.tempFilePath],
              current: tmpRes.tempFilePath
            });
          },
          fail: () => {
            wx.hideLoading();
            wx.showToast({ title: '生成失败', icon: 'none' });
          }
        });
      });
    } catch (err) {
      wx.hideLoading();
      console.error('海报生成失败:', err);
    }
  },

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  onShareAppMessage() {
    return {
      title: '我在Talkme坚持练口语第' + this.data.consecutiveDays + '天！',
      path: '/pages/index/index'
    };
  },

  onShareTimeline() {
    return {
      title: '我在Talkme坚持练口语第' + this.data.consecutiveDays + '天！'
    };
  },

  goToChat() {
    wx.navigateTo({ url: '/pages/chat/chat?mode=free' });
  },

  goToShadow() {
    const difficulty = wx.getStorageSync('difficultyLevel') || 'intermediate';
    wx.navigateTo({ url: '/pages/shadow/shadow?difficulty=' + difficulty });
  }
});
