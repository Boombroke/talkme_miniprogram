const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const https = require('https');

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

// Qwen-Omni config（内联，云端不支持跨目录 require）
const QWEN_CONFIG = {
  apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  apiKey: process.env.DASHSCOPE_API_KEY || '',
  model: 'qwen3-omni-flash'
};

// ========== Qwen-Omni SSE 流式工具 ==========
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

// Shared: every response MUST start with a transcript tag so the client can show "转文字"
const TRANSCRIPT_TAG_INSTRUCTION = `

CRITICAL FORMAT REQUIREMENT:
Your response MUST have two parts. The FIRST LINE must be the transcript of what the student actually said, in this format:
[TRANSCRIPT: the exact English words you heard the student speak]

Rules for the transcript tag:
- Put the student's ACTUAL spoken words inside, word for word. Do NOT put placeholder text.
- Do NOT use angle brackets like <...>.
- Do NOT describe what the transcript "should" contain — write the real transcribed words.
- If the audio is silent or unintelligible, write [TRANSCRIPT: (unintelligible)] instead.

After the transcript line, respond normally in your role on the following lines.`;

// System prompts — 语音对话模式，能直接听到用户发音
const SYSTEM_PROMPTS = {
  free: `You are a friendly but HONEST English conversation partner. You receive the student's voice audio directly — you can HEAR their pronunciation. Your role is to:
1. Engage in natural English conversations with the user
2. Adjust your language complexity based on the user's level
3. ALWAYS correct grammar mistakes — do not let errors slide
4. ALWAYS point out pronunciation issues you hear — be specific (e.g., "your 'th' in 'think' sounded like 's'")
5. Keep responses concise (2-3 sentences) to maintain conversation flow
6. If the user makes errors, rephrase their sentence correctly in your response

You MUST use this correction format at the END of your response when you notice ANY error:
[CORRECTION: wrong phrase → correct phrase]
[PRONUNCIATION: specific pronunciation issue you heard]
Be specific and honest. Ignoring errors does NOT help the student improve.` + TRANSCRIPT_TAG_INSTRUCTION,

  coffee: `You are a friendly barista at a coffee shop called "Morning Brew".

Scene setting:
- The customer (user) just walked into the shop
- It's a busy morning, but you're attentive and helpful
- You have a variety of coffees, teas, pastries, and sandwiches

Your behavior:
1. Greet the customer warmly
2. Ask for their order
3. Suggest popular items if they seem undecided
4. Confirm the order and ask for their name
5. Tell them the total price
6. Keep responses concise (1-3 sentences)` + TRANSCRIPT_TAG_INSTRUCTION,

  interview: `You are a professional HR interviewer at a technology company called "TechVision Inc."

Scene setting:
- You're conducting a job interview for a Software Developer position
- The interview is in English

Your behavior:
1. Ask about the candidate's background and experience
2. Ask behavioral questions (teamwork, problem-solving)
3. Ask about technical skills and career goals
4. Keep responses concise and professional (2-3 sentences)` + TRANSCRIPT_TAG_INSTRUCTION,

  airport: `You are a helpful staff member at an international airport information desk.

Your behavior:
1. Help with directions to gates, baggage claim, customs
2. Provide flight information when asked
3. Be patient and speak clearly
4. Keep responses concise (1-3 sentences)` + TRANSCRIPT_TAG_INSTRUCTION,

  hotel: `You are a friendly receptionist at "Grand Harmony Hotel".

Your behavior:
1. Help with check-in, confirm reservation
2. Provide room key and explain amenities
3. Keep responses concise and welcoming (1-3 sentences)` + TRANSCRIPT_TAG_INSTRUCTION,

  doctor: `You are a general practitioner at a medical clinic.

Your behavior:
1. Ask about symptoms, duration, medical history
2. Provide preliminary assessment
3. Keep responses concise and clear (2-3 sentences)` + TRANSCRIPT_TAG_INSTRUCTION
};

const DIFFICULTY_INSTRUCTIONS = {
  beginner: '\n\nIMPORTANT: The student is a BEGINNER. Use very simple words (A1-A2 level). Short sentences only. Correct every mistake gently.',
  elementary: '\n\nThe student is at ELEMENTARY level. Use simple vocabulary (A2-B1). Correct major mistakes.',
  intermediate: '\n\nThe student is at INTERMEDIATE level (B1-B2). Use natural English. Correct mistakes naturally.',
  advanced: '\n\nThe student is ADVANCED (C1-C2). Use sophisticated vocabulary and complex sentences. Only correct subtle errors.'
};

