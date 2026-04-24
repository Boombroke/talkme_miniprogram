const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// ========== auth helper: resolve identity via session token OR WeChat context (inline copy; canonical version lives in login/index.js) ==========
async function resolveOpenid(event) {
  if (event && event._sessionToken) {
    try {
      const sess = await db.collection('session')
        .where({ token: event._sessionToken }).get();
      if (sess.data.length > 0) {
        const row = sess.data[0];
        if (!row.expireAt || new Date(row.expireAt).getTime() > Date.now()) {
          return row.openid || '';
        }
      }
    } catch (e) { /* fall through */ }
  }
  const ctx = cloud.getWXContext();
  return (ctx && ctx.OPENID) || '';
}

// LLM config — 智谱 GLM-4（文本评估，兼容旧逻辑）
const LLM_CONFIG = {
  apiUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  apiKey: process.env.ZHIPU_API_KEY || '',
  model: 'glm-4-flash',
  maxTokens: 1000,
  temperature: 0.3
};
// Qwen-Omni config（音频评估）
const QWEN_CONFIG = {
  apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  apiKey: process.env.DASHSCOPE_API_KEY || '',
  model: 'qwen3-omni-flash',
  maxTokens: 1000
};

const SCENE_GOALS = {
  coffee: 'The student should have: greeted the barista, ordered a drink, asked about options, confirmed order, and said goodbye.',
  interview: 'The student should have: introduced themselves, answered questions about experience, discussed skills, and asked questions.',
  airport: 'The student should have: asked for directions, provided flight info, and navigated the conversation to get help.',
  hotel: 'The student should have: checked in, confirmed reservation, received room key, and asked about amenities.',
  doctor: 'The student should have: described symptoms, answered follow-up questions, and understood the treatment plan.'
};

// ========== Qwen-Omni SSE 流式工具（内联，云端不支持跨目录 require） ==========
const https = require('https');

function callQwenOmniStream(config, messages, options = {}) {
  const { maxTokens = 1000, temperature } = options;
  const body = {
    model: config.model, messages,
    stream: true, stream_options: { include_usage: true },
    modalities: ['text'], max_tokens: maxTokens
  };
  if (temperature !== undefined) body.temperature = temperature;
  const requestBody = JSON.stringify(body);
  const url = new URL(config.apiUrl);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      timeout: 120000
    }, (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', chunk => { errBody += chunk.toString(); });
        res.on('end', () => { reject(new Error(`Qwen API ${res.statusCode}: ${errBody}`)); });
        return;
      }
      let fullText = '', buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6);
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.choices && parsed.choices.length > 0 && parsed.choices[0].delta && parsed.choices[0].delta.content) {
              fullText += parsed.choices[0].delta.content;
            }
          } catch (e) {}
        }
      });
      res.on('end', () => { resolve(fullText); });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Qwen API request timeout')); });
    req.write(requestBody);
    req.end();
  });
}

function buildAudioContent(audioBuffer, audioFormat, textPrompt) {
  const base64Audio = audioBuffer.toString('base64');
  const content = [{ type: 'input_audio', input_audio: { data: `data:audio/${audioFormat};base64,${base64Audio}`, format: audioFormat } }];
  if (textPrompt) content.push({ type: 'text', text: textPrompt });
  return content;
}

