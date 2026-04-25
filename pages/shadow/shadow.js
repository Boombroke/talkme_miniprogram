const api = require('../../utils/api');
const auth = require('../../utils/auth');
const { createPracticeTimer } = require('../../utils/practice-timer');
const { showToast, shuffleCopy, avoidRecentFirst } = require('../../utils/util');

Page({
  data: {
    stage: 'ready', // 'ready' | 'listening' | 'recording' | 'comparing' | 'result'
    sentences: [],
    currentIndex: 0,
    currentSentence: null,
    userText: '',
    similarity: 0,
    noSpeechDetected: false,
    roundResults: [],
    totalRounds: 5,
    isPlaying: false,
    isRecording: false,
    recordTime: 0,
    difficulty: 'intermediate',
    playingTTSId: null
  },

  onLoad(options) {
    this.data.difficulty = options.difficulty || wx.getStorageSync('difficultyLevel') || 'intermediate';
    this._audioCtx = null;
    this._feedbackAudio = null;
    this._practiceTimer = createPracticeTimer({ mode: 'shadow' });
    this.loadSentences();
  },

  onHide() {
    if (this._practiceTimer) this._practiceTimer.flushAndReport();
  },

  loadSentences() {
    const pool = {
      beginner: [
        "Hello, how are you today?",
        "I like to eat apples.",
        "The weather is very nice.",
        "My name is Tom.",
        "I go to school by bus.",
        "She has a beautiful cat.",
        "Can I have some water please?",
        "I am happy to see you."
      ],
      intermediate: [
        "I've been studying English for three years now.",
        "Could you tell me how to get to the nearest station?",
        "The conference has been postponed until next Friday.",
        "She suggested that we should try a different approach.",
        "I'm looking forward to hearing from you soon.",
        "Despite the rain, we decided to go for a walk.",
        "He's been working on this project since last month.",
        "Would you mind closing the window? It's a bit cold."
      ],
      advanced: [
        "The implications of artificial intelligence on society are far-reaching and multifaceted.",
        "Notwithstanding the economic downturn, the company managed to exceed its quarterly targets.",
        "The phenomenon can be attributed to a complex interplay of environmental and genetic factors.",
        "Had it not been for the timely intervention, the situation could have escalated dramatically.",
        "The unprecedented rate of technological advancement necessitates a fundamental shift in educational paradigms."
      ]
    };

    const diff = this.data.difficulty;
    let sentences = pool.intermediate;
    if (diff === 'beginner' || diff === 'elementary') sentences = pool.beginner;
    else if (diff === 'advanced') sentences = pool.advanced;

    const storageKey = 'shadow_last_first_' + diff;
    const shuffled = avoidRecentFirst(
      shuffleCopy(sentences).slice(0, this.data.totalRounds),
      storageKey
    );
    this.setData({
      sentences: shuffled,
      currentSentence: shuffled[0],
      currentIndex: 0
    });
  },

  async playSentence() {
    if (this.data.isPlaying) return;
    if (this._practiceTimer) this._practiceTimer.touch();
    this.setData({ stage: 'listening', isPlaying: true });

    try {
      const result = await api.textToSpeech({ text: this.data.currentSentence });
      if (result && result.fileID) {
        const { fileList } = await wx.cloud.getTempFileURL({ fileList: [result.fileID] });
        const tempUrl = fileList[0] && fileList[0].tempFileURL;
        if (tempUrl) {
          const audio = wx.createInnerAudioContext({ obeyMuteSwitch: false });
          this._audioCtx = audio;
          audio.src = tempUrl;
          audio.onEnded(() => {
            this.setData({ isPlaying: false, stage: 'recording' });
            audio.destroy();
            this._audioCtx = null;
            // Auto-start recording after playback
            this.startRecording();
          });
          audio.onError(() => {
            this.setData({ isPlaying: false });
            audio.destroy();
          });
          audio.play();
          return;
        }
      }
      this.setData({ isPlaying: false });
      showToast('播放失败');
    } catch (err) {
      this.setData({ isPlaying: false });
      console.error('TTS失败:', err);
    }
  },

  startRecording() {
    const recorder = wx.getRecorderManager();
    this._recorder = recorder;

    recorder.onStop(async (res) => {
      if (this._unloaded) return;
      this.setData({ isRecording: false });
      await this.compareResult(res.tempFilePath);
    });

    recorder.onError(() => {
      this.setData({ isRecording: false });
      showToast('录音失败');
    });

    recorder.start({
      duration: 15000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 64000,
      format: 'mp3'
    });

    this.setData({ isRecording: true, recordTime: 0 });
    if (this._practiceTimer) this._practiceTimer.touch();
    this._recordTimer = setInterval(() => {
      if (this._practiceTimer) this._practiceTimer.touch();
      this.setData({ recordTime: this.data.recordTime + 1 });
    }, 1000);
  },

  stopRecording() {
    if (this._recordTimer) clearInterval(this._recordTimer);
    if (this._recorder) this._recorder.stop();
  },

  async compareResult(tempFilePath) {
    if (this._unloaded) return;
    if (this._recordTimer) clearInterval(this._recordTimer);
    this.setData({ stage: 'comparing' });
    wx.showLoading({ title: '正在评估发音...' });

    try {
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: 'shadow/' + Date.now() + '.mp3',
        filePath: tempFilePath
      });

      // 调用 Qwen-Omni 音频评估 — 直接听录音评估发音相似度
      const res = await api.audioEvaluate({
        audioFileID: uploadRes.fileID,
        messages: [
          { role: 'assistant', content: 'Please repeat after me: "' + this.data.currentSentence + '"' }
        ],
        mode: 'shadow'
      });

      wx.hideLoading();

      // 从评估结果提取分数
      const userText = (res && res.transcript) || '[语音]';
      const similarity = (res && res.pronunciation && res.pronunciation.score) || (res && res.totalScore) || 0;

      const scoreClass = similarity >= 80 ? 'text-green' : (similarity >= 60 ? 'text-orange' : 'text-red');
      const roundResult = {
        original: this.data.currentSentence,
        spoken: userText,
        similarity,
        scoreClass,
        feedback: (res && res.suggestions) ? res.suggestions.join('; ') : ''
      };

      const roundResults = this.data.roundResults;
      roundResults.push(roundResult);

      const total = roundResults.reduce(function(a, r) { return a + r.similarity; }, 0);
      const averageSimilarity = Math.round(total / roundResults.length);

      this.setData({
        stage: 'result',
        userText,
        similarity,
        noSpeechDetected: similarity === 0,
        roundResults,
        averageSimilarity
      });
    } catch (err) {
      wx.hideLoading();
      console.error('评估失败:', err);
      showToast('评估失败');
      this.setData({ stage: 'ready' });
    }
  },

  retryCurrentSentence() {
    const results = this.data.roundResults;
    if (results.length > 0) {
      results.pop(); // Remove last result
    }
    this.setData({
      stage: 'ready',
      userText: '',
      similarity: 0,
      noSpeechDetected: false,
      roundResults: results,
      playingTTSId: null
    });
    if (this._feedbackAudio) {
      this._feedbackAudio.stop();
      this._feedbackAudio.destroy();
      this._feedbackAudio = null;
    }
  },

  async playFeedbackTTS(e) {
    const text = e.currentTarget.dataset.text;
    const type = e.currentTarget.dataset.type; // 'original' or 'feedback'
    
    if (!text) return;
    
    const targetId = type + '-' + this.data.currentIndex;
    
    // Stop if already playing this text
    if (this.data.playingTTSId === targetId) {
      if (this._feedbackAudio) {
        this._feedbackAudio.stop();
        this._feedbackAudio.destroy();
        this._feedbackAudio = null;
      }
      this.setData({ playingTTSId: null });
      return;
    }
    
    // Stop any current playing
    if (this._feedbackAudio) {
      this._feedbackAudio.stop();
      this._feedbackAudio.destroy();
      this._feedbackAudio = null;
    }
    
    this.setData({ playingTTSId: targetId });
    
    try {
      const result = await api.textToSpeech({ text });
      if (result && result.fileID) {
        const { fileList } = await wx.cloud.getTempFileURL({ fileList: [result.fileID] });
        const tempUrl = fileList[0] && fileList[0].tempFileURL;
        if (tempUrl) {
          const audio = wx.createInnerAudioContext({ obeyMuteSwitch: false });
          this._feedbackAudio = audio;
          audio.src = tempUrl;
          audio.onEnded(() => {
            if (this.data.playingTTSId === targetId) {
              this.setData({ playingTTSId: null });
            }
            audio.destroy();
            this._feedbackAudio = null;
          });
          audio.onError(() => {
            if (this.data.playingTTSId === targetId) {
              this.setData({ playingTTSId: null });
            }
            audio.destroy();
            this._feedbackAudio = null;
          });
          audio.play();
          return;
        }
      }
      this.setData({ playingTTSId: null });
      showToast('播放失败');
    } catch (err) {
      this.setData({ playingTTSId: null });
      console.error('TTS失败:', err);
    }
  },

  async collectSentence(e) {
    const content = (e.currentTarget.dataset.text || '').trim();
    if (!content) return;
    if (auth.requireAuth('收藏句子') !== 'allowed') return;

    try {
      await api.callCloudFunction('login', {
        action: 'addCollection',
        content,
        role: 'assistant',
        source: '影子跟读'
      }, {
        showLoading: false
      });
      showToast('收藏成功');
    } catch (err) {
      console.error('收藏失败:', err);
      showToast('收藏失败');
    }
  },

  nextRound() {
    const nextIdx = this.data.currentIndex + 1;
    if (nextIdx >= this.data.sentences.length) {
      this.setData({ stage: 'summary' });
      return;
    }
      this.setData({
        currentIndex: nextIdx,
        currentSentence: this.data.sentences[nextIdx],
        userText: '',
        similarity: 0,
        noSpeechDetected: false,
        stage: 'ready',
        playingTTSId: null
      });
      if (this._feedbackAudio) {
        this._feedbackAudio.stop();
        this._feedbackAudio.destroy();
        this._feedbackAudio = null;
      }
    },

  tryAgain() {
    this.setData({ roundResults: [], currentIndex: 0, stage: 'ready' });
    this.loadSentences();
  },

  goHome() { wx.switchTab({ url: '/pages/index/index' }); },

  onUnload() {
    this._unloaded = true;
    if (this._audioCtx) { this._audioCtx.stop(); this._audioCtx.destroy(); }
    if (this._feedbackAudio) { this._feedbackAudio.stop(); this._feedbackAudio.destroy(); }
    if (this._recordTimer) clearInterval(this._recordTimer);
    if (this._recorder) { try { this._recorder.stop(); } catch(e) {} }
    if (this._practiceTimer) this._practiceTimer.flushAndReport();
  }
});
