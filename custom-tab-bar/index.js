Component({
  data: {
    active: 0,
    list: [
      { url: '/pages/index/index', text: '首页', icon: '/images/tab/home.png', activeIcon: '/images/tab/home-active.png' },
      { url: '/pages/checkin/checkin', text: '打卡', icon: '/images/tab/checkin.png', activeIcon: '/images/tab/checkin-active.png' },
      { url: '/pages/history/list/list', text: '记录', icon: '/images/tab/history.png', activeIcon: '/images/tab/history-active.png' },
      { url: '/pages/profile/profile', text: '我的', icon: '/images/tab/profile.png', activeIcon: '/images/tab/profile-active.png' }
    ]
  },

  methods: {
    onTap(e) {
      const idx = parseInt(e.currentTarget.dataset.idx, 10);
      if (idx === this.data.active) return;
      const item = this.data.list[idx];
      // 瞬时高亮：先更新 active 让用户立即看到反馈，再触发页面切换
      this.setData({ active: idx });
      wx.switchTab({ url: item.url });
    },

    setActive(idx) {
      this.setData({ active: idx });
    }
  }
});
