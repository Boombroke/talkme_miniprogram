/**
 * API封装 - 云函数调用统一管理
 */

// Base cloud function caller with retry and error handling
function callCloudFunction(name, data, options = {}) {
  const { showLoading = true, loadingText = '加载中...', retry = 1, timeout = 60000 } = options;

  // 账号登录态：自动附带 _sessionToken，让云函数的 resolveOpenid 可以识别账号用户。
  // 未登录（游客 / 微信用户）没存 token → 不会附加，保持原行为。
  const sessionToken = wx.getStorageSync('_sessionToken');
  if (sessionToken && data && typeof data === 'object' && !data._sessionToken) {
    data = Object.assign({}, data, { _sessionToken: sessionToken });
  }

  if (showLoading) {
    wx.showLoading({ title: loadingText, mask: true });
  }

  return new Promise((resolve, reject) => {
    let attempts = 0;

    const doCall = () => {
      attempts++;
      wx.cloud.callFunction({
        name,
        data,
        timeout,
        success: (res) => {
          if (showLoading) wx.hideLoading();
          if (res.result && res.result.success === false) {
            reject(new Error(res.result.error || '请求失败'));
          } else {
            resolve(res.result);
          }
        },
        fail: (err) => {
          if (attempts < retry) {
            setTimeout(doCall, 1000 * attempts);
          } else {
            if (showLoading) wx.hideLoading();
            reject(err);
          }
        }
      });
    };

    doCall();
  });
}

// Login
function login() {
  return callCloudFunction('login', {}, { loadingText: '登录中...' });
}

// Send chat message
function sendMessage(data) {
  // data: { messages: Array, sceneId: String, mode: String }
  return callCloudFunction('chat', data, {
    showLoading: false // Chat has its own loading indicator
  });
}

// Evaluate conversation
function evaluate(data) {
  // data: { conversationId: String, messages: Array, sceneId: String }
  return callCloudFunction('evaluate', data, {
    loadingText: '正在评估...',
    retry: 2
  });
}

// Speech to text (Tencent Cloud ASR)
function speechToText(data) {
  // data: { fileID: String }
  return callCloudFunction('speechRecognition', data, {
    loadingText: '识别中...',
    retry: 2
  });
}

// Text to speech (Tencent Cloud TTS)
function textToSpeech(data) {
  // data: { text: String }
  return callCloudFunction('textToSpeech', data, {
    showLoading: false
  });
}

// Voice chat - 语音直传AI对话（Qwen-Omni，不经ASR）
function voiceChat(data) {
  // data: { fileID, messages, sceneId, mode, difficulty, conversationId }
  return callCloudFunction('voiceChat', data, {
    showLoading: false,
    retry: 1,
    timeout: 120000  // 音频处理需要更长时间
  });
}

// Audio evaluate - 音频直传口语评估（Qwen-Omni）
function audioEvaluate(data) {
  // data: { audioFileID, messages, sceneId, mode, conversationId, duration }
  return callCloudFunction('evaluate', data, {
    loadingText: '正在评估发音...',
    retry: 2,
    timeout: 120000
  });
}

// Get user info
function getUserInfo() {
  return callCloudFunction('login', { action: 'getUserInfo' }, { showLoading: false });
}

// Save check-in record
function saveCheckin(data) {
  return callCloudFunction('login', { action: 'checkin', ...data }, {
    loadingText: '打卡中...'
  });
}

// Get conversation history list
function getConversationList(data) {
  // data: { page, pageSize, mode }
  return callCloudFunction('login', { action: 'getConversations', ...data }, {
    showLoading: false
  });
}

// Get conversation detail
function getConversationDetail(data) {
  // data: { conversationId }
  return callCloudFunction('login', { action: 'getConversationDetail', ...data }, {
    showLoading: true
  });
}

// Get checkin records
function getCheckinRecords(data) {
  // data: { year, month }
  return callCloudFunction('login', { action: 'getCheckinRecords', ...data }, {
    showLoading: false
  });
}

module.exports = {
  callCloudFunction,
  login,
  sendMessage,
  evaluate,
  speechToText,
  textToSpeech,
  voiceChat,
  audioEvaluate,
  getUserInfo,
  saveCheckin,
  getConversationList,
  getConversationDetail,
  getCheckinRecords
};
