// Shared LLM Configuration
// Used by chat and evaluate cloud functions
// API keys are loaded from cloud function environment variables

// 智谱 GLM-4 — 用于纯文本对话（chat 云函数文字输入仍走这个）
const zhipu = {
  apiUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  apiKey: process.env.ZHIPU_API_KEY || '',
  model: 'glm-4-flash'
};

// 阿里 Qwen-Omni — 用于语音直传评估（音频输入，一步到位）
const qwenOmni = {
  apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  apiKey: process.env.DASHSCOPE_API_KEY || '',
  model: 'qwen3-omni-flash'    // 无需邀测直接可用，后续可切 qwen3.5-omni-plus 或 qwen-omni-turbo
};

module.exports = { zhipu, qwenOmni };
