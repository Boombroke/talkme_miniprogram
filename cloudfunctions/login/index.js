const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

// ========== auth helpers (duplicated inline in chat/voiceChat/evaluate via copy) ==========
const crypto = require('crypto');

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

function genToken() {
  return crypto.randomBytes(20).toString('hex');
}

// Resolve identity: if event._sessionToken present → look up session → return openid
// else fall back to WeChat context OPENID. Returns '' if neither resolves.
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
    } catch (e) { /* ignore, fall through */ }
  }
  const ctx = cloud.getWXContext();
  return (ctx && ctx.OPENID) || '';
}

// Validation helpers
function isValidUsername(u) {
  return typeof u === 'string' && /^[a-zA-Z0-9_]{4,20}$/.test(u);
}
function isValidPassword(p) {
  return typeof p === 'string' && p.length >= 6 && /[a-zA-Z]/.test(p) && /[0-9]/.test(p);
}
// ========== end auth helpers ==========

exports.main = async (event, context) => {
  const OPENID = await resolveOpenid(event);
  const { action } = event;

  try {
    switch (action) {
      case 'getOpenidOnly':
        return { success: true, openid: OPENID };
      case 'register':
        return await register(OPENID, event);
      case 'getUserInfo':
        return await getUserInfo(OPENID);
      case 'updateUserInfo':
        return await updateUserInfo(OPENID, event.userInfo);
      case 'checkin':
        return await doCheckin(OPENID, event);
      case 'getConversations':
        return await getConversations(OPENID, event);
      case 'getConversationDetail':
        return await getConversationDetail(OPENID, event);
      case 'getCheckinRecords':
        return await getCheckinRecords(OPENID, event);
      case 'getRecentEvaluations':
        return await getRecentEvaluations(OPENID, event);
      case 'addCollection':
        return await addCollection(OPENID, event);
      case 'getCollections':
        return await getCollections(OPENID, event);
      case 'toggleMastered':
        return await toggleMastered(OPENID, event);
      case 'deleteCollection':
        return await deleteCollection(OPENID, event);
      case 'saveChallengeResult':
        return await saveChallengeResult(OPENID, event);
      case 'getChallengeLeaderboard':
        return await getChallengeLeaderboard(OPENID);
      case 'addPracticeTime':
        return await addPracticeTime(OPENID, event);
      case 'getModeStats':
        return await getModeStats(OPENID);
      case 'accountRegister':
        return await accountRegister(event);
      case 'accountLogin':
        return await accountLogin(event);
      case 'accountLogout':
        return await accountLogout(event);
      case 'seedTestAccount':
        return await seedTestAccount();
      default:
        return await login(OPENID);
    }
  } catch (err) {
    console.error('云函数执行错误:', err);
    return { success: false, error: err.message };
  }
};

// Login: get existing user (for already-registered users reopening the app).
// Does NOT create a user record — creation only happens via `register` action.
async function login(openid) {
  const userCollection = db.collection('user');
  const { data } = await userCollection.where({ openid }).get();

  if (data.length > 0) {
    return { success: true, openid, userInfo: data[0], registered: true };
  }
  return { success: true, openid, userInfo: null, registered: false };
}

// Register: create user record with WeChat profile (nickname + avatar).
// Idempotent — if the user already exists, update their profile instead.
// 昵称若为空则自动生成 "英语学习者-<openid 后 4 位>"，用户之后可在 profile 里改。
async function register(openid, event) {
  const userCollection = db.collection('user');
  const passedName = (event.nickName || '').trim();
  const nickName = passedName || ('英语学习者' + String(openid || '').slice(-4));
  const avatarUrl = event.avatarUrl || '';

  const { data } = await userCollection.where({ openid }).get();
  if (data.length > 0) {
    const updateData = { nickName };
    if (avatarUrl) updateData.avatarUrl = avatarUrl;
    await userCollection.doc(data[0]._id).update({ data: updateData });
    return {
      success: true,
      openid,
      userInfo: Object.assign({}, data[0], updateData),
      registered: true
    };
  }

  const newUser = {
    openid,
    nickName,
    avatarUrl,
    loginType: 'wechat',
    createTime: db.serverDate(),
    totalPracticeTime: 0,
    totalDays: 0,
    consecutiveDays: 0,
    averageScore: 0
  };
  const addResult = await userCollection.add({ data: newUser });
  newUser._id = addResult._id;
  return { success: true, openid, userInfo: newUser, registered: true };
}

// ========== account-based auth actions ==========

// Ensure a collection exists. Idempotent — swallows "already exists" errors.
// Workaround for WeChat Cloud: collections must exist before .add() works; there's no
// auto-create on first write. We lazily create on demand so deploy doesn't need a manual step.
async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (err) {
    // -501001 / already exists — both are fine, ignore everything
  }
}

