Component({
  properties: {
    role: {
      type: String,
      value: 'user'
    },
    content: {
      type: String,
      value: ''
    },
    msgId: {
      type: String,
      value: ''
    },
    isStreaming: {
      type: Boolean,
      value: false
    },
    playingMsgId: {
      type: String,
      value: ''
    },
    playState: {
      type: String,
      value: 'idle' // 'idle' | 'loading' | 'playing'
    },
    sendFailed: {
      type: Boolean,
      value: false
    },
    translatedText: {
      type: String,
      value: ''
    },
    correction: {
      type: String,
      value: ''
    },
    isTyping: {
      type: Boolean,
      value: false
    },
    // Voice message properties
    type: {
      type: String,
      value: 'text' // 'text' | 'voice'
    },
    audioFileID: {
      type: String,
      value: ''
    },
    duration: {
      type: Number,
      value: 0
    },
    audioTempUrl: {
      type: String,
      value: ''
    },
    // 用户微信头像 URL（登录后由父组件传入）；为空则显示默认 😊
    userAvatarUrl: {
      type: String,
      value: ''
    },
    // AI 头像 emoji（按场景不同：coffee=☕ interview=💼 ...，自由对话默认 🤖）
    aiAvatarEmoji: {
      type: String,
      value: '🤖'
    }
  },

  data: {
    displayContent: '',
    isPlaying: false,
    isLoading: false,
    audioLabel: '播放',
    showTranslation: false,
    translating: false,
    // Voice state
    isVoicePlaying: false,
    showTranscript: false,
    voiceWidth: 160,
    showMenu: false
  },

  observers: {
    'content, isStreaming': function(content, isStreaming) {
      if (isStreaming && content) {
        this.startStreamAnimation(content);
      } else {
        this.setData({ displayContent: content });
      }
    },
    'translatedText': function(val) {
      if (val) {
        this.setData({ translating: false, showTranslation: true });
      }
    },
    'playingMsgId, playState, msgId': function(playingMsgId, playState, msgId) {
      const isThis = playingMsgId === msgId && !!msgId;
      const isPlaying = isThis && playState === 'playing';
      const isLoading = isThis && playState === 'loading';
      const audioLabel = isLoading ? '加载中' : (isPlaying ? '播放中' : '播放');
      // For voice-type AI bubbles, reflect parent playingMsgId in the wave animation too
      const updates = { isPlaying, isLoading, audioLabel };
      if (this.properties.type === 'voice' && this.properties.role === 'assistant') {
        updates.isVoicePlaying = isPlaying;
      }
      this.setData(updates);
    },
    'duration': function(duration) {
      const d = Number(duration) || 0;
      const voiceWidth = Math.min(400, Math.max(140, 140 + d * 20));
      this.setData({ voiceWidth });
    }
  },

  lifetimes: {
    detached() {
      if (this._streamTimer) {
        clearInterval(this._streamTimer);
      }
      if (this._voiceAudioCtx) {
        try { this._voiceAudioCtx.stop(); this._voiceAudioCtx.destroy(); } catch (e) {}
        this._voiceAudioCtx = null;
      }
    }
  },

  methods: {
    startStreamAnimation(content) {
      if (this._streamTimer) clearInterval(this._streamTimer);

      let index = 0;
      this.setData({ displayContent: '' });

      this._streamTimer = setInterval(() => {
        if (index < content.length) {
          // Batch: advance 3-5 chars per tick to reduce setData calls
          const step = Math.min(3 + Math.floor(Math.random() * 3), content.length - index);
          index += step;
          this.setData({ displayContent: content.substring(0, index) });
        } else {
          clearInterval(this._streamTimer);
          this._streamTimer = null;
          this.triggerEvent('streamend');
        }
      }, 50); // Slightly longer interval since we advance more chars
    },

    onTapTTS() {
      this.triggerEvent('tts', {
        content: this.properties.content,
        msgId: this.properties.msgId
      });
    },

    onRetry() {
      this.triggerEvent('retry', { msgId: this.properties.msgId });
    },

    onLongPress() {
      if (this.properties.isTyping || this.properties.isStreaming || !this.properties.content) {
        return;
      }
      this.setData({ showMenu: true });
    },

    closeMenu() {
      if (this.data.showMenu) {
        this.setData({ showMenu: false });
      }
    },

    onMenuTap() {},

    onMenuTTS() {
      this.closeMenu();
      this.onTapTTS();
    },

    onMenuTranslate() {
      this.closeMenu();
      this.onTapTranslate();
    },

    onMenuCollect() {
      this.closeMenu();
      this.triggerEvent('collect', {
        content: this.properties.content,
        role: this.properties.role,
        msgId: this.properties.msgId
      });
    },

    onMenuCopy() {
      this.closeMenu();
      wx.setClipboardData({ data: this.properties.content || '' });
    },

    onTapTranslate() {
      if (this.data.showTranslation) {
        this.setData({ showTranslation: false });
        return;
      }
      if (this.properties.translatedText) {
        this.setData({ showTranslation: true });
        return;
      }
      if (!this.properties.content) {
        // Transcript not yet available (e.g. user voice still being recognized)
        wx.showToast({ title: '内容尚未就绪', icon: 'none' });
        return;
      }
      this.setData({ translating: true });
      this.triggerEvent('translate', {
        content: this.properties.content,
        msgId: this.properties.msgId
      });
    },

    onTapTranscript() {
      this.setData({ showTranscript: !this.data.showTranscript });
    },

    // Play / stop voice audio (user's recording OR AI TTS)
    async onTapVoice() {
      // Toggle stop if currently playing
      if (this.data.isVoicePlaying) {
        this.stopVoice();
        return;
      }

      // For AI voice bubbles, delegate to parent so the shared playTTS pipeline handles it
      // (parent manages singleton playback + playingMsgId/playState).
      if (this.properties.role === 'assistant') {
        this.triggerEvent('tts', {
          content: this.properties.content,
          msgId: this.properties.msgId
        });
        return;
      }

      // User voice: resolve cloud fileID → temp URL locally
      let tempUrl = this.properties.audioTempUrl;
      if (!tempUrl && this.properties.audioFileID) {
        try {
          const { fileList } = await wx.cloud.getTempFileURL({
            fileList: [this.properties.audioFileID]
          });
          tempUrl = fileList && fileList[0] && fileList[0].tempFileURL;
        } catch (err) {
          console.error('获取语音临时链接失败:', err);
          wx.showToast({ title: '语音加载失败', icon: 'none' });
          return;
        }
      }

      if (!tempUrl) {
        wx.showToast({ title: '语音不可用', icon: 'none' });
        return;
      }

      this.stopVoice();

      const audio = wx.createInnerAudioContext({ obeyMuteSwitch: false });
      this._voiceAudioCtx = audio;
      audio.src = tempUrl;

      audio.onPlay(() => {
        this.setData({ isVoicePlaying: true });
      });
      audio.onEnded(() => {
        this.setData({ isVoicePlaying: false });
        try { audio.destroy(); } catch (e) {}
        this._voiceAudioCtx = null;
      });
      audio.onError(() => {
        this.setData({ isVoicePlaying: false });
        try { audio.destroy(); } catch (e) {}
        this._voiceAudioCtx = null;
      });
      audio.onStop(() => {
        this.setData({ isVoicePlaying: false });
      });

      audio.play();
    },

    stopVoice() {
      if (this._voiceAudioCtx) {
        try { this._voiceAudioCtx.stop(); this._voiceAudioCtx.destroy(); } catch (e) {}
        this._voiceAudioCtx = null;
      }
      if (this.data.isVoicePlaying) {
        this.setData({ isVoicePlaying: false });
      }
    }
  }
});
