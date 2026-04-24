Page({
  data: {
    scenes: [
      {
        id: 'coffee',
        name: '咖啡店点单',
        nameEn: 'Coffee Shop',
        desc: '在咖啡店点饮品和食物',
        icon: '☕',
        difficulty: '初级',
        difficultyLevel: 1,
        aiRole: '咖啡店店员',
        bgColor: '#FFF3E0'
      },
      {
        id: 'interview',
        name: '求职面试',
        nameEn: 'Job Interview',
        desc: '模拟英语工作面试',
        icon: '💼',
        difficulty: '中级',
        difficultyLevel: 2,
        aiRole: '面试官',
        bgColor: '#E3F2FD'
      },
      {
        id: 'airport',
        name: '机场问路',
        nameEn: 'At the Airport',
        desc: '在机场询问登机口、行李等',
        icon: '✈️',
        difficulty: '初级',
        difficultyLevel: 1,
        aiRole: '机场工作人员',
        bgColor: '#E8F5E9'
      },
      {
        id: 'hotel',
        name: '酒店入住',
        nameEn: 'Hotel Check-in',
        desc: '办理酒店入住手续',
        icon: '🏨',
        difficulty: '初级',
        difficultyLevel: 1,
        aiRole: '酒店前台',
        bgColor: '#F3E5F5'
      },
      {
        id: 'doctor',
        name: '看病就医',
        nameEn: 'Seeing a Doctor',
        desc: '向医生描述症状',
        icon: '🏥',
        difficulty: '中级',
        difficultyLevel: 2,
        aiRole: '医生',
        bgColor: '#FFEBEE'
      }
    ]
  },

  onLoad() {},

  goToDetail(e) {
    const { id } = e.currentTarget.dataset;
    const scene = this.data.scenes.find(s => s.id === id);
    if (scene) {
      wx.navigateTo({
        url: `/pages/scene/detail/detail?id=${scene.id}&name=${encodeURIComponent(scene.name)}`
      });
    }
  }
});
