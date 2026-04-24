const api = require('../../utils/api');
const { createPracticeTimer } = require('../../utils/practice-timer');
const { showToast } = require('../../utils/util');

// 每档难度的语法点（模型从中随机挑一个考）
const GRAMMAR_POINTS = {
  beginner: [
    'simple present tense', 'simple past tense (regular verbs)',
    'be-verb conjugation (am/is/are/was/were)',
    'articles (a / an / the)', 'plural nouns', 'subject-verb agreement',
    'personal pronouns (I/you/he/she/it/we/they)',
    'possessive adjectives (my/your/his/her)',
    'this / that / these / those'
  ],
  elementary: [
    'past tense with irregular verbs',
    'present continuous (be + V-ing)',
    'going to (future plans)',
    'modal verbs can / must / should',
    'comparatives and superlatives',
    'common prepositions of time (at/in/on)',
    'common prepositions of place',
    'adverbs of frequency (always/usually/often/sometimes/never)',
    'there is / there are',
    'countable vs uncountable + quantifiers (some/any/much/many)'
  ],
  // intermediate 要加难：上位语法结构，不考单纯 have + pp
  intermediate: [
    'present perfect vs present perfect continuous',
    'past perfect (had + past participle)',
    'passive voice including perfect passive (has been done / had been done)',
    'first conditional (if + present, will)',
    'second conditional (if + past, would)',
    'reported speech with tense backshift',
    'defining relative clauses (who/which/that)',
    'non-defining relative clauses (with commas)',
    'relative clauses with preposition fronting (the book about which...)',
    'gerund vs infinitive (distinguishing meanings: stop to do vs stop doing)',
    'used to + base form vs would + base form (past habits)',
    'modals of deduction (must/might/can\'t have + past participle)'
  ],
  // advanced 大幅加难：C1-C2 复杂形式，句长 18-30 词，至少一个嵌套从句
  advanced: [
    'third conditional (if + past perfect, would have + past participle)',
    'mixed conditionals (past condition → present result, or reverse)',
    'inversion after negative adverbials (Never had I... / Only then did... / Hardly had... when...)',
    'inversion in conditionals (Had I known, Were I to know, Should you need)',
    'subjunctive mood (I wish / if only / it\'s (high) time / I\'d rather)',
    'cleft sentences with it (It was X that...)',
    'cleft sentences with what (What I need is...)',
    'participle clauses as adverbials (Having finished..., Being asked...)',
    'causative have / get (have something done / get something done)',
    'complex passive (He is said / believed / thought to have + past participle)',
    'ellipsis and substitution (so do I / neither does she)',
    'emphatic do / does / did (I do believe...)',
    'advanced relative clauses with quantifiers (all of whom / some of which)'
  ]
};

