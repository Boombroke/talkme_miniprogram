const api = require('../../utils/api');
const { createPracticeTimer } = require('../../utils/practice-timer');
const { showToast, generateId } = require('../../utils/util');

Page({
  data: {
    stage: 'pick', // 'pick' | 'prep' | 'recording' | 'evaluating' | 'result'
    topics: [],
    currentTopic: null,
    prepCountdown: 30,
    recordCountdown: 120,
    isRecording: false,
    evaluation: null,
    difficulty: 'intermediate',
    playingTextId: ''
  },

  onLoad(options) {
    this.data.difficulty = options.difficulty || wx.getStorageSync('difficultyLevel') || 'intermediate';
    this._practiceTimer = createPracticeTimer({ mode: 'topic' });
    this.loadTopics();
  },

  onHide() {
    if (this._practiceTimer) this._practiceTimer.flushAndReport();
  },

  loadTopics() {
    const allTopics = [
      // Beginner
      { id: 'b1', text: 'Describe your daily routine', zh: '描述你的日常作息', difficulty: 'beginner', emoji: '🌅' },
      { id: 'b2', text: 'Talk about your favorite food', zh: '聊聊你最喜欢的食物', difficulty: 'beginner', emoji: '🍕' },
      { id: 'b3', text: 'Describe your family members', zh: '描述你的家人', difficulty: 'beginner', emoji: '👨‍👩‍👧' },
      { id: 'b4', text: 'What do you do on weekends?', zh: '周末你一般做什么？', difficulty: 'beginner', emoji: '🎮' },
      // Intermediate
      { id: 'm1', text: 'Describe a memorable travel experience', zh: '描述一次难忘的旅行', difficulty: 'intermediate', emoji: '✈️' },
      { id: 'm2', text: 'Talk about a book or movie that changed your perspective', zh: '谈一本改变你观点的书或电影', difficulty: 'intermediate', emoji: '📚' },
      { id: 'm3', text: 'Describe a challenge you overcame', zh: '描述你克服的一个挑战', difficulty: 'intermediate', emoji: '💪' },
      { id: 'm4', text: 'What would you do if you won the lottery?', zh: '如果你中了彩票会做什么？', difficulty: 'intermediate', emoji: '💰' },
      { id: 'm5', text: 'Describe your ideal job and why', zh: '描述你理想的工作及原因', difficulty: 'intermediate', emoji: '💼' },
      // Advanced
      { id: 'a1', text: 'Should social media be regulated by governments?', zh: '政府应该监管社交媒体吗？', difficulty: 'advanced', emoji: '📱' },
      { id: 'a2', text: 'Discuss the impact of AI on employment', zh: '讨论AI对就业的影响', difficulty: 'advanced', emoji: '🤖' },
      { id: 'a3', text: 'Is remote work the future? Argue your position', zh: '远程办公是未来吗？阐述你的立场', difficulty: 'advanced', emoji: '🏠' },
      { id: 'a4', text: 'Compare education systems across cultures', zh: '对比不同文化的教育体系', difficulty: 'advanced', emoji: '🎓' },
    ];
    // Filter by current difficulty or show all
    const diff = this.data.difficulty;
    var filtered = allTopics;
    if (diff === 'beginner') filtered = allTopics.filter(function(t) { return t.difficulty === 'beginner'; });
    else if (diff === 'advanced') filtered = allTopics.filter(function(t) { return ['intermediate', 'advanced'].indexOf(t.difficulty) !== -1; });
    else filtered = allTopics.filter(function(t) { return ['beginner', 'intermediate'].indexOf(t.difficulty) !== -1; });
    
    // Shuffle and pick 4
    var shuffled = filtered.sort(function() { return Math.random() - 0.5; }).slice(0, 4);
    this.setData({ topics: shuffled });
  },

  pickTopic(e) {
    var id = e.currentTarget.dataset.id;
    var topic = this.data.topics.find(function(t) { return t.id === id; });
    if (!topic) return;
    if (this._practiceTimer) this._practiceTimer.touch();
    this.setData({ currentTopic: topic, stage: 'prep', prepCountdown: 30 });
    this.startPrepTimer();
  },

  startPrepTimer() {
    var that = this;
    this._prepTimer = setInterval(function() {
      var c = that.data.prepCountdown - 1;
      if (c <= 0) {
        clearInterval(that._prepTimer);
        that.setData({ prepCountdown: 0 });
      } else {
        that.setData({ prepCountdown: c });
      }
    }, 1000);
  },

  startRecording() {
    if (this._prepTimer) clearInterval(this._prepTimer);
    
    var that = this;
    var recorderManager = wx.getRecorderManager();
    this._recorder = recorderManager;
    this._tempFilePath = '';

    recorderManager.onStop(function(res) {
      if (that._unloaded) return;
      that._tempFilePath = res.tempFilePath;
      if (that.data.stage === 'recording') {
        that.submitRecording();
      }
    });

    recorderManager.onError(function(err) {
      console.error('录音错误:', err);
      showToast('录音失败');
      that.setData({ stage: 'pick', isRecording: false });
    });

    recorderManager.start({
      duration: 120000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 64000,
      format: 'mp3',
      frameSize: 1
    });

    this.setData({ stage: 'recording', isRecording: true, recordCountdown: 120 });
    if (this._practiceTimer) this._practiceTimer.touch();
    this._recordTimer = setInterval(function() {
      if (that._practiceTimer) that._practiceTimer.touch();
      var c = that.data.recordCountdown - 1;
      if (c <= 0) {
        that.stopRecording();
      } else {
        that.setData({ recordCountdown: c });
      }
    }, 1000);
  },

  stopRecording() {
    if (this._recordTimer) clearInterval(this._recordTimer);
    if (this._recorder) {
      this._recorder.stop();
    }
    this.setData({ isRecording: false });
  },

  async submitRecording() {
    if (this._unloaded) return;
    this.setData({ stage: 'evaluating' });
    wx.showLoading({ title: '正在评估发音...' });

    try {
      // 上传录音
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: 'topic/' + Date.now() + '-' + Math.random().toString(36).substr(2, 6) + '.mp3',
        filePath: this._tempFilePath
      });

      // 直接用 Qwen-Omni 音频评估 — 一步到位
      const res = await api.audioEvaluate({
        audioFileID: uploadRes.fileID,
        messages: [
          { role: 'assistant', content: 'Topic: "' + this.data.currentTopic.text + '". Please speak about this topic in English.' }
        ],
        mode: 'topic'
      });

      wx.hideLoading();

      var evaluation = null;
      if (res && res.totalScore !== undefined) {
        const isZeroScore = res.totalScore === 0 || res.isDefault;
        // 从音频评估结果映射为话题评估格式
        evaluation = {
          topicRelevance: isZeroScore ? 0 : ((res.vocabulary && res.vocabulary.score) || 70),
          grammar: isZeroScore ? 0 : ((res.grammar && res.grammar.score) || 70),
          vocabulary: isZeroScore ? 0 : ((res.vocabulary && res.vocabulary.score) || 70),
          fluency: isZeroScore ? 0 : ((res.fluency && res.fluency.score) || 70),
          overall: isZeroScore ? 0 : (res.totalScore || 70),
          feedback: (res.suggestions || []).join(' '),
          tips: res.suggestions || ['Keep practicing'],
          encouragement: res.encouragement || '继续加油！',
          spokenText: res.transcript || '[语音]'
        };
      }

      if (!evaluation) {
        evaluation = { topicRelevance: 70, grammar: 70, vocabulary: 70, fluency: 70, overall: 70, feedback: 'Good attempt!', tips: ['Keep practicing'], encouragement: '继续加油！', spokenText: '' };
      }

      this.setData({ stage: 'result', evaluation: evaluation });
    } catch (err) {
      wx.hideLoading();
      console.error('评估失败:', err);
      showToast('评估失败，请重试');
      this.setData({ stage: 'prep' });
    }
  },

  tryAgain() {
    if (this._innerAudioContext) {
      this._innerAudioContext.stop();
    }
    this.setData({ stage: 'pick', currentTopic: null, evaluation: null, playingTextId: '' });
    this.loadTopics();
  },

  goHome() {
    if (this._innerAudioContext) {
      this._innerAudioContext.stop();
    }
    wx.switchTab({ url: '/pages/index/index' });
  },

  async playText(e) {
    const id = e.currentTarget.dataset.id;
    const text = e.currentTarget.dataset.text;
    if (!text) return;

    if (this.data.playingTextId === id) {
      // If currently playing the same id, stop it
      if (this._innerAudioContext) {
        this._innerAudioContext.stop();
      }
      this.setData({ playingTextId: '' });
      return;
    }

    // Stop any existing playback
    if (this._innerAudioContext) {
      this._innerAudioContext.stop();
    }

    this.setData({ playingTextId: id });

    try {
      const res = await api.textToSpeech({ text });
      if (!res.fileID) throw new Error('TTS failed');

      const tempRes = await wx.cloud.getTempFileURL({
        fileList: [res.fileID]
      });
      const audioUrl = tempRes.fileList[0].tempFileURL;

      if (!this._innerAudioContext) {
        this._innerAudioContext = wx.createInnerAudioContext({ obeyMuteSwitch: false });
        this._innerAudioContext.onEnded(() => {
          this.setData({ playingTextId: '' });
        });
        this._innerAudioContext.onError((err) => {
          console.error('Audio play error:', err);
          this.setData({ playingTextId: '' });
          showToast('播放失败');
        });
        this._innerAudioContext.onStop(() => {
          this.setData({ playingTextId: '' });
        });
      }

      this._innerAudioContext.src = audioUrl;
      this._innerAudioContext.play();

    } catch (err) {
      console.error('TTS error:', err);
      this.setData({ playingTextId: '' });
      showToast('获取语音失败');
    }
  },

  onUnload() {
    this._unloaded = true;
    if (this._prepTimer) clearInterval(this._prepTimer);
    if (this._recordTimer) clearInterval(this._recordTimer);
    if (this._recorder) {
      try { this._recorder.stop(); } catch(e) {}
    }
    if (this._innerAudioContext) {
      this._innerAudioContext.destroy();
    }
    if (this._practiceTimer) this._practiceTimer.flushAndReport();
  }
});
