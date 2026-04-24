const auth = require('../../utils/auth');
const api = require('../../utils/api');
const { getStreakFlame } = require('../../utils/util');
const { swr } = require('../../utils/swr');

Page({
  data: {
    userInfo: null,
    stats: {
      totalDays: 0,
      totalPracticeTime: 0,
      averageScore: 0
    },
    greeting: '',
    isLoading: true,
    dailySentence: null, // { en: 'xxx', zh: 'xxx' }
    dailySentenceLoading: false,
    difficultyLevel: 'intermediate',
    difficultyText: '中级',
    lastMode: 'free',
    lastModeText: '自由对话',
    streakFlame: { emoji: '🕯️', label: '待点燃', level: 0 },
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setActive(0);
    }

    const app = getApp();
    const userInfo = app.globalData.userInfo;

    const difficulty = wx.getStorageSync('difficultyLevel') || 'intermediate';
    const lastMode = wx.getStorageSync('lastPracticeMode') || 'free';
    const modeTexts = { free: '自由对话', scene: '情景实战', topic: '话题挑战', grammar: '语法专练', shadow: '影子跟读', vocab: '词汇闪卡' };

    this.setData({
      userInfo,
      difficultyLevel: difficulty,
      difficultyText: this.getDifficultyText(difficulty),
      lastMode,
      lastModeText: modeTexts[lastMode] || '自由对话',
      isLoading: false
    });
    this.loadDailySentence();
    this.loadStats();
  },

  async loadDailySentence() {
    // Use a rotating list of pre-defined sentences (simpler, no API cost)
    const sentences = [
      { en: "The early bird catches the worm.", zh: "早起的鸟儿有虫吃。" },
      { en: "Practice makes perfect.", zh: "熟能生巧。" },
      { en: "Every cloud has a silver lining.", zh: "黑暗中总有一线光明。" },
      { en: "Actions speak louder than words.", zh: "行动胜于言辞。" },
      { en: "Rome wasn't built in a day.", zh: "罗马不是一天建成的。" },
      { en: "Where there's a will, there's a way.", zh: "有志者事竟成。" },
      { en: "Knowledge is power.", zh: "知识就是力量。" },
      { en: "Better late than never.", zh: "迟做总比不做好。" },
      { en: "A journey of a thousand miles begins with a single step.", zh: "千里之行，始于足下。" },
      { en: "Learning never exhausts the mind.", zh: "学习永远不会使心灵疲惫。" },
      { en: "The best way to predict the future is to create it.", zh: "预测未来的最好方式就是创造它。" },
      { en: "It's never too late to learn something new.", zh: "学习新事物永远不会太晚。" },
      { en: "Mistakes are proof that you are trying.", zh: "犯错证明你在尝试。" },
      { en: "Don't count your chickens before they hatch.", zh: "不要过早乐观。" },
      { en: "You miss 100% of the shots you don't take.", zh: "不尝试就永远不会成功。" },
      { en: "When in Rome, do as the Romans do.", zh: "入乡随俗。" },
      { en: "Two heads are better than one.", zh: "三个臭皮匠顶个诸葛亮。" },
      { en: "The pen is mightier than the sword.", zh: "笔比剑更有力量。" },
      { en: "Curiosity killed the cat, but satisfaction brought it back.", zh: "好奇害死猫，但满足使其复活。" },
      { en: "Time flies when you're having fun.", zh: "快乐的时光总是飞逝。" },
      { en: "You can't judge a book by its cover.", zh: "不能以貌取人。" },
      { en: "If at first you don't succeed, try, try again.", zh: "如果一开始没成功，再试一次。" },
      { en: "An apple a day keeps the doctor away.", zh: "每天一苹果，医生远离我。" },
      { en: "The grass is always greener on the other side.", zh: "这山望着那山高。" },
      { en: "No pain, no gain.", zh: "没有付出就没有收获。" },
      { en: "Laughter is the best medicine.", zh: "笑是最好的良药。" },
      { en: "All that glitters is not gold.", zh: "闪光的不一定是金子。" },
      { en: "A picture is worth a thousand words.", zh: "一图胜千言。" },
      { en: "The squeaky wheel gets the grease.", zh: "会哭的孩子有奶吃。" },
      { en: "Birds of a feather flock together.", zh: "物以类聚，人以群分。" },
      { en: "Fortune favors the bold.", zh: "命运眷顾勇者。" }
    ];
    // Use day-of-year as index to rotate daily
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
    const sentence = sentences[dayOfYear % sentences.length];
    this.setData({ dailySentence: sentence });
  },

  loadStats() {
    if (!auth.isLoggedIn()) return;
    const applyStats = (payload) => {
      this.setData({
        stats: payload.stats,
        streakFlame: payload.streakFlame,
        isLoading: false
      });
    };
    swr('home_stats',
      async () => {
        const res = await api.getUserInfo();
        if (!res || !res.userInfo) return null;
        const consecutiveDays = res.userInfo.consecutiveDays || 0;
        const seconds = res.userInfo.totalPracticeTime || 0;
        return {
          stats: {
            totalDays: res.userInfo.totalDays || 0,
            totalPracticeTime: Math.floor(seconds / 60),
            averageScore: res.userInfo.averageScore || 0,
            consecutiveDays: consecutiveDays
          },
          streakFlame: getStreakFlame(consecutiveDays)
        };
      },
      {
        onStale: applyStats,
        onFresh: applyStats,
        onError: (err) => console.error('加载统计数据失败:', err)
      }
    );
  },

  getDifficultyText(level) {
    const map = { beginner: '入门', elementary: '初级', intermediate: '中级', advanced: '高级' };
    return map[level] || '中级';
  },

  onChangeDifficulty() {
    wx.showActionSheet({
      itemList: ['入门 Beginner', '初级 Elementary', '中级 Intermediate', '高级 Advanced'],
      success: (res) => {
        const levels = ['beginner', 'elementary', 'intermediate', 'advanced'];
        const level = levels[res.tapIndex];
        this.setData({
          difficultyLevel: level,
          difficultyText: this.getDifficultyText(level)
        });
        wx.setStorageSync('difficultyLevel', level);
        wx.showToast({ title: '已切换到' + ['入门', '初级', '中级', '高级'][res.tapIndex], icon: 'none' });
      }
    });
  },

  goToLastMode() {
    if (auth.requireAuth('继续练习', { allowTrial: true }) === 'blocked') return;
    const mode = this.data.lastMode || 'free';
    const routes = {
      free: `/pages/chat/chat?mode=free&difficulty=${this.data.difficultyLevel}`,
      scene: '/pages/scene/list/list',
      topic: `/pages/topic/topic?difficulty=${this.data.difficultyLevel}`,
      grammar: `/pages/grammar/grammar?difficulty=${this.data.difficultyLevel}`,
      shadow: `/pages/shadow/shadow?difficulty=${this.data.difficultyLevel}`,
      vocab: `/pages/vocab/vocab?difficulty=${this.data.difficultyLevel}`
    };
    wx.navigateTo({ url: routes[mode] || routes.free });
  },

  goToFreeChat() {
    if (auth.requireAuth('自由对话', { allowTrial: true }) === 'blocked') return;
    wx.setStorageSync('lastPracticeMode', 'free');
    wx.navigateTo({ url: `/pages/chat/chat?mode=free&difficulty=${this.data.difficultyLevel}` });
  },

  // Alias used in wxml
  goToChat() {
    this.goToFreeChat();
  },

  // 情景列表只是浏览，不拦截；真正进入对话时再拦（scene/detail 页）
  goToScene() {
    wx.setStorageSync('lastPracticeMode', 'scene');
    wx.navigateTo({ url: '/pages/scene/list/list' });
  },

  // Alias used in wxml
  goToSceneList() {
    this.goToScene();
  },

  goToTopic() {
    if (auth.requireAuth('话题挑战', { allowTrial: true }) === 'blocked') return;
    wx.setStorageSync('lastPracticeMode', 'topic');
    wx.navigateTo({ url: `/pages/topic/topic?difficulty=${this.data.difficultyLevel}` });
  },

  goToGrammar() {
    if (auth.requireAuth('语法专练', { allowTrial: true }) === 'blocked') return;
    wx.setStorageSync('lastPracticeMode', 'grammar');
    wx.navigateTo({ url: `/pages/grammar/grammar?difficulty=${this.data.difficultyLevel}` });
  },

  goToShadow() {
    if (auth.requireAuth('影子跟读', { allowTrial: true }) === 'blocked') return;
    wx.setStorageSync('lastPracticeMode', 'shadow');
    wx.navigateTo({ url: `/pages/shadow/shadow?difficulty=${this.data.difficultyLevel}` });
  },

  goToVocab() {
    if (auth.requireAuth('词汇闪卡', { allowTrial: true }) === 'blocked') return;
    wx.setStorageSync('lastPracticeMode', 'vocab');
    wx.navigateTo({ url: `/pages/vocab/vocab?difficulty=${this.data.difficultyLevel}` });
  },

  goToChallenge() {
    if (auth.requireAuth('每日挑战', { allowTrial: true }) === 'blocked') return;
    wx.navigateTo({ url: '/pages/challenge/challenge' });
  },

  goToCheckin() {
    wx.switchTab({ url: '/pages/checkin/checkin' });
  }
});