// 随机话题池 —— 让题目上下文多样化，避开千篇一律的 she goes to school
const TOPIC_POOL = [
  'travel abroad', 'remote work', 'online learning', 'climate change',
  'social media addiction', 'a job interview', 'a cooking class',
  'public transport', 'a music concert', 'a movie premiere',
  'startup business', 'volunteer work', 'a family reunion',
  'a sports match', 'shopping online', 'healthy lifestyle',
  'a scientific discovery', 'a historical event', 'learning a new skill',
  'debating technology ethics'
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// 跨会话预取缓存：按难度分桶，下次 onLoad 秒显示
const WARM_STORAGE_KEY = 'grammar_warm_question';

function loadWarmQuestion(difficulty) {
  try {
    const raw = wx.getStorageSync(WARM_STORAGE_KEY);
    if (raw && raw.difficulty === difficulty && raw.question) {
      // 取出后立刻清掉，避免下次重复看到同一题
      wx.removeStorageSync(WARM_STORAGE_KEY);
      return raw.question;
    }
  } catch (e) { /* ignore */ }
  return null;
}

function saveWarmQuestion(difficulty, question) {
  if (!question) return;
  try {
    wx.setStorageSync(WARM_STORAGE_KEY, { difficulty, question, savedAt: Date.now() });
  } catch (e) { /* ignore */ }
}

Page({
  data: {
    stage: 'loading', // 'loading' | 'question' | 'checking' | 'result' | 'summary'
    currentQuestion: null,
    userAnswer: '',
    canSubmit: false,
    // 多空填空题专用：句子按 ___ 切分出的文本片段 + 每个空的答案
    sentenceSegments: [],
    blankAnswers: [],
    isFillBlank: false,
    questionIndex: 0,
    totalQuestions: 5,
    score: 0,
    results: [],
    difficulty: 'intermediate',
    inputMode: 'text',
    currentResult: null
  },

  onLoad(options) {
    this.data.difficulty = options.difficulty || wx.getStorageSync('difficultyLevel') || 'intermediate';
    // 预取缓存 + 答题节奏追踪
    this._preloaded = [];
    this._prefetching = false;
    this._questionShownAt = 0;
    this._answerTimes = [];
    this._practiceTimer = createPracticeTimer({ mode: 'grammar' });

    // 尝试使用上次会话预留的题目 → 点开即有题
    const warm = loadWarmQuestion(this.data.difficulty);
    if (warm) {
      this._showQuestion(warm);
      // 立即后台预取新一题（答完这道就能无感切）
      this._prefetchIfNeeded();
    } else {
      this.generateQuestion();
    }
  },

  onHide() {
    if (this._practiceTimer) this._practiceTimer.flushAndReport();
    // 把预取队列头写入 storage，供下次 onLoad 秒开
    this._persistWarmQuestion();
  },

  onUnload() {
    if (this._practiceTimer) this._practiceTimer.flushAndReport();
    this._persistWarmQuestion();
  },

  // 把当前预取队列里的一道题存到 storage 给下次会话用
  _persistWarmQuestion() {
    if (this._preloaded && this._preloaded.length > 0) {
      saveWarmQuestion(this.data.difficulty, this._preloaded[0]);
    }
  },

  // 根据最近答题速度决定预取深度：快的用户 → 2，慢 → 1
  _cacheDepth() {
    if (this._answerTimes.length < 2) return 1;
    const avg = this._answerTimes.reduce((a, b) => a + b, 0) / this._answerTimes.length;
    return avg < 15000 ? 2 : 1;
  },

  // 构造 grammar 题生成 prompt；每次都掺入随机 seed + 话题 + 禁重复提示
  _buildPrompt() {
    const diffTag = {
      beginner: 'A1 beginner',
      elementary: 'A2 elementary',
      intermediate: 'B1-B2 intermediate (upper-intermediate, lean harder)',
      advanced: 'C1-C2 advanced (genuinely challenging, not textbook-easy)'
    }[this.data.difficulty] || 'B1-B2 intermediate';

    const points = GRAMMAR_POINTS[this.data.difficulty] || GRAMMAR_POINTS.intermediate;
    const chosenPoint = pickRandom(points); // 本地先挑一个，强制多样性
    const topic = pickRandom(TOPIC_POOL);
    const seed = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

    return [
      'Task: generate ONE English grammar exercise. Output JSON only.',
      `Learner level: ${diffTag}.`,
      `Grammar point to test (use exactly this, not something easier): ${chosenPoint}.`,
      `Context topic (for vocabulary/scenario, make the sentence about this): ${topic}.`,
      `Randomness seed (vary output): ${seed}.`,
      'Exercise type: pick ONE at random from:',
      '  (a) fill-blank — sentence with ___ showing where learner writes the answer (often with verb in parentheses to conjugate, e.g. "She (go) ___ ...")',
      '  (b) error-correction — a sentence with ONE grammar error; learner must write the corrected full sentence',
      '  (c) sentence-transformation — a correct sentence + instruction to rewrite it (e.g. "Rewrite in the passive", "Make it a second conditional")',
      'Hard constraints:',
      '- Do NOT use overused textbook examples like "She goes to school", "The cat sat on the mat", "I have a pen", "She went to school yesterday".',
      '- Vocabulary and situation must reflect the context topic above.',
      '- Difficulty must match the level — if learner level is advanced/intermediate, the sentence should be 14-30 words with at least one subordinate clause.',
      '- Exactly ONE grammar issue per exercise.',
      'Respond with ONLY this JSON (no prose, no markdown fences):',
      '{"type":"fill-blank|error-correction|sentence-transformation","instruction":"<short English instruction>","sentence":"<what the learner sees>","answer":"<expected answer>","explanation":"<1-2 English sentences explaining the rule>","hint":"<grammar point label, e.g. Third Conditional>"}'
    ].join('\n');
  },

  // 真正发请求，拿到一道题 —— Promise 不拒绝，失败 resolve null 让调用方兜底
  _fetchQuestion() {
    const prompt = this._buildPrompt();
    return api.sendMessage({
      messages: [{ role: 'user', content: prompt }],
      mode: 'grammar'  // 非 free/scene → 不入 conversation 集合
    }).then((res) => {
      if (!res || !res.reply) return null;
      try {
        const m = res.reply.match(/\{[\s\S]*\}/);
        if (!m) return null;
        const q = JSON.parse(m[0]);
        if (!q || !q.sentence || !q.answer) return null;
        return q;
      } catch (e) {
        console.error('解析题目失败:', e);
        return null;
      }
    }).catch((err) => {
      console.error('生成题目失败:', err);
      return null;
    });
  },

  // 懒预取：按当前 cacheDepth 补齐队列；失败静默
  _prefetchIfNeeded() {
    if (this._prefetching) return;
    const depth = this._cacheDepth();
    if (this._preloaded.length >= depth) return;
    this._prefetching = true;
    this._fetchQuestion().then((q) => {
      this._prefetching = false;
      if (q) this._preloaded.push(q);
      // 若仍未满（depth 变大 / 还差 1 道），继续补
      if (this._preloaded.length < this._cacheDepth()) {
        this._prefetchIfNeeded();
      }
    });
  },

  // 首题 / 兜底路径：同步取题（有 loading 态）
  generateQuestion() {
    const that = this;
    this.setData({ stage: 'loading' });
    this._fetchQuestion().then((q) => {
      const question = q || that._fallbackQuestion();
      that._showQuestion(question);
      // 首题一上屏就开始预取下一题
      that._prefetchIfNeeded();
    });
  },

  // 无感切题：优先用预取队列，失败再兜底
  _goNextQuestion() {
    const that = this;
    if (this._preloaded.length > 0) {
      const next = this._preloaded.shift();
      this._showQuestion(next);
      // 立刻补充预取
      this._prefetchIfNeeded();
    } else {
      // 预取没赶上 —— 退回同步
      this.generateQuestion();
    }
  },

  _showQuestion(question) {
    this._questionShownAt = Date.now();
    if (this._practiceTimer) this._practiceTimer.touch();

    const isFillBlank = question && question.type === 'fill-blank';
    let sentenceSegments = [];
    let blankAnswers = [];

    if (isFillBlank && question.sentence) {
      // 按 ___ (1 个或多个下划线) 切分句子，中间插入空格输入框
      sentenceSegments = question.sentence.split(/_{2,}/);
      const blankCount = Math.max(0, sentenceSegments.length - 1);
      blankAnswers = new Array(blankCount).fill('');
    }

    this.setData({
      stage: 'question',
      currentQuestion: question,
      userAnswer: '',
      canSubmit: false,
      isFillBlank: isFillBlank && sentenceSegments.length > 1, // 句子里必须真有 ___ 才算
      sentenceSegments,
      blankAnswers
    });
  },

  // 多空填空输入
  onBlankInput(e) {
    const idx = parseInt(e.currentTarget.dataset.idx, 10);
    const value = e.detail && e.detail.value != null ? e.detail.value : '';
    const blankAnswers = this.data.blankAnswers.slice();
    blankAnswers[idx] = value;
    // 所有空都非空才允许提交
    const allFilled = blankAnswers.every(s => s && s.trim());
    this.setData({
      blankAnswers,
      canSubmit: allFilled
    });
  },

  _fallbackQuestion() {
    // 最后兜底，按当前难度给一道不同难度的本地题
    const map = {
      beginner: {
        type: 'fill-blank',
        instruction: 'Fill in the blank with the correct form.',
        sentence: 'My brother ___ (play) football every Saturday.',
        answer: 'plays',
        explanation: 'Simple present, 3rd person singular → verb + s.',
        hint: 'Simple Present'
      },
      elementary: {
        type: 'fill-blank',
        instruction: 'Fill in the blank with the correct past form.',
        sentence: 'We ___ (go) to the new cafe yesterday and ___ (try) their cheesecake.',
        answer: 'went, tried',
        explanation: 'Simple past: irregular go→went, regular try→tried.',
        hint: 'Simple Past'
      },
      intermediate: {
        type: 'error-correction',
        instruction: 'Find and correct the grammar error in this sentence.',
        sentence: 'If I would have known about the traffic, I will have left home earlier.',
        answer: 'If I had known about the traffic, I would have left home earlier.',
        explanation: 'Third conditional: if + past perfect, would have + past participle.',
        hint: 'Third Conditional'
      },
      advanced: {
        type: 'sentence-transformation',
        instruction: 'Rewrite the sentence using inversion starting with "Not only".',
        sentence: 'She not only missed the deadline but also blamed the team for it.',
        answer: 'Not only did she miss the deadline but she also blamed the team for it.',
        explanation: 'Negative-adverbial inversion: Not only + auxiliary + subject + bare verb.',
        hint: 'Inversion'
      }
    };
    return map[this.data.difficulty] || map.intermediate;
  },

  onInput(e) {
    const value = typeof e.detail === 'string' ? e.detail : (e.detail.value || '');
    this.setData({
      userAnswer: value,
      canSubmit: !!value.trim()
    });
  },

  // 规范化：小写、trim、压缩空白、去首尾标点
  _normalize(s) {
    return String(s || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[.,;:!?"'“”‘’]+$/g, '')
      .replace(/^[.,;:!?"'“”‘’]+/g, '');
  },

  // 严格判分 fallback：LLM 失败或 feedback 缺失时使用
  // 规则：规范化后精确相等；多答案以逗号分隔，按段比对
  _strictCheck(userAnswer, correctAnswer) {
    const ua = this._normalize(userAnswer);
    const ca = this._normalize(correctAnswer);
    if (!ua || !ca) return false;
    if (ua === ca) return true;
    // 多答案（如 "went, tried"）：按逗号切
    if (ca.indexOf(',') !== -1) {
      const uaParts = ua.split(',').map(s => s.trim());
      const caParts = ca.split(',').map(s => s.trim());
      if (uaParts.length !== caParts.length) return false;
      for (let i = 0; i < caParts.length; i++) {
        if (uaParts[i] !== caParts[i]) return false;
      }
      return true;
    }
    return false;
  },

  submitAnswer() {
    const that = this;
    const currentQuestion = this.data.currentQuestion;
    if (this._practiceTimer) this._practiceTimer.touch();

    // 多空填空题：拼接各空答案为 "a, b, c"（符合 _strictCheck 的逗号切分约定）
    let userAnswer;
    if (this.data.isFillBlank) {
      const filled = this.data.blankAnswers.every(s => s && s.trim());
      if (!filled) {
        showToast('请填完所有空');
        return;
      }
      userAnswer = this.data.blankAnswers.map(s => s.trim()).join(', ');
      // 同步回 userAnswer 方便结果页展示
      this.setData({ userAnswer });
    } else {
      userAnswer = this.data.userAnswer;
      if (!userAnswer.trim()) {
        showToast('请先输入答案');
        return;
      }
    }

    // 记录答题耗时（用于调整预取深度）
    if (this._questionShownAt) {
      const dt = Date.now() - this._questionShownAt;
      this._answerTimes.push(dt);
      if (this._answerTimes.length > 3) this._answerTimes.shift();
    }

    this.setData({ stage: 'checking' });

    // 先跑本地严格匹配：如果精确等于，直接判对不走 LLM
    const localCorrect = this._strictCheck(userAnswer, currentQuestion.answer);
    if (localCorrect) {
      return this._handleResult(true, 'Correct!');
    }

    api.sendMessage({
      messages: [
        { role: 'user', content:
          'You are a strict English grammar grader. Judge whether the student answer is grammatically correct and matches the intended structure.\n\n' +
          'Exercise type: ' + (currentQuestion.type || 'fill-blank') + '\n' +
          'Question sentence: ' + currentQuestion.sentence + '\n' +
          'Expected answer: ' + currentQuestion.answer + '\n' +
          'Student answer: ' + userAnswer.trim() + '\n\n' +
          'Rules for judging:\n' +
          '1. BE STRICT. If the student answer contains ANY grammar error, or omits the required grammar structure (e.g. question asks for inversion and student did not invert), mark it FALSE.\n' +
          '2. Only accept truly equivalent variants: contractions (I have = I\'ve), acceptable word-order alternatives that preserve the same grammar structure, or alternative correct forms (e.g. "have to" vs "must" if both fit).\n' +
          '3. Spelling mistakes in the answer = incorrect.\n' +
          '4. Missing articles / wrong tense / wrong form = incorrect.\n' +
          '5. If the student answer is empty, irrelevant, or just repeats the question = incorrect.\n\n' +
          'Output ONLY a JSON object with this shape (no prose, no markdown):\n' +
          '{"correct": <true or false>, "feedback": "<one sentence in English explaining why, mention the specific error if wrong>"}'
        }
      ],
      mode: 'grammar'
    }).then((res) => {
      let parsed = null;
      if (res && res.reply) {
        try {
          const m = res.reply.match(/\{[\s\S]*\}/);
          if (m) parsed = JSON.parse(m[0]);
        } catch (e) {
          console.error('解析检查结果失败:', e);
        }
      }

      if (parsed && typeof parsed.correct === 'boolean') {
        const feedback = parsed.feedback || (parsed.correct ? 'Correct!' : 'The expected answer is: ' + currentQuestion.answer);
        that._handleResult(parsed.correct, feedback);
      } else {
        // LLM 返回解析失败 → 只信严格匹配（本地已判过 localCorrect=false，所以这里是错）
        that._handleResult(false, 'The expected answer is: ' + currentQuestion.answer);
      }
    }).catch((err) => {
      console.error('检查答案失败:', err);
      // 网络失败：用严格本地匹配（这里 localCorrect 已经是 false，所以算错）
      that._handleResult(false, 'The expected answer is: ' + currentQuestion.answer);
    });
  },

  _handleResult(isCorrect, feedback) {
    const results = this.data.results.slice();

    // 组装用户答案用于结果页展示：多空题优先用 blankAnswers 拼接（setData 异步，直接读 this.data.userAnswer 可能还是旧值）
    let userAnswerDisplay;
    if (this.data.isFillBlank && this.data.blankAnswers && this.data.blankAnswers.length) {
      userAnswerDisplay = this.data.blankAnswers.map(s => String(s || '').trim()).join(', ');
    } else {
      userAnswerDisplay = String(this.data.userAnswer || '').trim();
    }

    const newResult = {
      question: this.data.currentQuestion,
      userAnswer: userAnswerDisplay,
      isCorrect,
      feedback
    };
    results.push(newResult);
    const newScore = this.data.score + (isCorrect ? 20 : 0);
    const newIndex = this.data.questionIndex + 1;
    this.setData({
      stage: 'result',
      results,
      score: newScore,
      questionIndex: newIndex,
      currentResult: newResult
    });
  },

  nextQuestion() {
    if (this.data.questionIndex >= this.data.totalQuestions) {
      this.setData({ stage: 'summary' });
      return;
    }
    this._goNextQuestion();
  },

  tryAgain() {
    this._preloaded = [];
    this._answerTimes = [];
    this._prefetching = false;
    this.setData({
      questionIndex: 0,
      score: 0,
      results: [],
      stage: 'loading',
      currentResult: null
    });
    this.generateQuestion();
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});