const EVALUATION_PROMPT = `You are a STRICT professional English speaking examiner. Evaluate the student's English speaking performance in the conversation below. Be honest and critical — do NOT inflate scores.

Analyze ONLY the messages from the "user" role (the student).

SCORING RUBRIC (0-100, be strict):

Pronunciation (25%):
- 0: No speech content
- 1-30: Most words mispronounced, very hard to understand
- 31-50: Some words recognizable, but systematic vowel/consonant errors
- 51-70: Most words correct, but unnatural stress or intonation
- 71-85: Clear and accurate, occasional minor errors
- 86-100: Natural intonation, accurate stress, near-native

Grammar (25%):
- 0: No sentence content
- 1-30: No complete sentences, basic grammar entirely wrong
- 31-50: Complete sentences exist but frequent errors (2+ per sentence)
- 51-70: Basic structure correct but obvious errors (articles/prepositions/tenses)
- 71-85: Mostly correct, only minor mistakes
- 86-100: Precise grammar, can use complex sentence structures

Fluency (25%):
- 0: No speech content
- 1-30: Extreme pausing, says only 1-2 words then stops
- 31-50: Frequent pauses and self-corrections, very slow
- 51-70: Some pauses but can sustain expression, slow pace
- 71-85: Fairly fluent, natural pauses, normal speed
- 86-100: Very fluent, natural pace, almost no unnecessary pauses

Vocabulary (25%):
- 0: No content
- 1-30: Only the most basic words (yes/no/good), heavy repetition
- 31-50: Limited vocabulary, relies on simple words, obvious misuse
- 51-70: Adequate vocabulary, occasional inappropriate word choice
- 71-85: Rich vocabulary, accurate word choice
- 86-100: Diverse and sophisticated, uses idioms and precise expressions

CRITICAL RULES:
- If the student said fewer than 3 English words → ALL scores MUST be 0-20
- If the student spoke in Chinese or another non-English language → ALL scores MUST be 0-20
- A score of 80+ means EXCELLENT performance — do NOT give 80+ unless truly deserved
- Most intermediate learners should score 40-65, NOT 70-80
- Be specific about errors — vague feedback like "good job" with a high score is FORBIDDEN

You MUST respond with ONLY a valid JSON object (no markdown, no explanation):
{
  "totalScore": 42,
  "pronunciation": {
    "score": 35,
    "issues": ["specific issue 1"]
  },
  "grammar": {
    "score": 50,
    "issues": ["specific issue 1"]
  },
  "fluency": {
    "score": 38,
    "issues": ["specific issue 1"]
  },
  "vocabulary": {
    "score": 45,
    "issues": ["specific issue 1"]
  },
  "correctedSentence": "Corrected version of the student's most notable error",
  "suggestions": ["Specific actionable suggestion 1", "Specific actionable suggestion 2"],
  "encouragement": "Brief encouraging message in Chinese"
}

totalScore = round(pronunciation*0.25 + grammar*0.25 + fluency*0.25 + vocabulary*0.25)`;