// Create a session row for the given openid; returns token.
async function createSession(openid) {
  const token = genToken();
  const now = new Date();
  const expireAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  try {
    await db.collection('session').add({
      data: { token, openid, createTime: db.serverDate(), expireAt }
    });
  } catch (err) {
    // 首次运行时 session 集合可能不存在，建后重试一次
    if (/not exist/i.test(err.message || '') || err.errCode === -502005) {
      await ensureCollection('session');
      await db.collection('session').add({
        data: { token, openid, createTime: db.serverDate(), expireAt }
      });
    } else {
      throw err;
    }
  }
  return token;
}

// accountRegister: create a username/password user, issue session token.
async function accountRegister(event) {
  const { username, password, nickName } = event || {};
  if (!isValidUsername(username)) {
    return { success: false, error: '用户名需为 4-20 位字母、数字或下划线' };
  }
  if (!isValidPassword(password)) {
    return { success: false, error: '密码至少 6 位，且必须包含字母和数字' };
  }

  const userCollection = db.collection('user');
  const existing = await userCollection.where({ username }).get();
  if (existing.data.length > 0) {
    return { success: false, error: '用户名已被占用' };
  }

  const passwordSalt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, passwordSalt);

  const newUser = {
    openid: '',
    username,
    passwordHash,
    passwordSalt,
    loginType: 'account',
    nickName: (nickName && String(nickName).trim()) || username,
    avatarUrl: '',
    createTime: db.serverDate(),
    totalPracticeTime: 0,
    totalDays: 0,
    consecutiveDays: 0,
    averageScore: 0
  };
  const addResult = await userCollection.add({ data: newUser });
  const virtualOpenid = 'account:' + addResult._id;
  await userCollection.doc(addResult._id).update({
    data: { openid: virtualOpenid }
  });

  newUser._id = addResult._id;
  newUser.openid = virtualOpenid;

  const token = await createSession(virtualOpenid);

  // Strip sensitive fields from returned userInfo
  const userInfo = Object.assign({}, newUser);
  delete userInfo.passwordHash;
  delete userInfo.passwordSalt;

  return { success: true, token, userInfo };
}

// accountLogin: verify username/password, issue new session token.
async function accountLogin(event) {
  const { username, password } = event || {};
  const genericError = { success: false, error: '用户名或密码错误' };
  if (typeof username !== 'string' || typeof password !== 'string') {
    return genericError;
  }

  const { data } = await db.collection('user').where({ username }).get();
  if (data.length === 0 || data[0].loginType !== 'account') {
    return genericError;
  }

  const user = data[0];
  const storedHash = user.passwordHash || '';
  const storedSalt = user.passwordSalt || '';
  if (!storedHash || !storedSalt) {
    return genericError;
  }

  const computed = hashPassword(password, storedSalt);
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return genericError;
  }

  const token = await createSession(user.openid);

  const userInfo = Object.assign({}, user);
  delete userInfo.passwordHash;
  delete userInfo.passwordSalt;

  return { success: true, token, userInfo };
}

// accountLogout: delete session rows matching the passed token.
async function accountLogout(event) {
  const token = event && event._sessionToken;
  if (!token) {
    return { success: true };
  }
  try {
    await db.collection('session').where({ token }).remove();
  } catch (e) {
    // ignore — treat as no-op
  }
  return { success: true };
}

// seedTestAccount: idempotent dev seed for a test user.
async function seedTestAccount() {
  const userCollection = db.collection('user');
  const existing = await userCollection.where({ username: 'test' }).get();
  if (existing.data.length > 0) {
    return { success: true, seeded: false };
  }
  await accountRegister({
    username: 'test',
    password: 'test1234',
    nickName: '测试账号'
  });
  return { success: true, seeded: true, username: 'test', password: 'test1234' };
}

// Get user info
async function getUserInfo(openid) {
  const { data } = await db.collection('user').where({ openid }).get();
  if (data.length === 0) {
    return { success: false, error: '用户不存在' };
  }
  return { success: true, userInfo: data[0] };
}

// Update user info
async function updateUserInfo(openid, userInfo) {
  const { nickName, avatarUrl } = userInfo || {};
  const updateData = {};
  if (nickName) updateData.nickName = nickName;
  if (avatarUrl) updateData.avatarUrl = avatarUrl;

  await db.collection('user').where({ openid }).update({
    data: updateData
  });

  return { success: true };
}

