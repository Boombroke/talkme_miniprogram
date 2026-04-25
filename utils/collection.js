const api = require('./api');
const auth = require('./auth');
const { showToast } = require('./util');

async function collectText(content, source, role) {
  const text = String(content || '').trim();
  if (!text) return;
  if (auth.requireAuth('收藏句子') !== 'allowed') return;

  try {
    await api.callCloudFunction('login', {
      action: 'addCollection',
      content: text,
      role: role || 'assistant',
      source: source || ''
    }, {
      showLoading: false
    });
    showToast('收藏成功');
  } catch (err) {
    console.error('收藏失败:', err);
    showToast('收藏失败');
  }
}

module.exports = {
  collectText
};
