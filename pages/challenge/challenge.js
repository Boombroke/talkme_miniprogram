const api = require('../../utils/api');
const { collectText } = require('../../utils/collection');
const { createPracticeTimer } = require('../../utils/practice-timer');
const { showToast } = require('../../utils/util');

Page({
  data: {
    stage: 'intro', // 'intro' | 'recording' | 'evaluating' | 'result' | 'leaderboard'
    dailyTopic: null,
    isRecording: false,
    recordTime: 0,
    evaluation: null,
    hasCompleted: false,
    leaderboard: [],
    myRank: null,
    playingTextId: ''
  },

  onLoad() {
    this._practiceTimer = createPracticeTimer({ mode: 'challenge' });
    this.loadDailyChallenge();
    this.loadLeaderboard();
  },

  onHide() {
    if (this._practiceTimer) this._practiceTimer.flushAndReport();
  },

  loadDailyChallenge() {
    const challenges = [
      { id: 1, topic: "Describe your morning routine in detail", zh: "详细描述你的早晨日常", timeLimit: 60, emoji: '🌅' },
      { id: 2, topic: "Explain why learning English is important to you", zh: "解释学英语对你为什么重要", timeLimit: 60, emoji: '🎯' },
      { id: 3, topic: "Recommend a movie and explain why people should watch it", zh: "推荐一部电影并说明理由", timeLimit: 90, emoji: '🎬' },
      { id: 4, topic: "Describe your hometown to a foreigner", zh: "向外国人描述你的家乡", timeLimit: 90, emoji: '🏙️' },
      { id: 5, topic: "What would you change about the education system?", zh: "你想改变教育系统的什么？", timeLimit: 90, emoji: '📚' },
      { id: 6, topic: "Tell a story about a funny thing that happened to you", zh: "讲一个发生在你身上的趣事", timeLimit: 90, emoji: '😂' },
      { id: 7, topic: "If you could have dinner with anyone, who and why?", zh: "如果可以和任何人共进晚餐，选谁？", timeLimit: 60, emoji: '🍽️' },
    ];
    const dayOfWeek = new Date().getDay();
    const today = challenges[dayOfWeek % challenges.length];

    // Check if already completed today
    const completedDate = wx.getStorageSync('challengeCompletedDate');
    const todayStr = new Date().toISOString().split('T')[0];
    const hasCompleted = completedDate === todayStr;

    this.setData({ dailyTopic: today, hasCompleted });
  },

  async loadLeaderboard() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'login',
        data: { action: 'getChallengeLeaderboard' }
      });
      if (res.result && res.result.leaderboard) {
        this.setData({ leaderboard: res.result.leaderboard });
      }
    } catch (e) {
      console.error('排行榜加载失败:', e);
    }
  },

  startChallenge() {
    if (this.data.hasCompleted) {
      showToast('今日挑战已完成');
      return;
    }

    const recorder = wx.getRecorderManager();
    this._recorder = recorder;

    recorder.onStop(async (res) => {
      if (this._unloaded) return;
      this.setData({ isRecording: false });
      this.evaluateChallenge(res.tempFilePath);
    });

    recorder.start({
      duration: (this.data.dailyTopic.timeLimit || 60) * 1000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 64000,
      format: 'mp3'
    });

    this.setData({ stage: 'recording', isRecording: true, recordTime: 0 });
    if (this._practiceTimer) this._practiceTimer.touch();
    this._timer = setInterval(() => {
      if (this._practiceTimer) this._practiceTimer.touch();
      const t = this.data.recordTime + 1;
      if (t >= this.data.dailyTopic.timeLimit) {
        this.stopRecording();
      } else {
        this.setData({ recordTime: t });
      }
    }, 1000);
  },

  stopRecording() {
    if (this._timer) clearInterval(this._timer);
    if (this._recorder) this._recorder.stop();
  },

  async evaluateChallenge(tempFilePath) {
    if (this._unloaded) return;
    this.setData({ stage: 'evaluating' });
    wx.showLoading({ title: '正在评估发音...' });

    try {
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: 'challenge/' + Date.now() + '.mp3',
        filePath: tempFilePath
      });

      // Qwen-Omni 音频直传评估 — 一步到位
      const res = await api.audioEvaluate({
        audioFileID: uploadRes.fileID,
        messages: [
          { role: 'assistant', content: 'Daily speaking challenge topic: "' + this.data.dailyTopic.topic + '". Please speak about this topic.' }
        ],
        mode: 'challenge'
      });

      wx.hideLoading();

      var evaluation = null;
      if (res && res.totalScore !== undefined) {
        const isZeroScore = res.totalScore === 0 || res.isDefault;
        evaluation = {
          relevance: isZeroScore ? 0 : ((res.vocabulary && res.vocabulary.score) || 70),
          grammar: isZeroScore ? 0 : ((res.grammar && res.grammar.score) || 70),
          vocabulary: isZeroScore ? 0 : ((res.vocabulary && res.vocabulary.score) || 70),
          fluency: isZeroScore ? 0 : ((res.fluency && res.fluency.score) || 70),
          overall: isZeroScore ? 0 : (res.totalScore || 70),
          feedback: (res.suggestions || []).join(' '),
          encouragement: res.encouragement || '继续加油！',
          spokenText: res.transcript || '[语音]'
        };
      }
      if (!evaluation) {
        evaluation = { relevance: 70, grammar: 70, vocabulary: 70, fluency: 70, overall: 70, feedback: 'Good try!', encouragement: '继续加油！', spokenText: '' };
      }

      // Save to cloud
      try {
        await wx.cloud.callFunction({
          name: 'login',
          data: {
            action: 'saveChallengeResult',
            score: evaluation.overall,
            date: new Date().toISOString().split('T')[0]
          }
        });
      } catch (e) { /* ignore save error */ }

      wx.setStorageSync('challengeCompletedDate', new Date().toISOString().split('T')[0]);

      this.setData({ stage: 'result', evaluation: evaluation, hasCompleted: true });
      this.loadLeaderboard();
    } catch (err) {
      wx.hideLoading();
      console.error('挑战评估失败:', err);
      showToast('评估失败');
      this.setData({ stage: 'intro' });
    }
  },

  showLeaderboard() {
    this.setData({ stage: 'leaderboard' });
  },

  async playText(e) {
    const text = e.currentTarget.dataset.text;
    const id = e.currentTarget.dataset.id;
    if (!text || this.data.playingTextId) return;

    this.setData({ playingTextId: id });

    try {
      const res = await api.textToSpeech({ text });
      if (res && res.fileID) {
        const urlRes = await wx.cloud.getTempFileURL({ fileList: [res.fileID] });
        if (urlRes.fileList && urlRes.fileList[0].tempFileURL) {
          if (this._audioCtx) {
            this._audioCtx.stop();
          } else {
            this._audioCtx = wx.createInnerAudioContext({ obeyMuteSwitch: false });
            this._audioCtx.onEnded(() => {
              this.setData({ playingTextId: '' });
            });
            this._audioCtx.onError(() => {
              this.setData({ playingTextId: '' });
              showToast('语音播放失败');
            });
          }
          this._audioCtx.src = urlRes.fileList[0].tempFileURL;
          this._audioCtx.play();
          return;
        }
      }
      throw new Error('获取音频失败');
    } catch (err) {
      console.error('播放失败:', err);
      this.setData({ playingTextId: '' });
      showToast('语音播放失败');
    }
  },

  async collectChallengeText(e) {
    const { text, role } = e.currentTarget.dataset;
    await collectText(text, '每日挑战', role);
  },

  backToResult() {
    this.setData({ stage: this.data.evaluation ? 'result' : 'intro' });
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  onUnload() {
    this._unloaded = true;
    if (this._timer) clearInterval(this._timer);
    if (this._recorder) {
      try { this._recorder.stop(); } catch (e) { /* ignore */ }
    }
    if (this._audioCtx) {
      try { this._audioCtx.destroy(); } catch (e) { /* ignore */ }
    }
    if (this._practiceTimer) this._practiceTimer.flushAndReport();
  }
});