// Checkin
async function doCheckin(openid, event) {
  const { checkinDate } = event;
  const checkinCollection = db.collection('checkin');
  const userCollection = db.collection('user');

  // Check if already checked in today
  const existing = await checkinCollection.where({
    openid,
    checkinDate
  }).get();

  if (existing.data.length > 0) {
    return { success: true, message: '今日已打卡' };
  }

  // Create checkin record
  await checkinCollection.add({
    data: {
      openid,
      checkinDate,
      practiceTime: event.practiceTime || 0,
      practiceCount: event.practiceCount || 0,
      averageScore: event.averageScore || 0,
      createTime: db.serverDate()
    }
  });

  // Calculate consecutive days
  const { data: userData } = await userCollection.where({ openid }).get();
  const user = userData[0] || {};

  // Check if yesterday was checked in
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const yesterdayCheckin = await checkinCollection.where({
    openid,
    checkinDate: yesterdayStr
  }).get();

  let consecutiveDays = 1;
  if (yesterdayCheckin.data.length > 0) {
    consecutiveDays = (user.consecutiveDays || 0) + 1;
  }

  const totalDays = (user.totalDays || 0) + 1;

  // Update user stats
  await userCollection.where({ openid }).update({
    data: {
      consecutiveDays,
      totalDays
    }
  });

  return {
    success: true,
    consecutiveDays,
    totalDays
  };
}

// Get conversations list
async function getConversations(openid, event) {
  const { page = 1, pageSize = 10, mode = '' } = event;
  const skip = (page - 1) * pageSize;

  let query = db.collection('conversation').where({ openid });
  if (mode) {
    query = db.collection('conversation').where({ openid, mode });
  }

  const { data } = await query
    .orderBy('createTime', 'desc')
    .skip(skip)
    .limit(pageSize)
    .field({
      _id: true,
      mode: true,
      sceneId: true,
      sceneName: true,
      createTime: true,
      messageCount: true,
      lastMessage: true,
      score: true
    })
    .get();

  return { success: true, list: data };
}

// Get conversation detail
async function getConversationDetail(openid, event) {
  const { conversationId } = event;

  const { data } = await db.collection('conversation').doc(conversationId).get();

  if (!data || data.openid !== openid) {
    return { success: false, error: '记录不存在' };
  }

  // Get evaluation if exists
  const evalResult = await db.collection('evaluation').where({
    conversationId
  }).get();

  return {
    success: true,
    ...data,
    evaluation: evalResult.data.length > 0 ? evalResult.data[0] : null
  };
}

// Add a collection item
async function addCollection(openid, event) {
  const { content, role, source } = event;
  await db.collection('collection').add({
    data: {
      openid,
      content,
      role: role || 'assistant',
      source: source || '',
      mastered: false,
      createTime: db.serverDate()
    }
  });
  return { success: true };
}

