const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// Tencent Cloud TTS configuration
const TTS_CONFIG = {
  // Set TENCENT_SECRET_ID and TENCENT_SECRET_KEY in cloud function environment variables
  secretId: process.env.TENCENT_SECRET_ID || '',
  secretKey: process.env.TENCENT_SECRET_KEY || '',
  region: 'ap-guangzhou'
};

exports.main = async (event, context) => {
  const { text } = event;

  if (!text) {
    return { success: false, error: '缺少文本内容' };
  }

  // Limit text length
  const truncatedText = text.substring(0, 500);

  try {
    // Call Tencent Cloud TTS API
    const audioBuffer = await callTencentTTS(truncatedText);

    if (!audioBuffer || audioBuffer.length === 0) {
      return { success: false, error: '语音合成失败' };
    }

    // Upload audio to cloud storage
    const cloudPath = `tts/${Date.now()}-${Math.random().toString(36).substr(2, 6)}.mp3`;
    const uploadRes = await cloud.uploadFile({
      cloudPath,
      fileContent: audioBuffer
    });

    return {
      success: true,
      fileID: uploadRes.fileID
    };
  } catch (err) {
    console.error('语音合成错误:', err);
    return {
      success: false,
      error: err.message || '语音合成失败'
    };
  }
};

async function callTencentTTS(text) {
  try {
    const tencentcloud = require('tencentcloud-sdk-nodejs');
    const TtsClient = tencentcloud.tts.v20190823.Client;

    const client = new TtsClient({
      credential: {
        secretId: TTS_CONFIG.secretId,
        secretKey: TTS_CONFIG.secretKey,
      },
      region: TTS_CONFIG.region,
      profile: {
        httpProfile: {
          endpoint: 'tts.tencentcloudapi.com',
        },
      },
    });

    const params = {
      Text: text,
      SessionId: Date.now().toString(),
      Volume: 5,
      Speed: 0,
      ProjectId: 0,
      ModelType: 0,          // 大模型语音合成
      VoiceType: 101050,     // 大模型英文女声 Tiana
      PrimaryLanguage: 2,    // English
      SampleRate: 16000,
      Codec: 'mp3',
      EmotionCategory: 'neutral'
    };

    const result = await client.TextToVoice(params);

    if (result.Audio) {
      return Buffer.from(result.Audio, 'base64');
    }
    return null;
  } catch (err) {
    console.error('腾讯云TTS调用失败:', err);
    return null;
  }
}
