Component({
  properties: {
    score: {
      type: Number,
      value: 0
    },
    pronunciation: {
      type: Object,
      value: { score: 0, issues: [] }
    },
    grammar: {
      type: Object,
      value: { score: 0, issues: [] }
    },
    fluency: {
      type: Object,
      value: { score: 0, issues: [] }
    },
    vocabulary: {
      type: Object,
      value: { score: 0, issues: [] }
    },
    showDetail: {
      type: Boolean,
      value: false
    }
  },

  data: {
    expanded: false,
    animatedScore: 0,
    ringDashOffset: 565  // 2 * PI * 90 (circumference)
  },

  observers: {
    'score': function(score) {
      this.animateScore(score);
    }
  },

  methods: {
    animateScore(targetScore) {
      let current = 0;
      const step = Math.ceil(targetScore / 30);
      const timer = setInterval(() => {
        current += step;
        if (current >= targetScore) {
          current = targetScore;
          clearInterval(timer);
        }
        // Ring chart: circumference = 565, offset = 565 * (1 - score/100)
        const dashOffset = 565 * (1 - current / 100);
        this.setData({
          animatedScore: current,
          ringDashOffset: dashOffset
        });
      }, 30);
    },

    toggleDetail(e) {
      // Compatible with van-collapse (e.detail = array of active names) and plain tap
      if (e && e.detail && Array.isArray(e.detail)) {
        this.setData({ expanded: e.detail.length > 0 });
      } else {
        this.setData({ expanded: !this.data.expanded });
      }
    },

    getScoreColor(score) {
      if (score >= 80) return '#52C41A';
      if (score >= 60) return '#FAAD14';
      return '#FF4D4F';
    },

    getScoreLevel(score) {
      if (score >= 90) return '优秀';
      if (score >= 80) return '良好';
      if (score >= 60) return '一般';
      return '需加强';
    }
  }
});