// 音频评估专用 prompt — Qwen-Omni 直接听音频
const AUDIO_EVALUATION_PROMPT = `You are a STRICT professional English speaking examiner. You will receive the student's audio recording. Listen carefully and evaluate their ACTUAL speaking performance. Be honest and critical — do NOT inflate scores to be polite.

SCORING RUBRIC (0-100, be strict):

Pronunciation (25%):
- 0: No recognizable English speech in the audio (silence, noise, or non-English)
- 1-30: Most words severely mispronounced, very hard to understand
- 31-50: Some words recognizable, systematic vowel/consonant errors throughout
- 51-70: Most words pronounced correctly, but unnatural stress/intonation
- 71-85: Clear and accurate pronunciation, occasional minor errors
- 86-100: Natural intonation, accurate word stress, near-native quality

Grammar (25%):
- 0: No sentence content in the audio
- 1-30: No complete sentences, fundamental grammar errors
- 31-50: Some sentences but frequent errors (2+ per sentence)
- 51-70: Basic structure correct, but obvious errors in articles/prepositions/tenses
- 71-85: Mostly grammatically correct, only minor mistakes
- 86-100: Precise grammar with complex sentence structures used correctly

Fluency (25%):
- 0: No speech or only silence
- 1-30: Extreme hesitation, only isolated words with long pauses between
- 31-50: Frequent long pauses, many self-corrections, very slow pace
- 51-70: Some pauses but can sustain expression, somewhat slow
- 71-85: Fairly fluent with natural pauses, normal speaking speed
- 86-100: Very fluent, natural rhythm and pace, no unnecessary pauses

Vocabulary (25%):
- 0: No content
- 1-30: Only basic words (yes/no/good/ok), heavy repetition
- 31-50: Limited vocabulary, relies on simple words, noticeable misuse
- 51-70: Adequate vocabulary for the topic, occasional wrong word choice
- 71-85: Good vocabulary range, accurate and appropriate word choice
- 86-100: Rich and diverse vocabulary, uses idioms and precise expressions

CRITICAL RULES:
- If the audio contains NO recognizable English speech (silence, pure noise, non-English language) → ALL scores MUST be 0, transcript MUST be "" (empty)
- If the student said fewer than 3 English words → ALL scores MUST be 0-20
- If the student spoke mostly in Chinese or another language → ALL scores MUST be 0-20  
- A score of 80+ means EXCELLENT — reserve it for genuinely impressive performance
- Most intermediate learners should realistically score 40-65
- Every issue listed MUST reference something specific you HEARD in the audio
- Do NOT give vague praise like "good pronunciation" with high scores — be specific

You MUST respond with ONLY a valid JSON object (no markdown, no extra text):
{
  "totalScore": 42,
  "pronunciation": {
    "score": 35,
    "issues": ["specific pronunciation issue you HEARD"]
  },
  "grammar": {
    "score": 50,
    "issues": ["specific grammar error from the speech"]
  },
  "fluency": {
    "score": 38,
    "issues": ["specific fluency problem like 'long 3-second pause after every phrase'"]
  },
  "vocabulary": {
    "score": 45,
    "issues": ["specific vocabulary issue"]
  },
  "transcript": "Exact transcription of what the student said",
  "correctedSentence": "Corrected version of their most notable error",
  "suggestions": ["Specific actionable suggestion 1", "Specific actionable suggestion 2"],
  "encouragement": "Brief encouraging message in Chinese"
}

totalScore = round(pronunciation*0.25 + grammar*0.25 + fluency*0.25 + vocabulary*0.25)
transcript MUST contain exactly what the student said. If nothing was said, transcript MUST be "".`;

