const auth = require('../../../utils/auth');

Page({
  data: {
    sceneId: '',
    sceneName: '',
    scene: null,
    sceneDetails: {
      coffee: {
        name: '咖啡店点单',
        nameEn: 'Coffee Shop Ordering',
        icon: '☕',
        difficulty: '初级',
        aiRole: '咖啡店店员 (Barista)',
        description: '你走进了一家名为"Morning Brew"的咖啡店，需要点一杯饮品和一些食物。店员会热情地接待你，帮你推荐菜单上的热门饮品。',
        tips: [
          'Can I get a... / I\'d like to order...',
          'What do you recommend?',
          'How much is that?',
          'Can I have it to go?'
        ],
        vocabulary: ['latte', 'espresso', 'croissant', 'medium', 'to go', 'whipped cream']
      },
      interview: {
        name: '求职面试',
        nameEn: 'Job Interview',
        icon: '💼',
        difficulty: '中级',
        aiRole: '面试官 (Interviewer)',
        description: '你正在参加一家科技公司的英语面试。面试官会问你关于工作经验、技能和职业规划的问题。保持自信，用完整的句子回答。',
        tips: [
          'I have X years of experience in...',
          'My greatest strength is...',
          'I am passionate about...',
          'In five years, I see myself...'
        ],
        vocabulary: ['qualification', 'achievement', 'teamwork', 'leadership', 'deadline', 'challenge']
      },
      airport: {
        name: '机场问路',
        nameEn: 'Airport Navigation',
        icon: '✈️',
        difficulty: '初级',
        aiRole: '机场工作人员 (Airport Staff)',
        description: '你在一个国际机场，需要找到登机口、办理行李托运或询问航班信息。机场工作人员会帮助你。',
        tips: [
          'Excuse me, where is gate...?',
          'How do I get to...?',
          'Is this the right way to...?',
          'What time does the flight board?'
        ],
        vocabulary: ['boarding pass', 'gate', 'terminal', 'baggage claim', 'customs', 'departure']
      },
      hotel: {
        name: '酒店入住',
        nameEn: 'Hotel Check-in',
        icon: '🏨',
        difficulty: '初级',
        aiRole: '酒店前台 (Receptionist)',
        description: '你到达了预订的酒店，需要办理入住手续。前台服务员会确认你的预订信息，并告诉你房间号和早餐时间。',
        tips: [
          'I have a reservation under...',
          'I\'d like to check in, please.',
          'What time is breakfast?',
          'Is there Wi-Fi available?'
        ],
        vocabulary: ['reservation', 'check-in', 'room key', 'single/double room', 'amenities', 'checkout']
      },
      doctor: {
        name: '看病就医',
        nameEn: 'Seeing a Doctor',
        icon: '🏥',
        difficulty: '中级',
        aiRole: '医生 (Doctor)',
        description: '你感觉身体不适，去诊所看医生。你需要向医生描述你的症状，回答医生的问题，并了解治疗方案。',
        tips: [
          'I\'ve been feeling...',
          'The pain is in my...',
          'It started about... ago.',
          'Do I need to take any medicine?'
        ],
        vocabulary: ['symptom', 'fever', 'headache', 'prescription', 'allergy', 'appointment']
      }
    }
  },

  onLoad(options) {
    const { id, name } = options;
    const scene = this.data.sceneDetails[id];
    if (scene) {
      this.setData({
        sceneId: id,
        sceneName: decodeURIComponent(name || scene.name),
        scene
      });
      wx.setNavigationBarTitle({ title: scene.name });
    }
  },

  startChat() {
    if (auth.requireAuth('情景对话', { allowTrial: true }) === 'blocked') return;
    const { sceneId, sceneName } = this.data;
    wx.navigateTo({
      url: `/pages/chat/chat?mode=scene&sceneId=${sceneId}&sceneName=${encodeURIComponent(sceneName)}`
    });
  }
});
