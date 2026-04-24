Component({
  properties: {
    disabled: {
      type: Boolean,
      value: false
    }
  },

  data: {
    isRecording: false,
    recordTime: 0,
    hasPermission: false,
    waveData: [0, 0, 0, 0, 0, 0, 0, 0]
  },

  lifetimes: {
    attached() {
      this.recorderManager = wx.getRecorderManager();
      this._waveData = [0, 0, 0, 0, 0, 0, 0, 0];

      // Collect volume data for waveform visualization
      this.recorderManager.onFrameRecorded((res) => {
        if (res.frameBuffer && this.data.isRecording) {
          const volume = Math.min(res.frameBuffer.byteLength / 500, 1);
          this._waveData.shift();
          this._waveData.push(volume);
          this.setData({ waveData: [...this._waveData] });
        }
      });

      this.recorderManager.onStart(() => {
        this._waveData = [0, 0, 0, 0, 0, 0, 0, 0];
        this.setData({ isRecording: true, recordTime: 0, waveData: [0, 0, 0, 0, 0, 0, 0, 0] });
        this._recordTimer = setInterval(() => {
          this.setData({ recordTime: this.data.recordTime + 1 });
          // Max 60 seconds
          if (this.data.recordTime >= 60) {
            this.stopRecord();
          }
        }, 1000);
      });

      this.recorderManager.onStop((res) => {
        if (this._recordTimer) {
          clearInterval(this._recordTimer);
          this._recordTimer = null;
        }
        this.setData({ isRecording: false });

        if (this.data.recordTime < 1) {
          wx.showToast({ title: '录音时间太短', icon: 'none' });
          return;
        }

        this.triggerEvent('recordend', {
          tempFilePath: res.tempFilePath,
          duration: this.data.recordTime,
          fileSize: res.fileSize
        });
      });

      this.recorderManager.onError((err) => {
        if (this._recordTimer) {
          clearInterval(this._recordTimer);
          this._recordTimer = null;
        }
        this.setData({ isRecording: false });
        console.error('录音错误:', err);
        wx.showToast({ title: '录音失败，请重试', icon: 'none' });
      });
    },

    detached() {
      if (this._recordTimer) {
        clearInterval(this._recordTimer);
      }
      if (this.data.isRecording) {
        this.recorderManager.stop();
      }
    }
  },

  methods: {
    async checkPermission() {
      return new Promise((resolve) => {
        wx.authorize({
          scope: 'scope.record',
          success: () => {
            this.setData({ hasPermission: true });
            resolve(true);
          },
          fail: () => {
            wx.showModal({
              title: '需要录音权限',
              content: '请在设置中允许使用麦克风',
              confirmText: '去设置',
              success: (res) => {
                if (res.confirm) {
                  wx.openSetting();
                }
              }
            });
            resolve(false);
          }
        });
      });
    },

    async startRecord() {
      if (this.properties.disabled) return;

      const hasPermission = await this.checkPermission();
      if (!hasPermission) return;

      this.recorderManager.start({
        duration: 60000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: 'mp3',
        frameSize: 1
      });

      this.triggerEvent('recordstart');
    },

    stopRecord() {
      if (this.data.isRecording) {
        this.recorderManager.stop();
      }
    },

    onTouchStart(e) {
      this.startRecord();
    },

    onTouchEnd(e) {
      this.stopRecord();
    },

    onTouchCancel(e) {
      this.stopRecord();
    }
  }
});