// Get collections list
async function getCollections(openid, event) {
  const { page = 1, pageSize = 20, mastered } = event;
  let query = db.collection('collection').where({ openid });
  if (mastered !== undefined) {
    query = db.collection('collection').where({ openid, mastered });
  }
  const { data } = await query
    .orderBy('createTime', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();
  return { success: true, collections: data };
}

// Toggle mastered status
async function toggleMastered(openid, event) {
  const { id, mastered } = event;
  await db.collection('collection').doc(id).update({
    data: { mastered: !!mastered }
  });
  return { success: true };
}

// Delete a collection item
async function deleteCollection(openid, event) {
  const { id } = event;
  await db.collection('collection').doc(id).remove();
  return { success: true };
}

// Get recent evaluations for chart/records
async function getRecentEvaluations(openid, event) {
  const { limit = 7 } = event;
  const { data } = await db.collection('evaluation')
    .where({ openid })
    .orderBy('createTime', 'desc')
    .limit(limit)
    .get();
  return { success: true, evaluations: data.reverse() };
}

// Save daily challenge result
async function saveChallengeResult(openid, event) {
  const { score, date } = event;
  const existing = await db.collection('challenge').where({ openid, date }).get();
  if (existing.data.length > 0) {
    // Update only if new score is higher
    if (score > existing.data[0].score) {
      await db.collection('challenge').doc(existing.data[0]._id).update({ data: { score } });
    }
  } else {
    await db.collection('challenge').add({
      data: { openid, score, date, nickName: event.nickName || '匿名', createTime: db.serverDate() }
    });
  }
  return { success: true };
}

// Get challenge leaderboard for today
async function getChallengeLeaderboard(openid) {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await db.collection('challenge')
    .where({ date: today })
    .orderBy('score', 'desc')
    .limit(20)
    .get();

  const leaderboard = data.map((item, idx) => ({
    rank: idx + 1,
    nickName: item.nickName || '匿名',
    score: item.score,
    isMe: item.openid === openid
  }));

  return { success: true, leaderboard };
}

// Get checkin records for a month
async function getCheckinRecords(openid, event) {
  const { year, month } = event;
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  const { data: records } = await db.collection('checkin').where({
    openid,
    checkinDate: _.gte(startDate).and(_.lt(endDate))
  }).get();

  // Get user stats
  const { data: userData } = await db.collection('user').where({ openid }).get();
  const user = userData[0] || {};

  // Get today's practice
  const today = new Date().toISOString().split('T')[0];
  const todayRecords = records.filter(r => r.checkinDate === today);
  const todayPractice = todayRecords.length > 0 ? {
    count: todayRecords[0].practiceCount || 0,
    time: todayRecords[0].practiceTime || 0,
    score: todayRecords[0].averageScore || 0
  } : { count: 0, time: 0, score: 0 };

  return {
    success: true,
    records,
    consecutiveDays: user.consecutiveDays || 0,
    totalDays: user.totalDays || 0,
    todayPractice
  };
}

// Add practice time (累计到 user.totalPracticeTime 和当天 checkin.practiceTime)
// 单位：所有字段存"秒"，展示层再除 60
// 同时：
//  - 写一条 practiceLog（按模式统计用）
//  - 当天 checkin 不存在时自动建（但 isCheckedIn=false，即"练过了但没主动签到"）
//  - checkin.practiceCount +1，区别于 totalDays
async function addPracticeTime(openid, event) {
  const seconds = Math.max(0, Math.floor(Number(event.seconds) || 0));
  if (seconds < 1) return { success: true, added: 0 };
  const safe = Math.min(seconds, 60 * 60);
  const mode = String(event.mode || 'chat');
  const today = new Date().toISOString().split('T')[0];

  const userCol = db.collection('user');
  const userRes = await userCol.where({ openid }).get();
  if (userRes.data.length === 0) {
    return { success: true, added: 0 };
  }

  // 1. 累计到 user
  await userCol.doc(userRes.data[0]._id).update({
    data: { totalPracticeTime: db.command.inc(safe) }
  });

  // 2. 写/累计 checkin（当天没记录就创建一条）
  const checkinCol = db.collection('checkin');
  const ciRes = await checkinCol.where({ openid, checkinDate: today }).get();
  if (ciRes.data.length > 0) {
    await checkinCol.doc(ciRes.data[0]._id).update({
      data: {
        practiceTime: db.command.inc(safe),
        practiceCount: db.command.inc(1)
      }
    });
  } else {
    // 没打过卡也建一条（做为"自动打卡"）
    try {
      await checkinCol.add({
        data: {
          openid,
          checkinDate: today,
          practiceTime: safe,
          practiceCount: 1,
          averageScore: 0,
          createTime: db.serverDate()
        }
      });
    } catch (e) {
      if (/not exist/i.test(e.message || '') || e.errCode === -502005) {
        await ensureCollection('checkin');
        await checkinCol.add({
          data: {
            openid,
            checkinDate: today,
            practiceTime: safe,
            practiceCount: 1,
            averageScore: 0,
            createTime: db.serverDate()
          }
        });
      }
    }
  }

  // 3. 写 practiceLog（按模式统计）
  const logCol = db.collection('practiceLog');
  try {
    await logCol.add({
      data: {
        openid,
        mode,
        date: today,
        seconds: safe,
        createTime: db.serverDate()
      }
    });
  } catch (e) {
    if (/not exist/i.test(e.message || '') || e.errCode === -502005) {
      await ensureCollection('practiceLog');
      await logCol.add({
        data: {
          openid,
          mode,
          date: today,
          seconds: safe,
          createTime: db.serverDate()
        }
      });
    }
  }

  return { success: true, added: safe };
}

// Get mode-based practice counts (all-time)
async function getModeStats(openid) {
  const logCol = db.collection('practiceLog');
  try {
    // 聚合：按 mode group count
    const res = await logCol.aggregate()
      .match({ openid })
      .group({ _id: '$mode', count: $.sum(1) })
      .end();
    const stats = { chat: 0, scene: 0, topic: 0, grammar: 0, shadow: 0, vocab: 0, challenge: 0 };
    (res.list || []).forEach(r => {
      if (r._id && stats.hasOwnProperty(r._id)) stats[r._id] = r.count;
      else if (r._id) stats[r._id] = r.count;
    });
    return { success: true, stats };
  } catch (e) {
    // 集合不存在就返回空统计
    return { success: true, stats: { chat: 0, scene: 0, topic: 0, grammar: 0, shadow: 0, vocab: 0, challenge: 0 } };
  }
}
