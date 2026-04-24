Component({
  properties: {
    checkinDates: {
      type: Array,
      value: []  // Array of 'YYYY-MM-DD' strings
    }
  },

  data: {
    year: 0,
    month: 0,
    days: [],
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    monthStr: ''
  },

  lifetimes: {
    attached() {
      const now = new Date();
      this.setMonth(now.getFullYear(), now.getMonth() + 1);
    }
  },

  observers: {
    'checkinDates': function() {
      if (this.data.year > 0) {
        this.generateDays();
      }
    }
  },

  methods: {
    setMonth(year, month) {
      this.setData({
        year,
        month,
        monthStr: `${year}年${month}月`
      });
      this.generateDays();
    },

    generateDays() {
      const { year, month, checkinDates } = this.data;
      const firstDay = new Date(year, month - 1, 1).getDay();
      const daysInMonth = new Date(year, month, 0).getDate();
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      const days = [];

      // Padding for first week
      for (let i = 0; i < firstDay; i++) {
        days.push({ day: '', empty: true });
      }

      // Actual days
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        days.push({
          day: d,
          date: dateStr,
          isToday: dateStr === todayStr,
          isCheckedIn: checkinDates.indexOf(dateStr) !== -1,
          isFuture: new Date(dateStr) > today,
          empty: false
        });
      }

      this.setData({ days });
    },

    prevMonth() {
      let { year, month } = this.data;
      month--;
      if (month < 1) {
        month = 12;
        year--;
      }
      this.setMonth(year, month);
      this.triggerEvent('monthchange', { year, month });
    },

    nextMonth() {
      let { year, month } = this.data;
      const now = new Date();
      // Cannot go to future months
      if (year >= now.getFullYear() && month >= now.getMonth() + 1) return;

      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
      this.setMonth(year, month);
      this.triggerEvent('monthchange', { year, month });
    },

    onDayTap(e) {
      const { date } = e.currentTarget.dataset;
      if (date) {
        this.triggerEvent('daytap', { date });
      }
    }
  }
});