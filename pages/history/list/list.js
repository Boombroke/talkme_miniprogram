const api = require('../../../utils/api');
const auth = require('../../../utils/auth');
const { formatRelativeTime, truncate, showToast } = require('../../../utils/util');
const { swr } = require('../../../utils/swr');

Page({
  data: {
    conversations: [],
    filteredConversations: [],
    currentFilter: 'all',
    searchText: '',
    page: 1,
    pageSize: 10,
    hasMore: true,
    isLoading: false,
    isEmpty: false
  },

  onLoad() {
    this._needRefresh = true;
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setActive(2);
    }
    // 游客：显示空态，不发请求
    if (!auth.isLoggedIn()) {
      this.setData({
        conversations: [],
        filteredConversations: [],
        page: 1,
        hasMore: false,
        isEmpty: true
      });
      return;
    }
    // Only refresh if explicitly flagged (first load, tab tap, or external change)
    if (this._needRefresh) {
      this._loadFirstPage();
      this._needRefresh = false;
    }
  },

  _loadFirstPage() {
    const that = this;
    const filter = this.data.currentFilter;
    const key = 'history_page1_' + (filter || 'all');
    const apply = (payload) => {
      that.setData({
        conversations: payload.list,
        filteredConversations: payload.list,
        page: 2,
        hasMore: payload.list.length >= that.data.pageSize,
        isEmpty: payload.list.length === 0,
        isLoading: false
      });
    };
    swr(key,
      async () => {
        const res = await api.getConversationList({
          page: 1,
          pageSize: that.data.pageSize,
          mode: filter === 'all' ? '' : filter
        });
        if (!res || !res.list) return null;
        return {
          list: res.list.map(item => ({
            ...item,
            timeStr: formatRelativeTime(item.createTime),
            preview: truncate(item.lastMessage || '', 40),
            modeText: ({ free: '自由对话', scene: '情景实战', shadow: '影子跟读', topic: '话题挑战', grammar: '语法专练', vocab: '词汇闪卡' })[item.mode] || '练习'
          }))
        };
      },
      { onStale: apply, onFresh: apply }
    );
  },

  onTabItemTap() {
    // User tapped the tab — force refresh next onShow
    this._needRefresh = true;
  },

  async loadConversations() {
    if (this.data.isLoading || !this.data.hasMore) return;

    this.setData({ isLoading: true });

    try {
      const res = await api.getConversationList({
        page: this.data.page,
        pageSize: this.data.pageSize,
        mode: this.data.currentFilter === 'all' ? '' : this.data.currentFilter
      });

      if (res && res.list) {
        const newList = res.list.map(item => ({
          ...item,
          timeStr: formatRelativeTime(item.createTime),
          preview: truncate(item.lastMessage || '', 40),
          modeText: ({ free: '自由对话', scene: '情景实战', shadow: '影子跟读', topic: '话题挑战', grammar: '语法专练', vocab: '词汇闪卡' })[item.mode] || '练习'
        }));

        const conversations = [...this.data.conversations, ...newList];
        this.setData({
          conversations,
          filteredConversations: conversations,
          page: this.data.page + 1,
          hasMore: newList.length >= this.data.pageSize,
          isEmpty: conversations.length === 0
        });
      }
    } catch (err) {
      console.error('加载记录失败:', err);
    } finally {
      this.setData({ isLoading: false });
    }
  },

  onFilterChange(e) {
    const filter = e.currentTarget.dataset.filter;
    this.setData({
      currentFilter: filter,
      conversations: [],
      page: 1,
      hasMore: true
    });
    this.loadConversations();
  },

  onSearch(e) {
    // Compatible with both native input (e.detail.value) and Vant Search (e.detail)
    const searchText = typeof e.detail === 'string' ? e.detail : (e.detail.value || '');
    this.setData({ searchText });
    if (!searchText) {
      this.setData({ filteredConversations: this.data.conversations });
      return;
    }
    const filtered = this.data.conversations.filter(c =>
      (c.preview && c.preview.toLowerCase().includes(searchText.toLowerCase())) ||
      (c.sceneName && c.sceneName.includes(searchText))
    );
    this.setData({ filteredConversations: filtered });
  },

  goToDetail(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/history/detail/detail?id=${id}`
    });
  },

  onReachBottom() {
    this.loadConversations();
  }
});
