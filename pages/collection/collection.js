const api = require('../../utils/api');
const { showToast } = require('../../utils/util');

Page({
  data: {
    collections: [],
    isLoading: true,
    isEmpty: false,
    filter: 'all' // 'all' | 'unmastered' | 'mastered'
  },

  onLoad() {
    this.loadCollections();
  },

  async loadCollections() {
    this.setData({ isLoading: true });
    try {
      const mastered = this.data.filter === 'all' ? undefined : (this.data.filter === 'mastered');
      const res = await api.callCloudFunction('login', { action: 'getCollections', mastered }, { showLoading: false });
      const collections = (res && res.collections) || [];
      this.setData({
        collections,
        isEmpty: collections.length === 0,
        isLoading: false
      });
    } catch (err) {
      console.error('加载收藏失败:', err);
      this.setData({ isLoading: false, isEmpty: true });
    }
  },

  onFilterChange(e) {
    const filter = e.currentTarget.dataset.filter;
    this.setData({ filter });
    this.loadCollections();
  },

  async toggleMastered(e) {
    const { id, mastered } = e.currentTarget.dataset;
    try {
      await api.callCloudFunction('login', { action: 'toggleMastered', id, mastered: !mastered }, { showLoading: false });
      this.loadCollections();
    } catch (err) {
      showToast('操作失败');
    }
  },

  async deleteItem(e) {
    const { id } = e.currentTarget.dataset;
    try {
      await api.callCloudFunction('login', { action: 'deleteCollection', id }, { showLoading: false });
      this.loadCollections();
      showToast('已删除');
    } catch (err) {
      showToast('删除失败');
    }
  },

  copyText(e) {
    const { content } = e.currentTarget.dataset;
    wx.setClipboardData({ data: content });
  }
});
