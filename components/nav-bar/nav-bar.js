Component({
  properties: {
    title: { type: String, value: '' },
    showBack: { type: Boolean, value: true },
    // For index page: slot replaces default title area
    custom: { type: Boolean, value: false }
  },

  data: {
    statusBarHeight: 20,
    navContentHeight: 44,
    navBarHeight: 64,
    menuPadRight: 95
  },

  lifetimes: {
    attached() {
      const sysInfo = wx.getWindowInfo();
      const menuBtn = wx.getMenuButtonBoundingClientRect();
      const statusBarHeight = sysInfo.statusBarHeight || 20;
      const capsulePad = menuBtn.top - statusBarHeight;
      const navContentHeight = capsulePad * 2 + menuBtn.height;
      const navBarHeight = statusBarHeight + navContentHeight;
      const menuPadRight = sysInfo.windowWidth - menuBtn.left + 8;
      this.setData({
        statusBarHeight,
        navContentHeight,
        navBarHeight,
        menuPadRight
      });
    }
  },

  methods: {
    onBack() {
      const pages = getCurrentPages();
      if (pages.length > 1) {
        wx.navigateBack();
      } else {
        wx.switchTab({ url: '/pages/index/index' });
      }
    }
  }
});
