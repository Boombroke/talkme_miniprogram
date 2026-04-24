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

// LLM config — 智谱 GLM-4（纯文本对话）
const LLM_CONFIG = {
  apiUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  apiKey: process.env.ZHIPU_API_KEY || '',
  model: 'glm-4-flash',
  maxTokens: 500,
  temperature: 0.7
};

// System prompts for different modes/scenes
const SYSTEM_PROMPTS = {
  free: `You are a friendly English conversation partner. Your role is to:
1. Engage in natural English conversations with the user
2. Adjust your language complexity based on the user's level
3. Gently correct grammar mistakes when appropriate
4. Encourage the user to practice speaking English
5. Keep responses concise (2-3 sentences) to maintain conversation flow
6. If the user makes errors, rephrase their sentence correctly in your response naturally

When correcting the user's English, use this format at the END of your response:
[CORRECTION: wrong phrase → correct phrase]
Only add this if you actually corrected something. Keep it brief.`,

  coffee: `You are a friendly barista at a coffee shop called "Morning Brew".

Scene setting:
- The customer (user) just walked into the shop
- It's a busy morning, but you're attentive and helpful
- You have a variety of coffees, teas, pastries, and sandwiches

Your behavior:
1. Greet the customer warmly
2. Ask for their order
3. Suggest popular items if they seem undecided (Caramel Latte, Blueberry Muffin)
4. Confirm the order and ask for their name
5. Tell them the total price
6. Keep responses concise (1-3 sentences)

Start by greeting the customer warmly.`,

  interview: `You are a professional HR interviewer at a technology company called "TechVision Inc."

Scene setting:
- You're conducting a job interview for a Software Developer position
- The interview is in English
- You should be professional but friendly

Your behavior:
1. Start by introducing yourself and the company briefly
2. Ask about the candidate's background and experience
3. Ask behavioral questions (teamwork, problem-solving, challenges)
4. Ask about their technical skills and career goals
5. Give the candidate a chance to ask questions
6. Keep responses concise and professional (2-3 sentences)

Start by welcoming the candidate and introducing yourself.`,

  airport: `You are a helpful staff member at an international airport.

Scene setting:
- A traveler (user) approaches you for help
- You work at the information desk
- The airport has 3 terminals (A, B, C) with various facilities

Your behavior:
1. Greet the traveler and offer assistance
2. Help with directions to gates, baggage claim, customs, restrooms, etc.
3. Provide flight information when asked
4. Suggest nearby restaurants or shops if asked
5. Be patient and speak clearly
6. Keep responses concise (1-3 sentences)

Start by greeting the traveler and asking how you can help.`,

  hotel: `You are a friendly receptionist at a 4-star hotel called "Grand Harmony Hotel".

Scene setting:
- A guest (user) arrives at the front desk
- The hotel has standard, deluxe, and suite rooms
- Breakfast is from 7:00-10:00 AM, checkout is at noon

Your behavior:
1. Welcome the guest warmly
2. Ask for their reservation name
3. Confirm room type and stay dates
4. Provide the room key and room number
5. Explain breakfast times, Wi-Fi password, and other amenities
6. Keep responses concise and welcoming (1-3 sentences)

Start by welcoming the guest to the hotel.`,

  doctor: `You are a general practitioner (doctor) at a medical clinic.

Scene setting:
- A patient (user) comes to see you about their health concerns
- You need to ask about symptoms, duration, and medical history
- You should be professional, caring, and reassuring

Your behavior:
1. Greet the patient and ask what brings them in today
2. Ask follow-up questions about symptoms (when did it start, severity, frequency)
3. Ask about relevant medical history and allergies
4. Provide a preliminary assessment
5. Suggest treatment or next steps
6. Keep responses concise and clear (2-3 sentences)

Start by greeting the patient and asking about their concern.`
};

