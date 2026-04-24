const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// Tencent Cloud ASR configuration
const ASR_CONFIG = {
  // Set TENCENT_SECRET_ID and TENCENT_SECRET_KEY in cloud function environment variables
  secretId: process.env.TENCENT_SECRET_ID || '',
  secretKey: process.env.TENCENT_SECRET_KEY || '',
  region: 'ap-guangzhou'
};

exports.main = async (event, context) => {
  const { fileID } = event;

  if (!fileID) {
    return { success: false, error: '缺少音频文件ID' };
  }

  try {
    // Download audio file from cloud storage
    const fileRes = await cloud.downloadFile({ fileID });
    const audioBuffer = fileRes.fileContent;

    if (!audioBuffer || audioBuffer.length === 0) {
      return { success: false, error: '音频文件为空' };
    }

    // Convert to base64 for API call
    const audioBase64 = audioBuffer.toString('base64');

    // Call Tencent Cloud ASR API
    // Using the one-sentence recognition API for short audio
    const result = await callTencentASR(audioBase64);

    return {
      success: true,
      text: result
    };
  } catch (err) {
    console.error('语音识别错误:', err);
    return {
      success: false,
      error: err.message || '语音识别失败',
      text: ''
    };
  }
};

async function callTencentASR(audioBase64) {
  try {
    const tencentcloud = require('tencentcloud-sdk-nodejs');
    const AsrClient = tencentcloud.asr.v20190614.Client;

    const client = new AsrClient({
      credential: {
        secretId: ASR_CONFIG.secretId,
        secretKey: ASR_CONFIG.secretKey,
      },
      region: ASR_CONFIG.region,
      profile: {
        httpProfile: {
          endpoint: 'asr.tencentcloudapi.com',
        },
      },
    });

    const params = {
      EngSerViceType: '16k_en',  // English 16kHz
      SourceType: 1,              // Audio data in body
      VoiceFormat: 'mp3',
      Data: audioBase64,
      DataLen: audioBase64.length
    };

    const result = await client.SentenceRecognition(params);
    return result.Result || '';
  } catch (err) {
    console.error('腾讯云ASR调用失败:', err);
    // Return empty string as fallback
    return '';
  }
}
