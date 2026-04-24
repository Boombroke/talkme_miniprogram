const api = require('../../../utils/api');
const { formatDate, showToast } = require('../../../utils/util');

Page({
  data: {
    conversation: null,
    messages: [],
    evaluation: null,
    isLoading: true
  },

  onLoad(options) {
    const { id } = options;
    if (id) {
      this.loadDetail(id);
    }
  },

  async loadDetail(id) {
    try {
      const res = await api.getConversationDetail({ conversationId: id });
      if (res) {
        this.setData({
          conversation: res,
          messages: res.messages || [],
          evaluation: res.evaluation || null,
          isLoading: false
        });

        // Set nav title
        const modeText = res.mode === 'free' ? '自由对话' : (res.sceneName || '情景实战');
        wx.setNavigationBarTitle({ title: modeText });
      }
    } catch (err) {
      console.error('加载详情失败:', err);
      showToast('加载失败');
      this.setData({ isLoading: false });
    }
  }
});
