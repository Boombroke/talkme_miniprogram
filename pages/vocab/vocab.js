const api = require('../../utils/api');
const { createPracticeTimer } = require('../../utils/practice-timer');
const { showToast } = require('../../utils/util');

Page({
  data: {
    stage: 'card', // 'card' | 'practice' | 'checking' | 'feedback' | 'summary'
    words: [],
    currentIndex: 0,
    currentWord: null,
    showMeaning: false,
    userSentence: '',
    canSubmitSentence: false,
    feedback: null,
    results: [],
    totalWords: 6,
    difficulty: 'intermediate'
  },

  onLoad(options) {
    this.data.difficulty = options.difficulty || wx.getStorageSync('difficultyLevel') || 'intermediate';
    this._practiceTimer = createPracticeTimer({ mode: 'vocab' });
    this.loadWords();
  },

  onHide() {
    if (this._practiceTimer) this._practiceTimer.flushAndReport();
  },

  onUnload() {
    if (this._practiceTimer) this._practiceTimer.flushAndReport();
  },

  loadWords() {
    const pool = {
      beginner: [
        { word: 'delicious', phonetic: '/dɪˈlɪʃəs/', meaning: '美味的', example: 'This cake is delicious!', pos: 'adj' },
        { word: 'adventure', phonetic: '/ədˈventʃər/', meaning: '冒险', example: 'We had a great adventure.', pos: 'n' },
        { word: 'curious', phonetic: '/ˈkjʊriəs/', meaning: '好奇的', example: 'The cat is very curious.', pos: 'adj' },
        { word: 'celebrate', phonetic: '/ˈselɪbreɪt/', meaning: '庆祝', example: 'We celebrate birthdays.', pos: 'v' },
        { word: 'journey', phonetic: '/ˈdʒɜːrni/', meaning: '旅程', example: 'It was a long journey.', pos: 'n' },
        { word: 'improve', phonetic: '/ɪmˈpruːv/', meaning: '改善', example: 'I want to improve my English.', pos: 'v' },
        { word: 'enormous', phonetic: '/ɪˈnɔːrməs/', meaning: '巨大的', example: 'The building is enormous.', pos: 'adj' },
        { word: 'discover', phonetic: '/dɪˈskʌvər/', meaning: '发现', example: 'She discovered a new café.', pos: 'v' },
      ],
      intermediate: [
        { word: 'versatile', phonetic: '/ˈvɜːrsətaɪl/', meaning: '多才多艺的', example: 'She is a versatile musician.', pos: 'adj' },
        { word: 'ambiguous', phonetic: '/æmˈbɪɡjuəs/', meaning: '模棱两可的', example: 'His answer was ambiguous.', pos: 'adj' },
        { word: 'resilient', phonetic: '/rɪˈzɪliənt/', meaning: '有韧性的', example: 'Children are resilient.', pos: 'adj' },
        { word: 'elaborate', phonetic: '/ɪˈlæbərət/', meaning: '详细阐述', example: 'Could you elaborate on that?', pos: 'v' },
        { word: 'substantial', phonetic: '/səbˈstænʃəl/', meaning: '大量的', example: 'A substantial amount of work.', pos: 'adj' },
        { word: 'inevitable', phonetic: '/ɪnˈevɪtəbl/', meaning: '不可避免的', example: 'Change is inevitable.', pos: 'adj' },
        { word: 'compromise', phonetic: '/ˈkɑːmprəmaɪz/', meaning: '妥协', example: 'They reached a compromise.', pos: 'n/v' },
        { word: 'advocate', phonetic: '/ˈædvəkeɪt/', meaning: '提倡', example: 'She advocates for equality.', pos: 'v' },
      ],
      advanced: [
        { word: 'ubiquitous', phonetic: '/juːˈbɪkwɪtəs/', meaning: '无处不在的', example: 'Smartphones are ubiquitous.', pos: 'adj' },
        { word: 'ephemeral', phonetic: '/ɪˈfemərəl/', meaning: '短暂的', example: 'Fame can be ephemeral.', pos: 'adj' },
        { word: 'juxtapose', phonetic: '/ˈdʒʌkstəpoʊz/', meaning: '并列对比', example: 'The artist juxtaposes light and dark.', pos: 'v' },
        { word: 'pragmatic', phonetic: '/præɡˈmætɪk/', meaning: '务实的', example: 'A pragmatic approach to the problem.', pos: 'adj' },
        { word: 'exacerbate', phonetic: '/ɪɡˈzæsərbeɪt/', meaning: '加剧', example: 'Stress can exacerbate the condition.', pos: 'v' },
        { word: 'quintessential', phonetic: '/ˌkwɪntɪˈsenʃəl/', meaning: '典型的', example: 'A quintessential British experience.', pos: 'adj' },
      ]
    };

    const diff = this.data.difficulty;
    let words = pool.intermediate;
    if (diff === 'beginner' || diff === 'elementary') words = pool.beginner;
    else if (diff === 'advanced') words = pool.advanced;

    const shuffled = words.sort(() => Math.random() - 0.5).slice(0, this.data.totalWords);
    this.setData({
      words: shuffled,
      currentWord: shuffled[0],
      currentIndex: 0,
      showMeaning: false,
      userSentence: '',
      canSubmitSentence: false,
      feedback: null
    });
  },

  toggleMeaning() {
    this.setData({ showMeaning: !this.data.showMeaning });
  },

  startPractice() {
    this.setData({ stage: 'practice', userSentence: '', canSubmitSentence: false });
  },

  onInput(e) {
    const value = typeof e.detail === 'string' ? e.detail : (e.detail.value || '');
    this.setData({
      userSentence: value,
      canSubmitSentence: value.trim().length > 0
    });
  },

  async submitSentence() {
    const { userSentence, currentWord } = this.data;
    if (!userSentence.trim()) { showToast('请输入造句'); return; }
    if (this._practiceTimer) this._practiceTimer.touch();

    this.setData({ stage: 'checking' });

    let feedback = null;
    try {
      const res = await api.sendMessage({
        messages: [
          { role: 'user', content: `Word: "${currentWord.word}" (${currentWord.meaning})\nStudent's sentence: "${userSentence.trim()}"\n\nJudge: Is the word used correctly in the sentence? Check grammar too. Respond JSON:\n{"correct":true,"naturalness":85,"feedback":"brief feedback","betterVersion":"improved sentence if needed"}` }
        ],
        mode: 'vocab'  // 非 free/scene → 不入 conversation 集合
      });
      if (res && res.reply) {
        const jsonMatch = res.reply.match(/\{[\s\S]*\}/);
        if (jsonMatch) feedback = JSON.parse(jsonMatch[0]);
      }
    } catch(e) {}

    if (!feedback) {
      feedback = { correct: true, naturalness: 70, feedback: 'Good try!', betterVersion: '' };
    }

    const result = { word: currentWord, userSentence: userSentence.trim(), feedback };
    const results = this.data.results;
    results.push(result);

    const correctCount = results.filter(function(r) { return r.feedback && r.feedback.correct; }).length;
    this.setData({ stage: 'feedback', feedback, results, correctCount });
  },

  nextWord() {
    if (this._practiceTimer) this._practiceTimer.touch();
    const nextIdx = this.data.currentIndex + 1;
    if (nextIdx >= this.data.words.length) {
      this.setData({ stage: 'summary' });
      return;
    }
    this.setData({
      currentIndex: nextIdx,
      currentWord: this.data.words[nextIdx],
      showMeaning: false,
      userSentence: '',
      canSubmitSentence: false,
      feedback: null,
      stage: 'card'
    });
  },

  tryAgain() {
    this.setData({
      results: [],
      currentIndex: 0,
      showMeaning: false,
      userSentence: '',
      canSubmitSentence: false,
      feedback: null,
      correctCount: 0,
      stage: 'card'
    });
    this.loadWords();
  },

  goHome() { wx.switchTab({ url: '/pages/index/index' }); }
});