exports.main = async (event, context) => {
  const OPENID = await resolveOpenid(event);
  const { fileID, messages = [], sceneId = '', mode = 'free', difficulty = 'intermediate', conversationId: existingConvId = '' } = event;

  try {
    // 1. 从云存储下载录音文件
    const fileRes = await cloud.downloadFile({ fileID });
    const audioBuffer = fileRes.fileContent;

    if (!audioBuffer || audioBuffer.length === 0) {
      return { success: false, error: '音频文件为空' };
    }

    // 2. 构建 system prompt
    const systemPrompt = (SYSTEM_PROMPTS[sceneId] || SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.free)
      + (DIFFICULTY_INSTRUCTIONS[difficulty] || DIFFICULTY_INSTRUCTIONS.intermediate);

    // 3. 构建消息数组
    const llmMessages = [
      { role: 'system', content: systemPrompt }
    ];

    // 添加对话历史（纯文本）
    const recentMessages = messages.slice(-20);
    recentMessages.forEach(msg => {
      if (msg.role === 'user' || msg.role === 'assistant') {
        llmMessages.push({ role: msg.role, content: msg.content });
      }
    });

    // 最后一条 user message：音频 + 文本指令
    const audioContent = buildAudioContent(
      audioBuffer,
      'mp3',
      'This is the student speaking in English. Listen carefully to their audio. ' +
      'Your response MUST start with one line: [TRANSCRIPT: the exact English words you heard the student say, word for word]. ' +
      'Do NOT write placeholder text or descriptions inside the brackets — put the REAL transcribed words. ' +
      'Do NOT use angle brackets like <...>. If silent/unintelligible, write [TRANSCRIPT: (unintelligible)]. ' +
      'On the next line(s), respond naturally as your role. ' +
      'Point out any pronunciation errors, grammar mistakes, or unnatural expressions you heard. Be specific (e.g. "your pronunciation of \'world\' was missing the \'r\' sound"). Do NOT ignore errors to be polite.'
    );
    llmMessages.push({ role: 'user', content: audioContent });

    // 4. 调用 Qwen-Omni（流式）
    const reply = await callQwenOmniStream(QWEN_CONFIG, llmMessages, {
      maxTokens: 500,
      temperature: 0.7
    });

    if (!reply) {
      return {
        success: false,
        error: '未收到AI回复',
        reply: "I'm sorry, I couldn't process your audio. Could you try again?"
      };
    }

    // 5. 从回复中提取 [TRANSCRIPT: ...] 标签，并从返回给前端的文本里剥离
    let userTranscript = '';
    let cleanedReply = reply;
    const tagMatch = reply.match(/\[TRANSCRIPT:\s*([^\]]+)\]/i);
    if (tagMatch) {
      const raw = tagMatch[1].trim();
      // 模型有时会抄 prompt 模板回来（含尖括号占位符、或描述性短语），过滤掉
      const looksLikeTemplate =
        /[<>]/.test(raw) ||
        /exact(ly)?\s+(english\s+)?words?/i.test(raw) ||
        /what\s+(the\s+)?student\s+(said|says)/i.test(raw) ||
        /verbatim/i.test(raw) ||
        /transcribe(d)?/i.test(raw) ||
        /placeholder/i.test(raw);
      if (!looksLikeTemplate && raw.toLowerCase() !== '(unintelligible)') {
        userTranscript = raw;
      }
      cleanedReply = reply.replace(/\[TRANSCRIPT:[^\]]*\]\s*/i, '').trim();
    }

    // 5.5 识别不到内容的兜底：前端 transcript 空，AI 回复替换为友好的请重说
    const isEmptySpeech = !userTranscript;
    if (isEmptySpeech) {
      cleanedReply = "Sorry, I couldn't catch that clearly — could you say it again a bit louder?";
    }

    // 6. 保存对话到数据库（空语音不入库，避免污染对话历史）
    let conversationId = existingConvId;
    if (!isEmptySpeech) {
      const userMsg = { role: 'user', content: userTranscript, timestamp: new Date() };
      const assistantMsg = { role: 'assistant', content: cleanedReply, timestamp: new Date() };

      if (conversationId) {
        await db.collection('conversation').doc(conversationId).update({
          data: {
            messages: db.command.push([userMsg, assistantMsg]),
            lastMessage: cleanedReply.substring(0, 50),
            messageCount: db.command.inc(2),
            updateTime: db.serverDate()
          }
        });
      } else {
        const allMessages = messages.concat([userMsg, assistantMsg]);
        const addResult = await db.collection('conversation').add({
          data: {
            openid: OPENID,
            mode,
            sceneId,
            sceneName: getSceneName(sceneId),
            messages: allMessages,
            lastMessage: cleanedReply.substring(0, 50),
            messageCount: allMessages.length,
            createTime: db.serverDate(),
            updateTime: db.serverDate()
          }
        });
        conversationId = addResult._id;
      }
    }

    return {
      success: true,
      reply: cleanedReply,
      userText: userTranscript,
      emptySpeech: isEmptySpeech,
      conversationId
    };
  } catch (err) {
    console.error('voiceChat云函数错误:', err);
    return {
      success: false,
      error: err.message || '语音对话失败',
      reply: "I'm sorry, I'm having trouble processing your audio right now. Could you try again?"
    };
  }
};

function getSceneName(sceneId) {
  const names = { coffee: '咖啡店点单', interview: '求职面试', airport: '机场问路', hotel: '酒店入住', doctor: '看病就医' };
  return names[sceneId] || '';
}
