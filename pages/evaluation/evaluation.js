Page({
  data: {
    evaluations: [],
    isLoading: true,
    isEmpty: false
  },

  onLoad() {
    this.loadEvaluations();
  },

  async loadEvaluations() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'login',
        data: { action: 'getRecentEvaluations', limit: 50 }
      });
      const evaluations = (res.result && res.result.evaluations) || [];
      // Show newest first
      this.setData({
        evaluations: evaluations.reverse(),
        isEmpty: evaluations.length === 0,
        isLoading: false
      });
    } catch (err) {
      console.error('加载评分记录失败:', err);
      this.setData({ isLoading: false, isEmpty: true });
    }
  },

  getScoreColor(score) {
    if (score >= 80) return '#10AC84';
    if (score >= 60) return '#FF9F43';
    return '#EE5253';
  },

  goToDetail(e) {
    const { conversationId } = e.currentTarget.dataset;
    if (conversationId) {
      wx.navigateTo({ url: '/pages/history/detail/detail?id=' + conversationId });
    }
  }
});
