const { showToast } = require('../../utils/util');
const api = require('../../utils/api');
const { collectText } = require('../../utils/collection');

Page({
  data: {
    evaluation: null,
    totalScore: 0,
    pronunciation: { score: 0, issues: [] },
    grammar: { score: 0, issues: [] },
    fluency: { score: 0, issues: [] },
    vocabulary: { score: 0, issues: [] },
    correctedSentence: '',
    suggestions: [],
    encouragement: '',
    sceneCompletion: null,
    bannerEmoji: '👏',
    playingText: '', // Tracks which text is currently playing or loading
    audioContext: null
  },

  onLoad(options) {
    if (options.data) {
      try {
        const evaluation = JSON.parse(decodeURIComponent(options.data));
        const totalScore = evaluation.totalScore || 0;
        const isDefault = evaluation.isDefault || false;
        let bannerEmoji = '👏';
        if (totalScore >= 80) bannerEmoji = '🎉';
        else if (totalScore < 60) bannerEmoji = '💪';

        let scoreLevel;
        if (totalScore >= 80) scoreLevel = 'excellent';
        else if (totalScore >= 60) scoreLevel = 'good';
        else if (totalScore >= 40) scoreLevel = 'average';
        else if (totalScore > 0) scoreLevel = 'poor';
        else scoreLevel = 'none';

        this.setData({
          evaluation,
          totalScore,
          isDefault,
          scoreLevel,
          pronunciation: evaluation.pronunciation || { score: 0, issues: [] },
          grammar: evaluation.grammar || { score: 0, issues: [] },
          fluency: evaluation.fluency || { score: 0, issues: [] },
          vocabulary: evaluation.vocabulary || { score: 0, issues: [] },
          correctedSentence: evaluation.correctedSentence || '',
          suggestions: evaluation.suggestions || [],
          encouragement: evaluation.encouragement || '继续加油！',
          sceneCompletion: evaluation.sceneCompletion || null,
          bannerEmoji
        });
      } catch (err) {
        console.error('解析评估数据失败:', err);
        showToast('加载评估结果失败');
      }
    }
  },

  onUnload() {
    if (this.data.audioContext) {
      this.data.audioContext.stop();
      this.data.audioContext.destroy();
    }
  },

  async playText(e) {
    const text = e.currentTarget.dataset.text;
    if (!text) return;
    this._playAudioForText(text);
  },

  async collectFeedback(e) {
    await collectText(e.currentTarget.dataset.text, 'Practice Feedback');
  },

  async replayCorrection() {
    if (this.data.correctedSentence) {
      this._playAudioForText(this.data.correctedSentence);
    }
  },

  async _playAudioForText(text) {
    if (this.data.playingText === text) {
      if (this.data.audioContext) {
        this.data.audioContext.stop();
        this.setData({ playingText: '' });
      }
      return;
    }

    if (this.data.audioContext) {
      this.data.audioContext.stop();
      this.data.audioContext.destroy();
    }

    this.setData({ playingText: text });

    try {
      const res = await api.textToSpeech({ text });
      if (res && res.fileID) {
        const urlRes = await wx.cloud.getTempFileURL({ fileList: [res.fileID] });
        if (urlRes.fileList && urlRes.fileList[0].tempFileURL) {
          const audioCtx = wx.createInnerAudioContext({ obeyMuteSwitch: false });
          this.setData({ audioContext: audioCtx });
          audioCtx.src = urlRes.fileList[0].tempFileURL;
          
          audioCtx.onPlay(() => {
            console.log('开始播放');
          });
          
          audioCtx.onEnded(() => {
            this.setData({ playingText: '' });
          });
          
          audioCtx.onError((err) => {
            console.error('播放失败:', err);
            this.setData({ playingText: '' });
            showToast('播放失败');
          });

          audioCtx.play();
        } else {
          throw new Error('获取音频URL失败');
        }
      } else {
        throw new Error('合成语音失败');
      }
    } catch (err) {
      console.error('TTS Error:', err);
      this.setData({ playingText: '' });
      showToast('语音加载失败');
    }
  },

  // Try again - go back to chat
  tryAgain() {
    wx.navigateBack();
  },

  // Go back to home
  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  // Share result
  onShareAppMessage() {
    return {
      title: `我在英语口语练习中获得了${this.data.totalScore}分！`,
      path: '/pages/index/index'
    };
  }
});