exports.main = async (event, context) => {
  const OPENID = await resolveOpenid(event);
  const { messages = [], sceneId = '', mode = 'free', conversationId = '', duration = 0, audioFileID = '' } = event;

  try {
    // 如果有音频文件，走 Qwen-Omni 音频评估（一步到位）
    if (audioFileID) {
      return await evaluateWithAudio(OPENID, event, audioFileID);
    }

    // 否则走传统文本评估（兼容旧逻辑）
    // Extract user messages for evaluation
    const userMessages = messages.filter(m => m.role === 'user');

    if (userMessages.length === 0) {
      return getDefaultEvaluation('对话记录中没有发现你的消息，多说几句吧！');
    }

    // Build conversation text for evaluation
    const conversationText = messages.map(m => {
      return `${m.role === 'user' ? 'Student' : 'AI Teacher'}: ${m.content}`;
    }).join('\n');

    const sceneContext = sceneId ? `Scene: ${getSceneName(sceneId)}` : 'Free conversation';

    // Build evaluation prompt with optional scene goals
    let evalPrompt = EVALUATION_PROMPT;
    if (sceneId && SCENE_GOALS[sceneId]) {
      evalPrompt += `\n\nADDITIONAL: This was a scene-based conversation. Also evaluate scene completion.
Scene goals: ${SCENE_GOALS[sceneId]}
Add these fields to the JSON response:
"sceneCompletion": {
  "score": 80,
  "completedGoals": ["greeted the barista", "ordered a drink"],
  "missedGoals": ["did not ask about options"],
  "feedback": "Brief feedback in Chinese about scene performance"
}`;
    }

    // Call LLM for evaluation
    const response = await axios.post(LLM_CONFIG.apiUrl, {
      model: LLM_CONFIG.model,
      messages: [
        { role: 'system', content: evalPrompt },
        { role: 'user', content: `${sceneContext}\n\nConversation:\n${conversationText}` }
      ],
      max_tokens: LLM_CONFIG.maxTokens,
      temperature: LLM_CONFIG.temperature
    }, {
      headers: {
        'Authorization': `Bearer ${LLM_CONFIG.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });

    const replyContent = response.data.choices[0].message.content;

    // Parse evaluation JSON with fault tolerance
    const evaluation = parseEvaluationJSON(replyContent);

    if (!evaluation) {
      return getDefaultEvaluation('评估结果解析失败，但你的练习已记录。继续加油！');
    }

    // Save evaluation to database (always save, conversationId is optional)
    await db.collection('evaluation').add({
      data: {
        openid: OPENID,
        conversationId: conversationId || '',
        sceneId,
        mode,
        duration,
        ...evaluation,
        createTime: db.serverDate()
      }
    });

    // Update conversation with score (only if conversationId exists)
    if (conversationId) {
      await db.collection('conversation').doc(conversationId).update({
        data: {
          score: evaluation.totalScore
        }
      });
    }

    // Update user average score
    await updateUserAverageScore(OPENID, evaluation.totalScore);

    return {
      success: true,
      ...evaluation
    };
  } catch (err) {
    console.error('评估云函数错误:', err);
    return getDefaultEvaluation('评估过程出现问题，但别担心，继续练习就好！');
  }
};

// 3-layer JSON parsing with fault tolerance
function parseEvaluationJSON(text) {
  if (!text) return null;

  // Layer 1: Direct parse
  try {
    const result = JSON.parse(text);
    if (result.totalScore !== undefined) return result;
  } catch (e) {}

  // Layer 2: Extract from markdown code block
  try {
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) {
      const result = JSON.parse(codeBlockMatch[1].trim());
      if (result.totalScore !== undefined) return result;
    }
  } catch (e) {}

  // Layer 3: Find first { to last }
  try {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const jsonStr = text.substring(firstBrace, lastBrace + 1);
      const result = JSON.parse(jsonStr);
      if (result.totalScore !== undefined) return result;
    }
  } catch (e) {}

  return null;
}

// Default evaluation when parsing fails — 0 分，不再白送
function getDefaultEvaluation(encouragement) {
  return {
    success: true,
    isDefault: true,  // 标记为兜底数据，前端可据此提示用户
    totalScore: 0,
    pronunciation: { score: 0, issues: [] },
    grammar: { score: 0, issues: [] },
    fluency: { score: 0, issues: [] },
    vocabulary: { score: 0, issues: [] },
    correctedSentence: '',
    suggestions: ['请确保在安静环境中清晰地用英语作答', '尝试说完整的英语句子'],
    encouragement: encouragement || '没有检测到有效的英语语音，请重新尝试。'
  };
}

// Update user average score. 用 evalCount 记录评估次数，避免用 totalDays（打卡天数）做分母导致分数被稀释。
async function updateUserAverageScore(openid, newScore) {
  try {
    const { data } = await db.collection('user').where({ openid }).get();
    if (data.length === 0) return;

    const user = data[0];
    const oldAvg = user.averageScore || 0;
    const n = user.evalCount || 0;
    // 滚动平均：newAvg = (oldAvg * n + newScore) / (n + 1)
    const newAvg = n === 0 ? newScore : Math.round((oldAvg * n + newScore) / (n + 1));

    await db.collection('user').where({ openid }).update({
      data: {
        averageScore: newAvg,
        evalCount: db.command.inc(1)
      }
    });
  } catch (err) {
    console.error('更新平均分失败:', err);
  }
}

function getSceneName(sceneId) {
  const names = {
    coffee: 'Coffee Shop Ordering',
    interview: 'Job Interview',
    airport: 'Airport Navigation',
    hotel: 'Hotel Check-in',
    doctor: 'Seeing a Doctor'
  };
  return names[sceneId] || 'Free Conversation';
}

// ========== 音频直传评估（Qwen-Omni 一步到位） ==========

async function evaluateWithAudio(openid, event, audioFileID) {
  const { messages = [], sceneId = '', mode = 'free', conversationId = '', duration = 0 } = event;

  // 下载音频
  const fileRes = await cloud.downloadFile({ fileID: audioFileID });
  const audioBuffer = fileRes.fileContent;

  if (!audioBuffer || audioBuffer.length === 0) {
    return getDefaultEvaluation('音频文件为空，请重新录制');
  }

  // 音频大小检测：MP3 16kbps 单声道，1秒 ≈ 2KB，<4KB 基本是静音或不到2秒
  if (audioBuffer.length < 4000) {
    return getDefaultEvaluation('录音时间太短，请至少说一句完整的英语。');
  }

  // 构建评估 prompt
  let evalPrompt = AUDIO_EVALUATION_PROMPT;

  // 场景完成度评估
  if (sceneId && SCENE_GOALS[sceneId]) {
    evalPrompt += `\n\nADDITIONAL: This was a scene-based conversation.
Scene goals: ${SCENE_GOALS[sceneId]}
Add "sceneCompletion" field to the JSON with score, completedGoals, missedGoals, feedback(Chinese).`;
  }

  // 构建消息：system + 对话历史(文本) + 音频
  const llmMessages = [
    { role: 'system', content: evalPrompt }
  ];

  // 如果有对话历史，作为上下文
  if (messages && messages.length > 0) {
    const conversationText = messages.map(m => {
      return `${m.role === 'user' ? 'Student' : 'AI Teacher'}: ${m.content}`;
    }).join('\n');
    llmMessages.push({
      role: 'user',
      content: `Context - conversation so far:\n${conversationText}\n\nNow evaluate the student's latest audio recording below:`
    });
    // assistant 确认
    llmMessages.push({
      role: 'assistant',
      content: 'I understand the conversation context. Please provide the audio and I will evaluate the student\'s speaking performance.'
    });
  }

  // 最后一条消息：音频
  const audioContent = buildAudioContent(
    audioBuffer,
    'mp3',
    'Listen to this student speaking English and evaluate their pronunciation, grammar, fluency, and vocabulary. Respond with ONLY a JSON object as specified in the system prompt.'
  );
  llmMessages.push({ role: 'user', content: audioContent });

  // 调用 Qwen-Omni
  const replyContent = await callQwenOmniStream(QWEN_CONFIG, llmMessages, {
    maxTokens: 1000
  });

  // 解析评估 JSON
  const evaluation = parseEvaluationJSON(replyContent);

  if (!evaluation) {
    return getDefaultEvaluation('评估结果解析失败，但你的练习已记录。继续加油！');
  }

  // 后置校验：如果模型返回的 transcript 为空或极短，说明音频中无有效内容
  const transcript = (evaluation.transcript || '').trim();
  const wordCount = transcript.split(/\s+/).filter(w => /[a-zA-Z]/.test(w)).length;

  if (wordCount === 0) {
    // 完全没有英语内容 → 强制 0 分
    return getDefaultEvaluation('未检测到英语语音，请用英语作答后重试。');
  }

  if (wordCount < 3) {
    // 不到 3 个英语单词 → 强制压到 20 分以内
    const cap = 20;
    evaluation.pronunciation.score = Math.min(evaluation.pronunciation.score, cap);
    evaluation.grammar.score = Math.min(evaluation.grammar.score, cap);
    evaluation.fluency.score = Math.min(evaluation.fluency.score, cap);
    evaluation.vocabulary.score = Math.min(evaluation.vocabulary.score, cap);
    evaluation.totalScore = Math.round(
      evaluation.pronunciation.score * 0.25 +
      evaluation.grammar.score * 0.25 +
      evaluation.fluency.score * 0.25 +
      evaluation.vocabulary.score * 0.25
    );
  }

  // 保存评估到数据库（始终保存，conversationId 可选）
  await db.collection('evaluation').add({
    data: {
      openid,
      conversationId: conversationId || '',
      sceneId,
      mode,
      duration,
      audioEval: true,
      transcript,
      wordCount,
      ...evaluation,
      createTime: db.serverDate()
    }
  });

  if (conversationId) {
    await db.collection('conversation').doc(conversationId).update({
      data: { score: evaluation.totalScore }
    });
  }

  // 0 分不影响用户历史平均分
  if (evaluation.totalScore > 0) {
    await updateUserAverageScore(openid, evaluation.totalScore);
  }

  return {
    success: true,
    ...evaluation
  };
}
