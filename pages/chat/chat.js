const api = require('../../utils/api');
const auth = require('../../utils/auth');
const { createPracticeTimer } = require('../../utils/practice-timer');
const { showToast, showModal, generateId } = require('../../utils/util');

const SCENE_OPENERS = {
  coffee: "Hi there! Welcome to Morning Brew! ☕ What can I get started for you today?",
  interview: "Good morning, and welcome to TechVision. I'm Sarah from HR. Thanks for coming in — could you start by telling me a bit about yourself?",
  airport: "Hello! Welcome to the airport information desk. How can I help you today?",
  hotel: "Welcome to the Grand Harmony Hotel! Do you have a reservation with us?",
  doctor: "Good morning! Please have a seat. So, what brings you in to see me today?"
};

const FREE_CHAT_OPENER = "Hello! I'm your English conversation partner. Feel free to chat with me about anything. How are you doing today?";

// 不同场景/模式下 AI 的头像 emoji
const AI_AVATARS = {
  free: '🤖',
  coffee: '☕',
  interview: '💼',
  airport: '✈️',
  hotel: '🏨',
  doctor: '🩺'
};

Page({
  data: {
    mode: 'free',
    sceneId: '',
    sceneName: '',
    messages: [],
    inputText: '',
    inputMode: 'text',
    isLoading: false,
    isStreaming: false,
    scrollIntoView: '',
    conversationId: '',
    startTime: 0,
    playingMsgId: '',
    playState: 'idle',
    difficulty: 'intermediate',
    sceneProgress: 0,
    sceneTotalSteps: 5,
    userAvatarUrl: '',
    aiAvatarEmoji: '🤖'
  },

  onLoad(options) {
    this._audioCtx = null;
    this._lastAutoPlayedId = '';
    this._ttsCache = {};
    this._ttsCacheOrder = []; // Track insertion order for LRU

    const { mode = 'free', sceneId = '', sceneName = '', difficulty = 'intermediate' } = options;

    // 按页面职责区分 practiceLog 的 mode：自由对话 → chat，情景对话 → scene
    this._practiceTimer = createPracticeTimer({ mode: mode === 'scene' ? 'scene' : 'chat' });

    // 已登录用户显示微信头像，游客显示默认 😊（chat-bubble 里 fallback）
    const app = getApp();
    const userAvatarUrl =
      (app.globalData.isLoggedIn && app.globalData.userInfo && app.globalData.userInfo.avatarUrl) || '';

    // AI 头像：场景对话按 sceneId 取专属 emoji，自由对话用 🤖
    const aiAvatarEmoji = (mode === 'scene' && AI_AVATARS[sceneId]) || AI_AVATARS.free;

    this.setData({
      mode,
      sceneId,
      sceneName: decodeURIComponent(sceneName || ''),
      startTime: Date.now(),
      difficulty,
      userAvatarUrl,
      aiAvatarEmoji
    });

    if (mode === 'free') {
      wx.setNavigationBarTitle({ title: '自由对话' });
    } else {
      wx.setNavigationBarTitle({ title: decodeURIComponent(sceneName || '情景对话') });
    }

    if (mode === 'scene' && sceneId) {
      const opener = SCENE_OPENERS[sceneId] || 'Hello! Let\'s start our conversation. How can I help you today?';
      const msgId = this.addMessage('assistant', opener);
      this._lastAutoPlayedId = msgId;
      this.playTTS(msgId, opener);
    } else {
      const msgId = this.addMessage('assistant', FREE_CHAT_OPENER);
      this._lastAutoPlayedId = msgId;
      this.playTTS(msgId, FREE_CHAT_OPENER);
    }
  },

  onUnload() {
    this.stopTTS();
    this._ttsCache = {};
    this._ttsCacheOrder = [];
    if (this._practiceTimer) this._practiceTimer.flushAndReport();
  },

  onHide() {
    // 切到后台 / 跳出页面也先结算一次（避免 onUnload 拿不到准确 now）
    if (this._practiceTimer) this._practiceTimer.flushAndReport();
  },

  addMessage(role, content, extra = {}) {
    const { messages } = this.data;
    const msgId = 'msg-' + generateId();
    const newMsg = Object.assign({
      id: msgId,
      role,
      content,
      timestamp: new Date().toISOString(),
      isStreaming: false,
      type: 'text'
    }, extra);
    const idx = messages.length;
    messages.push(newMsg);
    this.setData({
      [`messages[${idx}]`]: newMsg,
      scrollIntoView: msgId
    });
    return msgId;
  },

  switchInputMode() {
    this.setData({
      inputMode: this.data.inputMode === 'text' ? 'voice' : 'text'
    });
  },

  onInput(e) {
    // Compatible with both native input (e.detail.value) and Vant Field (e.detail)
    const value = typeof e.detail === 'string' ? e.detail : (e.detail.value || '');
    this.setData({ inputText: value });
  },

  async sendTextMessage() {
    const { inputText, isLoading } = this.data;
    if (!inputText.trim() || isLoading) return;

    const text = inputText.trim();
    this.setData({ inputText: '' });

    if (this._practiceTimer) this._practiceTimer.touch();
    this.addMessage('user', text);
    await this.getAIReply(text);
  },

  async getAIReply(userText) {
    this.stopTTS();
    this.setData({ isLoading: true });

    // Add typing placeholder immediately
    const placeholderId = this.addMessage('assistant', '');
    const placeholderMessages = this.data.messages;
    const placeholderIdx = placeholderMessages.findIndex(m => m.id === placeholderId);
    if (placeholderIdx !== -1) {
      placeholderMessages[placeholderIdx].isTyping = true;
      this.setData({ [`messages[${placeholderIdx}].isTyping`]: true });
    }

    const history = this.data.messages
      .filter(m => m.id !== placeholderId)
      .map(m => ({
        role: m.role,
        content: m.content
      }));

    try {
      const res = await api.sendMessage({
        messages: history,
        sceneId: this.data.sceneId,
        mode: this.data.mode,
        conversationId: this.data.conversationId,
        difficulty: this.data.difficulty
      });

      if (res && res.reply) {
        let reply = res.reply;
        let correction = '';

        // Extract correction hint if present
        const correctionMatch = reply.match(/\[CORRECTION:\s*(.+?)\s*→\s*(.+?)\]/i);
        if (correctionMatch) {
          correction = correctionMatch[1].trim() + ' → ' + correctionMatch[2].trim();
          // Remove the correction tag from the displayed message
          reply = reply.replace(/\[CORRECTION:.*?\]/i, '').trim();
        }

        // Update the placeholder message with real content
        const messages = this.data.messages;
        const idx = messages.findIndex(m => m.id === placeholderId);
        if (idx !== -1) {
          messages[idx].content = reply;
          messages[idx].isTyping = false;
          messages[idx].isStreaming = true;
          this.setData({
            [`messages[${idx}].content`]: reply,
            [`messages[${idx}].isTyping`]: false,
            [`messages[${idx}].isStreaming`]: true,
            isStreaming: true
          });

          // Store correction on the message
          if (correction) {
            messages[idx].correction = correction;
            this.setData({ [`messages[${idx}].correction`]: correction });
          }
        }

        if (res.conversationId) {
          this.setData({ conversationId: res.conversationId });
        }

        // Update scene progress
        if (this.data.mode === 'scene') {
          const userMsgCount = this.data.messages.filter(m => m.role === 'user').length;
          const progress = Math.min(userMsgCount, 5);
          this.setData({ sceneProgress: progress });
        }

        // Auto-play TTS for new AI message
        this._lastAutoPlayedId = placeholderId;
        this.playTTS(placeholderId, reply);
      }
    } catch (err) {
      console.error('发送消息失败:', err);
      // Remove the typing placeholder on error
      const messages = this.data.messages;
      const placeholderErrIdx = messages.findIndex(m => m.id === placeholderId);
      if (placeholderErrIdx !== -1) {
        messages.splice(placeholderErrIdx, 1);
        this.setData({ messages });
      }
      // Mark the last user message as failed for retry
      const msgs = this.data.messages;
      const lastUserIdx = msgs.length - 1;
      if (lastUserIdx >= 0 && msgs[lastUserIdx].role === 'user') {
        msgs[lastUserIdx].sendFailed = true;
        this.setData({ [`messages[${lastUserIdx}].sendFailed`]: true });
      }
      showToast('发送失败，点击消息重试');
    } finally {
      this.setData({ isLoading: false });
    }
  },

  onStreamEnd() {
    this.setData({ isStreaming: false });
    const messages = this.data.messages;
    messages.forEach((m, i) => {
      if (m.isStreaming) {
        m.isStreaming = false;
        this.setData({ [`messages[${i}].isStreaming`]: false });
      }
    });
  },

  // TTS event from chat-bubble
  onTTS(e) {
    const { content, msgId } = e.detail;
    if (!content || !msgId) return;
    this.playTTS(msgId, content);
  },

  // Core TTS method - singleton audio, with cache
  async playTTS(msgId, content) {
    // Toggle: if same message is playing, stop it
    if (this.data.playingMsgId === msgId && this.data.playState === 'playing') {
      this.stopTTS();
      return;
    }

    // Stop any current playback
    this.stopTTS();

    this.setData({ playingMsgId: msgId, playState: 'loading' });

    try {
      let tempUrl = this._ttsCache[msgId];

      if (!tempUrl) {
        const result = await api.textToSpeech({ text: content });
        if (result && result.fileID) {
          const { fileList } = await wx.cloud.getTempFileURL({
            fileList: [result.fileID]
          });
          tempUrl = fileList[0] && fileList[0].tempFileURL;
          if (tempUrl) {
            this._ttsCache[msgId] = tempUrl;
            this._ttsCacheOrder.push(msgId);
            // LRU: keep only last 10
            if (this._ttsCacheOrder.length > 10) {
              const evict = this._ttsCacheOrder.shift();
              delete this._ttsCache[evict];
            }
          }
        }
      }

      if (!tempUrl) {
        this.setData({ playingMsgId: '', playState: 'idle' });
        return;
      }

      // Check if user toggled away while loading
      if (this.data.playingMsgId !== msgId) return;

      const audio = wx.createInnerAudioContext({ obeyMuteSwitch: false });
      this._audioCtx = audio;
      audio.src = tempUrl;

      audio.onPlay(() => {
        this.setData({ playState: 'playing' });
      });

      audio.onEnded(() => {
        this.setData({ playingMsgId: '', playState: 'idle' });
        audio.destroy();
        this._audioCtx = null;
      });

      audio.onError(() => {
        this.setData({ playingMsgId: '', playState: 'idle' });
        audio.destroy();
        this._audioCtx = null;
      });

      audio.play();
    } catch (err) {
      console.error('TTS失败:', err);
      this.setData({ playingMsgId: '', playState: 'idle' });
    }
  },

  stopTTS() {
    if (this._audioCtx) {
      this._audioCtx.stop();
      this._audioCtx.destroy();
      this._audioCtx = null;
    }
    this.setData({ playingMsgId: '', playState: 'idle' });
  },

  // Voice recording ended → upload to cloud → Qwen-Omni 一步处理（不经 ASR）
  async onRecordEnd(e) {
    const { tempFilePath, duration: recDurationMs = 0 } = e.detail || {};
    const userDurationSec = Math.max(1, Math.round((recDurationMs || 0) / 1000));

    if (this._practiceTimer) this._practiceTimer.touch();

    // 先添加一个语音消息占位（type: 'voice'，等 transcript 回来后再填 content）
    const userMsgId = this.addMessage('user', '', {
      type: 'voice',
      duration: userDurationSec,
      audioFileID: '',
      audioTempUrl: ''
    });

    // 添加 AI typing 占位（语音模式下 AI 也是 voice 气泡）
    const placeholderId = this.addMessage('assistant', '', {
      type: 'voice',
      duration: 0,
      audioTempUrl: ''
    });
    const messages = this.data.messages;
    const placeholderIdx = messages.findIndex(m => m.id === placeholderId);
    if (placeholderIdx !== -1) {
      messages[placeholderIdx].isTyping = true;
      this.setData({ [`messages[${placeholderIdx}].isTyping`]: true, isLoading: true });
    }

    try {
      // 上传录音到云存储
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: 'audio/' + Date.now() + '-' + Math.random().toString(36).substr(2, 6) + '.mp3',
        filePath: tempFilePath
      });

      // 把 audioFileID 写回到用户消息上（供语音气泡点击播放）
      {
        const msgs = this.data.messages;
        const uIdx = msgs.findIndex(m => m.id === userMsgId);
        if (uIdx !== -1) {
          msgs[uIdx].audioFileID = uploadRes.fileID;
          this.setData({ [`messages[${uIdx}].audioFileID`]: uploadRes.fileID });
        }
      }

      // 构建对话历史（排除占位消息）
      const history = this.data.messages
        .filter(m => m.id !== userMsgId && m.id !== placeholderId)
        .map(m => ({ role: m.role, content: m.content }));

      // 调用 voiceChat 云函数 — 音频直传 Qwen-Omni
      const res = await api.voiceChat({
        fileID: uploadRes.fileID,
        messages: history,
        sceneId: this.data.sceneId,
        mode: this.data.mode,
        difficulty: this.data.difficulty,
        conversationId: this.data.conversationId
      });

      if (res && res.reply) {
        // 更新用户消息：填入识别出的文字（供"转文字"按钮展开显示）
        const userText = res.userText || '';
        {
          const msgs = this.data.messages;
          const userIdx = msgs.findIndex(m => m.id === userMsgId);
          if (userIdx !== -1) {
            msgs[userIdx].content = userText;
            this.setData({ [`messages[${userIdx}].content`]: userText });
          }
        }

        // 更新 AI 回复
        let reply = res.reply;
        let correction = '';
        const correctionMatch = reply.match(/\[CORRECTION:\s*(.+?)\s*→\s*(.+?)\]/i);
        if (correctionMatch) {
          correction = correctionMatch[1].trim() + ' → ' + correctionMatch[2].trim();
          reply = reply.replace(/\[CORRECTION:.*?\]/i, '').trim();
        }

        // 粗略估算 AI 语音时长（英文 ~15 字符/秒 TTS）
        const aiDuration = Math.max(1, Math.min(60, Math.round(reply.length / 15)));

        {
          const msgs = this.data.messages;
          const aiIdx = msgs.findIndex(m => m.id === placeholderId);
          if (aiIdx !== -1) {
            msgs[aiIdx].content = reply;
            msgs[aiIdx].isTyping = false;
            msgs[aiIdx].isStreaming = false; // 语音气泡不跑打字机动画
            msgs[aiIdx].duration = aiDuration;
            this.setData({
              [`messages[${aiIdx}].content`]: reply,
              [`messages[${aiIdx}].isTyping`]: false,
              [`messages[${aiIdx}].isStreaming`]: false,
              [`messages[${aiIdx}].duration`]: aiDuration
            });
            if (correction) {
              msgs[aiIdx].correction = correction;
              this.setData({ [`messages[${aiIdx}].correction`]: correction });
            }
          }
        }

        if (res.conversationId) {
          this.setData({ conversationId: res.conversationId });
        }

        // 预取 AI 语音气泡的 TTS 临时 URL（让"🔊 点击播放"可用；同时自动播放一次）
        try {
          const ttsRes = await api.textToSpeech({ text: reply });
          if (ttsRes && ttsRes.fileID) {
            const { fileList } = await wx.cloud.getTempFileURL({ fileList: [ttsRes.fileID] });
            const aiAudioUrl = fileList && fileList[0] && fileList[0].tempFileURL;
            if (aiAudioUrl) {
              // 缓存到共享的 _ttsCache，这样点击气泡再次播放时可复用
              this._ttsCache[placeholderId] = aiAudioUrl;
              this._ttsCacheOrder.push(placeholderId);
              if (this._ttsCacheOrder.length > 10) {
                const evict = this._ttsCacheOrder.shift();
                delete this._ttsCache[evict];
              }
              const msgs = this.data.messages;
              const aiIdx = msgs.findIndex(m => m.id === placeholderId);
              if (aiIdx !== -1) {
                msgs[aiIdx].audioTempUrl = aiAudioUrl;
                this.setData({ [`messages[${aiIdx}].audioTempUrl`]: aiAudioUrl });
              }
            }
          }
        } catch (ttsErr) {
          console.warn('预取 AI 语音失败（不影响文字展示）:', ttsErr);
        }

        // Auto-play TTS（语音对话保持自动播放以获得自然对话体验）
        this._lastAutoPlayedId = placeholderId;
        this.playTTS(placeholderId, reply);
      } else {
        // 失败：移除占位
        this._removeMessage(userMsgId);
        this._removeMessage(placeholderId);
        showToast('语音处理失败，请重试');
      }
    } catch (err) {
      console.error('语音对话失败:', err);
      this._removeMessage(userMsgId);
      this._removeMessage(placeholderId);
      showToast('语音对话失败，请重试');
    } finally {
      this.setData({ isLoading: false });
    }
  },

  _removeMessage(msgId) {
    const messages = this.data.messages;
    const idx = messages.findIndex(m => m.id === msgId);
    if (idx !== -1) {
      messages.splice(idx, 1);
      this.setData({ messages });
    }
  },

  async onTranslate(e) {
    const { content, msgId } = e.detail;
    if (!content || !msgId) return;

    try {
      const res = await api.sendMessage({
        messages: [
          { role: 'user', content: `Please translate the following English text to Chinese. Return ONLY the Chinese translation, nothing else:\n\n${content}` }
        ],
        mode: 'translate'  // 内部用途，不入 conversation 集合
      });

      if (res && res.reply) {
        const messages = this.data.messages;
        const idx = messages.findIndex(m => m.id === msgId);
        if (idx !== -1) {
          messages[idx].translatedText = res.reply;
          this.setData({ [`messages[${idx}].translatedText`]: res.reply });
        }
      }
    } catch (err) {
      console.error('翻译失败:', err);
      showToast('翻译失败，请重试');
    }
  },

  async onCollectMessage(e) {
    const { content, role } = e.detail;
    if (!content) return;
    if (auth.requireAuth('收藏句子') !== 'allowed') return;

    try {
      await api.callCloudFunction('login', {
        action: 'addCollection',
        content,
        role,
        source: this.data.mode === 'scene' ? this.data.sceneName : '自由对话'
      }, {
        showLoading: false
      });
      showToast('收藏成功 ⭐');
    } catch (err) {
      console.error('收藏失败:', err);
      showToast('收藏失败');
    }
  },

  onRetryMessage(e) {
    const { msgId } = e.detail;
    const messages = this.data.messages;
    const idx = messages.findIndex(m => m.id === msgId);
    if (idx === -1 || messages[idx].role !== 'user') return;

    // Clear failed state
    messages[idx].sendFailed = false;
    this.setData({ [`messages[${idx}].sendFailed`]: false });

    // Retry sending
    this.getAIReply(messages[idx].content);
  },

  async endConversation() {
    const { messages } = this.data;
    if (messages.length < 2) {
      showToast('对话太短，请多说几句');
      return;
    }

    // 游客也可以走评估（消耗试用额度或已用过直接拦），但保存入库要求已登录
    if (auth.requireAuth('对话评估') !== 'allowed') return;

    const confirm = await showModal('结束对话', '结束对话后将进行口语评估，确定要结束吗？');
    if (!confirm) return;

    this.stopTTS();
    wx.showLoading({ title: '正在评估...' });

    try {
      const history = messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      const res = await api.evaluate({
        conversationId: this.data.conversationId,
        messages: history,
        sceneId: this.data.sceneId,
        mode: this.data.mode,
        duration: Math.floor((Date.now() - this.data.startTime) / 1000)
      });

      wx.hideLoading();

      const evalData = encodeURIComponent(JSON.stringify(res));
      wx.redirectTo({
        url: '/pages/result/result?data=' + evalData
      });
    } catch (err) {
      wx.hideLoading();
      console.error('评估失败:', err);
      showToast('评估失败，请重试');
    }
  }
});