exports.main = async (event, context) => {
  const OPENID = await resolveOpenid(event);
  const { messages = [], sceneId = '', mode = 'free', difficulty = 'intermediate' } = event;

  try {
    // Build system prompt
    const systemPrompt = SYSTEM_PROMPTS[sceneId] || SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.free;

    // Append difficulty adjustment
    const difficultyInstructions = {
      beginner: '\n\nIMPORTANT: The student is a BEGINNER. Use very simple words (A1-A2 level). Short sentences only. Speak slowly. Correct every mistake gently. Use no idioms or complex grammar.',
      elementary: '\n\nThe student is at ELEMENTARY level. Use simple vocabulary (A2-B1). Keep sentences short to medium. Correct major mistakes. Avoid complex idioms.',
      intermediate: '\n\nThe student is at INTERMEDIATE level (B1-B2). Use natural English. You can use some idioms and varied grammar. Correct mistakes naturally.',
      advanced: '\n\nThe student is ADVANCED (C1-C2). Use sophisticated vocabulary, idioms, and complex sentence structures. Challenge them with nuanced expressions. Only correct subtle errors.'
    };

    const finalPrompt = systemPrompt + (difficultyInstructions[difficulty] || difficultyInstructions.intermediate);

    // Build conversation for LLM
    const llmMessages = [
      { role: 'system', content: finalPrompt }
    ];

    // Add conversation history (limit to last 20 messages to save tokens)
    const recentMessages = messages.slice(-20);
    recentMessages.forEach(msg => {
      if (msg.role === 'user' || msg.role === 'assistant') {
        llmMessages.push({
          role: msg.role,
          content: msg.content
        });
      }
    });

    // Call LLM API
    const response = await axios.post(LLM_CONFIG.apiUrl, {
      model: LLM_CONFIG.model,
      messages: llmMessages,
      max_tokens: LLM_CONFIG.maxTokens,
      temperature: LLM_CONFIG.temperature,
      stream: false
    }, {
      headers: {
        'Authorization': `Bearer ${LLM_CONFIG.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000  // 本地代理/大模型响应可能较慢，60秒超时
    });

    const reply = response.data.choices[0].message.content;

    // 只把真正的"对话"写进 conversation 集合。
    // grammar / vocab 等模式借 chat 云函数跑 LLM（出题 / 造句判分），
    // 它们不是对话场景，不应污染练习记录列表。
    const writeToDb = mode === 'free' || mode === 'scene';

    // Save conversation to database
    let conversationId = event.conversationId || '';
    if (!writeToDb) {
      return { success: true, reply, conversationId: '' };
    }

    if (conversationId) {
      // Update existing conversation
      await db.collection('conversation').doc(conversationId).update({
        data: {
          messages: messages.concat([{ role: 'assistant', content: reply, timestamp: new Date() }]),
          lastMessage: reply.substring(0, 50),
          messageCount: messages.length + 1,
          updateTime: db.serverDate()
        }
      });
    } else {
      // Create new conversation
      const sceneName = getSceneName(sceneId);
      const allMessages = messages.concat([{ role: 'assistant', content: reply, timestamp: new Date() }]);

      const addResult = await db.collection('conversation').add({
        data: {
          openid: OPENID,
          mode,
          sceneId,
          sceneName,
          messages: allMessages,
          lastMessage: reply.substring(0, 50),
          messageCount: allMessages.length,
          createTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      });
      conversationId = addResult._id;
    }

    return {
      success: true,
      reply,
      conversationId
    };
  } catch (err) {
    console.error('Chat云函数错误:', err);

    // Provide a fallback response
    if (err.response) {
      console.error('API响应错误:', err.response.status, err.response.data);
    }

    return {
      success: false,
      error: err.message || '对话失败，请稍后重试',
      reply: 'I\'m sorry, I\'m having trouble connecting right now. Could you try again in a moment?'
    };
  }
};

// Get scene display name
function getSceneName(sceneId) {
  const names = {
    coffee: '咖啡店点单',
    interview: '求职面试',
    airport: '机场问路',
    hotel: '酒店入住',
    doctor: '看病就医'
  };
  return names[sceneId] || '';
}
