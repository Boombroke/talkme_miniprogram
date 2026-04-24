/**
 * 通用工具函数
 */

// Format date
function formatDate(date, format = 'YYYY-MM-DD') {
  if (!date) return '';
  if (typeof date === 'string') date = new Date(date);
  if (typeof date === 'number') date = new Date(date);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
}

// Format duration (seconds to mm:ss or HH:mm:ss)
function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '00:00';

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Format relative time (e.g., "3分钟前", "昨天")
function formatRelativeTime(date) {
  if (!date) return '';
  if (typeof date === 'string') date = new Date(date);

  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return formatDate(date, 'MM-DD HH:mm');
}

// Debounce
function debounce(fn, delay = 300) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
      timer = null;
    }, delay);
  };
}

// Throttle
function throttle(fn, delay = 300) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= delay) {
      last = now;
      fn.apply(this, args);
    }
  };
}

// Show toast wrapper
function showToast(title, icon = 'none', duration = 2000) {
  wx.showToast({ title, icon, duration });
}

// Show success toast
function showSuccess(title = '操作成功') {
  wx.showToast({ title, icon: 'success', duration: 1500 });
}

// Show error toast
function showError(title = '操作失败') {
  wx.showToast({ title, icon: 'error', duration: 2000 });
}

// Show modal dialog
function showModal(title, content, showCancel = true) {
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      showCancel,
      confirmColor: '#4A90D9',
      success: (res) => {
        resolve(res.confirm);
      },
      fail: () => {
        resolve(false);
      }
    });
  });
}

// Generate unique ID
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// Get today's date string (YYYY-MM-DD)
function getToday() {
  return formatDate(new Date(), 'YYYY-MM-DD');
}

// Check if two dates are the same day
function isSameDay(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

// Truncate text
function truncate(text, maxLength = 50) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * 根据连续打卡天数返回对应的火苗 emoji + 视觉尺寸
 * size: 打卡页大火苗尺寸(rpx)  navSize: 导航栏小火苗尺寸(rpx)
 */
function getStreakFlame(days) {
  if (days <= 0) return { emoji: '🕯️', level: 0, size: 48, navSize: 24 };
  if (days <= 7) return { emoji: '🔥', level: 1, size: 56, navSize: 28 };
  if (days <= 14) return { emoji: '🔥', level: 2, size: 68, navSize: 32 };
  if (days <= 30) return { emoji: '🔥', level: 3, size: 80, navSize: 36 };
  if (days <= 60) return { emoji: '💥', level: 4, size: 88, navSize: 36 };
  if (days <= 120) return { emoji: '⚡', level: 5, size: 96, navSize: 38 };
  if (days <= 365) return { emoji: '☄️', level: 6, size: 104, navSize: 40 };
  return { emoji: '🌟', level: 7, size: 112, navSize: 42 };
}

module.exports = {
  formatDate,
  formatDuration,
  formatRelativeTime,
  debounce,
  throttle,
  showToast,
  showSuccess,
  showError,
  showModal,
  generateId,
  getToday,
  isSameDay,
  truncate,
  getStreakFlame
};
