// Qwen-Omni SSE 流式响应解析工具
// Qwen-Omni 强制要求 stream: true，需要手动拼接 SSE 响应

const https = require('https');

/**
 * 调用 Qwen-Omni API（流式），返回完整文本响应
 * @param {Object} config - { apiUrl, apiKey, model }
 * @param {Array} messages - OpenAI 格式的 messages 数组
 * @param {Object} options - { maxTokens, temperature }
 * @returns {Promise<string>} 完整的文本响应
 */
function callQwenOmniStream(config, messages, options = {}) {
  const { maxTokens = 1000, temperature } = options;

  const body = {
    model: config.model,
    messages,
    stream: true,                          // Qwen-Omni 强制要求
    stream_options: { include_usage: true },
    modalities: ['text'],                  // 只要文本输出，不要语音输出
    max_tokens: maxTokens
  };

  // temperature 为 undefined 时不传，让模型用默认值
  if (temperature !== undefined) {
    body.temperature = temperature;
  }

  const requestBody = JSON.stringify(body);

  const url = new URL(config.apiUrl);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 120000
    }, (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', chunk => { errBody += chunk.toString(); });
        res.on('end', () => {
          reject(new Error(`Qwen API ${res.statusCode}: ${errBody}`));
        });
        return;
      }

      let fullText = '';
      let buffer = '';

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // 保留不完整的行

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6);
          if (jsonStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.choices && parsed.choices.length > 0) {
              const delta = parsed.choices[0].delta;
              if (delta && delta.content) {
                fullText += delta.content;
              }
            }
          } catch (e) {
            // 跳过解析失败的 chunk
          }
        }
      });

      res.on('end', () => {
        resolve(fullText);
      });

      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Qwen API request timeout'));
    });

    req.write(requestBody);
    req.end();
  });
}

/**
 * 构建包含音频的 user message content 数组
 * @param {Buffer} audioBuffer - 音频文件 Buffer
 * @param {string} audioFormat - 'mp3' | 'wav' | 'aac' 等
 * @param {string} textPrompt - 文本指令
 * @returns {Array} multimodal content 数组
 */
function buildAudioContent(audioBuffer, audioFormat, textPrompt) {
  const base64Audio = audioBuffer.toString('base64');
  const content = [
    {
      type: 'input_audio',
      input_audio: {
        data: `data:audio/${audioFormat};base64,${base64Audio}`,
        format: audioFormat
      }
    }
  ];
  if (textPrompt) {
    content.push({ type: 'text', text: textPrompt });
  }
  return content;
}

module.exports = { callQwenOmniStream, buildAudioContent };
