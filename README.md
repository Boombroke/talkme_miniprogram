# Talkme - 互动式英语口语练习系统

基于微信小程序 + 云开发的 AI 英语口语练习平台，集成**智谱 GLM-4** 和**阿里 Qwen3-Omni** 双大模型以及腾讯云语音服务，提供多场景、多模式的沉浸式英语口语训练体验。

> **双模型架构**：文字输入走智谱 GLM-4-Flash（低延迟、低成本），语音输入走 Qwen3-Omni-Flash（直接听音频、一步评估发音+语法+内容，无需 ASR 中转）。

## 功能模块

### 核心练习模式

| 模式 | 说明 |
|------|------|
| **自由对话** | 与 AI 进行开放式英语对话，支持文字输入和语音输入；文字走 GLM-4，语音直传 Qwen-Omni（能听到发音并纠错），AI 自动纠错并回复语音 |
| **情景实战** | 5 大真实生活场景（咖啡店点单、求职面试、机场问路、酒店入住、看病就医），AI 扮演对应角色进行沉浸式对话 |
| **话题挑战** | 选择话题后 30 秒准备，限时 2 分钟口语独白录音，Qwen-Omni 直接听音频从主题相关性、语法、词汇、流畅度四维评估 |
| **语法专练** | AI 动态生成语法题（填空、纠错、句型转换），支持灵活判分，附带解析 |
| **影子跟读** | 听 AI 朗读后跟读录音，Qwen-Omni 直接听录音评估发音相似度 |
| **词汇闪卡** | 学习单词 + 造句练习，AI 判断用词正确性和自然度并给出改进建议 |
| **每日挑战** | 每天更新口语挑战话题，限时录音 + Qwen-Omni 音频评分，支持排行榜 |

### 辅助功能

- **难度分级**：入门 / 初级 / 中级 / 高级，四档难度影响 AI 回复复杂度和题目等级
- **对话评估**：对话结束后 AI 从发音、语法、流畅度、词汇四维度评分（0-100），支持文本评估（GLM-4）和音频直传评估（Qwen-Omni）两条链路
- **语音播放**：AI 回复自动朗读（TTS），支持点击重播，LRU 缓存最近 10 条音频
- **实时翻译**：点击 AI 消息可翻译为中文
- **句子收藏**：收藏对话中的好句子，支持已掌握 / 未掌握筛选
- **学习打卡**：日历打卡，连续天数统计，可生成打卡海报分享
- **历史记录**：对话记录分页列表，可查看完整对话内容和评分详情
- **每日一句**：首页展示每日英语名言（中英双语），按日期轮换（31 条内置名言）

## 技术架构

```
┌─────────────────────────────────────────────────────┐
│                    微信小程序                         │
│  ┌──────────┬──────────┬──────────┬──────────┐      │
│  │   首页   │   打卡   │   记录   │   我的   │      │
│  └──────────┴──────────┴──────────┴──────────┘      │
│  页面层：17 个页面 + 6 个自定义组件                    │
│  工具层：api.js / auth.js / util.js / score.wxs      │
│  UI 组件库：Vant Weapp                               │
├─────────────────────────────────────────────────────┤
│                  微信云开发                           │
│  ┌───────────────────────────────────────────────┐  │
│  │ 云函数                                         │  │
│  │  ├─ login             用户管理/打卡/收藏/排行榜 │  │
│  │  ├─ chat              文字对话（智谱 GLM-4）    │  │
│  │  ├─ voiceChat         语音对话（Qwen3-Omni）   │  │
│  │  ├─ evaluate          对话评估（GLM-4 文本      │  │
│  │  │                    + Qwen-Omni 音频双链路）  │  │
│  │  ├─ speechRecognition 语音识别（腾讯云 ASR）    │  │
│  │  ├─ textToSpeech      语音合成（腾讯云 TTS）    │  │
│  │  └─ cleanupFiles      云存储定时清理            │  │
│  ├───────────────────────────────────────────────┤  │
│  │ 云数据库                                       │  │
│  │  user / conversation / evaluation /            │  │
│  │  checkin / collection / challenge              │  │
│  ├───────────────────────────────────────────────┤  │
│  │ 云存储                                         │  │
│  │  audio/ (用户录音)  tts/ (合成语音)             │  │
│  │  shadow/ topic/ challenge/ (各模式录音)         │  │
│  └───────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│                  外部 AI 服务                        │
│  ┌─────────────────────┬─────────────────────────┐  │
│  │ 智谱 GLM-4-Flash    │ 阿里 Qwen3-Omni-Flash  │  │
│  │ 文字输入对话/语法/   │ 语音直传对话/音频评估/  │  │
│  │ 翻译/造句判断        │ 发音纠错               │  │
│  │ open.bigmodel.cn    │ dashscope.aliyuncs.com  │  │
│  └─────────────────────┴─────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 技术栈

| 层面 | 技术 |
|------|------|
| **前端** | 微信小程序原生框架 + Vant Weapp 组件库 |
| **后端** | 微信云开发（云函数 Node.js + 云数据库 + 云存储） |
| **AI 大模型（文本）** | 智谱 GLM-4-Flash — 对话生成、语法出题、口语文本评估、造句评判、翻译 |
| **AI 大模型（多模态）** | 阿里 Qwen3-Omni-Flash — 语音直传对话、音频评估（发音+语法+流畅度+词汇）、SSE 流式响应 |
| **语音识别** | 腾讯云 ASR（16k 英语模型，一句话识别）— 备用链路 |
| **语音合成** | 腾讯云 TTS（大模型英文女声 Tiana，MP3 格式） |
| **基础库版本** | >= 2.2.3（云能力依赖） |
| **导航样式** | 自定义导航栏（navigationStyle: custom）+ 自定义 TabBar |
| **小程序 lib 版本** | 3.3.4 |

### 双模型分工策略

| 输入方式 | AI 模型 | 说明 |
|----------|---------|------|
| 文字输入（键盘） | 智谱 GLM-4-Flash | 低延迟、低成本，适合文本交互 |
| 语音输入（录音） | Qwen3-Omni-Flash | 直接接收音频，能听到发音并给出纠正，无需 ASR 中转 |
| 对话评估（文本） | 智谱 GLM-4-Flash | 基于对话文本的四维评分 |
| 对话评估（音频） | Qwen3-Omni-Flash | 直接听录音评估，话题挑战/影子跟读/每日挑战均走此链路 |
| 语法/词汇/翻译 | 智谱 GLM-4-Flash | 纯文本任务，成本最优 |

## 项目结构

```
Talkme/
├── app.js                   # 应用入口，云开发初始化，登录状态检查，iOS 静音模式设置
├── app.json                 # 页面路由（17 页）、TabBar 配置、窗口样式
├── app.wxss                 # 全局样式，动画库，工具类
├── package.json             # npm 依赖（@vant/weapp ^1.11.6）
├── project.config.json      # 项目配置，AppID，云函数根目录
│
├── pages/
│   ├── index/               # 首页（难度选择、快捷入口、每日一句、学习统计）
│   ├── login/               # 登录页
│   ├── chat/                # 对话页（自由对话 & 情景对话，文字/语音输入，TTS 播放）
│   │                        #   文字 → chat 云函数（GLM-4）
│   │                        #   语音 → voiceChat 云函数（Qwen-Omni，直传音频）
│   ├── scene/
│   │   ├── list/            # 情景列表（5 大场景卡片）
│   │   └── detail/          # 情景详情 → 进入对话
│   ├── topic/               # 话题挑战（选题 → 准备 → 录音 → Qwen-Omni 音频评估）
│   ├── grammar/             # 语法专练（AI 出题 → 答题 → AI 判分）
│   ├── shadow/              # 影子跟读（听读 → 跟读 → Qwen-Omni 音频评估发音相似度）
│   ├── vocab/               # 词汇闪卡（学词 → 造句 → AI 评判）
│   ├── challenge/           # 每日挑战（限时录音 + Qwen-Omni 音频评分 + 排行榜）
│   ├── result/              # 评估结果页（四维评分展示 + TTS 播放纠正示例）
│   ├── evaluation/          # 评分历史记录
│   ├── checkin/             # 打卡页（日历、连续天数、海报生成、排行榜）
│   ├── collection/          # 收藏夹（筛选、已掌握标记、删除）
│   ├── history/
│   │   ├── list/            # 对话记录列表
│   │   └── detail/          # 对话详情回顾
│   └── profile/             # 个人中心
│
├── custom-tab-bar/          # 自定义 TabBar（Vant Weapp 样式，4 Tab 切换）
│
├── components/
│   ├── nav-bar/             # 自定义导航栏组件（适配状态栏高度、胶囊按钮位置、返回键）
│   ├── svg-icon/            # SVG 图标组件（内置 20+ 双色图标，支持 filled/outline 切换）
│   ├── voice-btn/           # 语音录制按钮组件
│   ├── chat-bubble/         # 聊天气泡组件（TTS、翻译、收藏、重试、纠错提示）
│   ├── score-card/          # 评分卡片组件
│   └── calendar/            # 日历打卡组件
│
├── cloudfunctions/
│   ├── common/
│   │   ├── llm-config.js    # LLM 配置（智谱 + Qwen-Omni 双模型地址与模型名）
│   │   └── qwen-stream.js   # Qwen-Omni SSE 流式响应解析工具 + 音频内容构建
│   ├── login/               # 用户管理云函数（登录、打卡、收藏、排行榜等 14 个 action）
│   ├── chat/                # 文字对话云函数（智谱 GLM-4，多场景 Prompt + 难度调节）
│   ├── voiceChat/           # 语音对话云函数（Qwen3-Omni，音频直传，SSE 流式拼接）
│   ├── evaluate/            # 对话评估云函数（双链路：GLM-4 文本评估 + Qwen-Omni 音频评估）
│   ├── speechRecognition/   # 语音识别云函数（腾讯云 ASR，备用链路）
│   ├── textToSpeech/        # 语音合成云函数（腾讯云 TTS，大模型英文女声 Tiana）
│   └── cleanupFiles/        # 云存储定时清理（默认 7 天过期）
│
├── utils/
│   ├── api.js               # 云函数统一调用封装（重试、Loading、超时、voiceChat/audioEvaluate）
│   ├── auth.js              # 登录授权工具（状态检查、登录流程、缓存管理）
│   ├── util.js              # 通用工具（日期格式化、防抖节流、Toast 封装、相对时间、连续打卡火苗等级等）
│   └── score.wxs            # WXS 评分颜色/样式辅助（WXML 模板中使用）
│
├── styles/
│   ├── variables.wxss       # 设计令牌（珊瑚橙暖色调，色彩、字号、间距、圆角、阴影）
│   └── mixins.wxss          # 样式混入
│
├── images/                  # 图片资源
│   ├── tab/                 # TabBar 图标（home/checkin/history/profile，含 active 态）
│   ├── scenes/              # 场景插图
│   ├── icons/               # 功能图标
│   └── empty/               # 空状态图
│
└── assets/
    └── fonts/               # 字体文件
```

## 环境准备

### 前置要求

1. [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)（稳定版）
2. 一个已开通 **云开发** 的微信小程序 AppID
3. [智谱 AI 开放平台](https://open.bigmodel.cn/) 账号及 API Key
4. [阿里云 DashScope](https://dashscope.console.aliyun.com/) 账号及 API Key（用于 Qwen-Omni 语音对话和音频评估）
5. [腾讯云](https://cloud.tencent.com/) 账号，开通 ASR（语音识别）和 TTS（语音合成）服务

### 配置步骤

#### 1. 克隆项目

```bash
git clone <repository-url>
```

#### 2. 微信开发者工具导入

- 打开微信开发者工具
- 选择「导入项目」
- 目录选择项目根目录
- AppID 填写你的小程序 AppID（需替换 `project.config.json` 中的 `appid` 字段）

#### 3. 安装 npm 依赖

在微信开发者工具中：

- 点击「工具」→「构建 npm」
- 等待构建完成（会生成 `miniprogram_npm` 目录）

#### 4. 创建云开发环境

- 在微信开发者工具中点击「云开发」控制台
- 创建云开发环境，记录环境 ID
- 修改 `app.js` 中 `wx.cloud.init` 的 `env` 值为你的环境 ID
- 同步修改 `app.js` 中 `globalData.envId`

#### 5. 初始化云数据库

在云开发控制台 → 数据库中创建以下集合：

| 集合名 | 说明 |
|--------|------|
| `user` | 用户信息 |
| `conversation` | 对话记录 |
| `evaluation` | 评估结果 |
| `checkin` | 打卡记录 |
| `collection` | 句子收藏 |
| `challenge` | 每日挑战记录 |

每个集合的权限规则建议设置为「仅创建者可读写」。

#### 6. 配置云函数环境变量

在云开发控制台 → 云函数中，为以下云函数配置环境变量：

**chat 云函数**：

| 变量名 | 说明 |
|--------|------|
| `ZHIPU_API_KEY` | 智谱 AI 的 API Key |

**voiceChat 云函数**：

| 变量名 | 说明 |
|--------|------|
| `DASHSCOPE_API_KEY` | 阿里云 DashScope 的 API Key |

**evaluate 云函数**（双模型，需两个 Key）：

| 变量名 | 说明 |
|--------|------|
| `ZHIPU_API_KEY` | 智谱 AI 的 API Key（文本评估链路） |
| `DASHSCOPE_API_KEY` | 阿里云 DashScope 的 API Key（音频评估链路） |

**speechRecognition 和 textToSpeech 云函数**：

| 变量名 | 说明 |
|--------|------|
| `TENCENT_SECRET_ID` | 腾讯云 API SecretId |
| `TENCENT_SECRET_KEY` | 腾讯云 API SecretKey |

#### 7. 上传并部署云函数

在微信开发者工具中，右键点击 `cloudfunctions` 下的每个云函数目录，选择「上传并部署：云端安装依赖」：

- `login`
- `chat`
- `voiceChat`
- `evaluate`
- `speechRecognition`
- `textToSpeech`
- `cleanupFiles`

## 开发与调试

```bash
# 本地开发
# 1. 用微信开发者工具打开项目
# 2. 开启「不校验合法域名」（开发阶段）
# 3. 模拟器 / 真机预览均可调试
```

### 调试技巧

- **云函数本地调试**：右键云函数 →「本地调试」，可断点调试云函数逻辑
- **云数据库查看**：云开发控制台可直接查看和编辑数据库记录
- **网络请求**：开发者工具「调试器」→「Network」面板可查看云函数调用
- **真机调试**：开发者工具 →「真机调试」，语音相关功能需在真机上测试
- **Qwen-Omni 调试**：voiceChat 云函数超时设置为 120 秒，音频处理耗时较长，建议真机测试

## 上线部署

### 部署清单

- [ ] 替换 `project.config.json` 中的 `appid` 为正式 AppID
- [ ] 替换 `app.js` 中的云开发环境 ID 为正式环境
- [ ] 确保所有 7 个云函数已部署到正式环境，环境变量配置正确
- [ ] 确保云数据库 6 个集合已创建且权限设置正确
- [ ] 在微信公众平台 → 开发管理 → 服务器域名中添加：
  - `request` 合法域名：`https://open.bigmodel.cn`（智谱 API）
  - `request` 合法域名：`https://dashscope.aliyuncs.com`（阿里 DashScope API）
- [ ] 腾讯云 ASR/TTS 服务已开通且密钥有效
- [ ] 智谱 AI API Key 额度充足
- [ ] 阿里云 DashScope API Key 额度充足（Qwen3-Omni-Flash）
- [ ] 小程序类目选择「教育 - 在线教育」（或相关教育类目）
- [ ] 完善小程序隐私协议（涉及录音、用户信息）
- [ ] 提交代码审核并发布

### 注意事项

1. **API Key 安全**：所有密钥通过云函数环境变量注入，不要硬编码到代码中
2. **录音权限**：语音相关功能需要用户授权麦克风权限，代码中已有相应处理
3. **费用控制**：
   - 智谱 GLM-4-Flash 按 token 计费，chat 云函数限制了对话历史为最近 20 条
   - 腾讯云 ASR/TTS 有免费额度，超出后按调用次数计费
   - 云存储音频文件会持续增长，`cleanupFiles` 云函数可配置定时触发器清理过期文件
4. **性能优化**：
   - 云函数已配置 60 秒超时，适配大模型响应延迟
   - TTS 音频采用 LRU 缓存（客户端缓存 10 条），减少重复请求
   - 页面采用 `lazyCodeLoading` 按需加载组件

## 数据库设计

### user 集合

```json
{
  "openid": "用户 OpenID",
  "nickName": "英语学习者",
  "avatarUrl": "",
  "totalPracticeTime": 0,
  "totalDays": 0,
  "consecutiveDays": 0,
  "averageScore": 0,
  "createTime": "ServerDate"
}
```

### conversation 集合

```json
{
  "openid": "用户 OpenID",
  "mode": "free | scene",
  "sceneId": "coffee | interview | ...",
  "sceneName": "咖啡店点单",
  "messages": [{ "role": "user|assistant", "content": "...", "timestamp": "..." }],
  "lastMessage": "最后一条消息摘要",
  "messageCount": 10,
  "score": 75,
  "createTime": "ServerDate",
  "updateTime": "ServerDate"
}
```

### evaluation 集合

```json
{
  "openid": "用户 OpenID",
  "conversationId": "关联对话 ID",
  "sceneId": "场景 ID（可选）",
  "mode": "free | scene | topic | shadow | challenge",
  "duration": 120,
  "totalScore": 75,
  "pronunciation": { "score": 70, "issues": [] },
  "grammar": { "score": 80, "issues": [] },
  "fluency": { "score": 75, "issues": [] },
  "vocabulary": { "score": 78, "issues": [] },
  "correctedSentence": "纠正后的句子",
  "suggestions": ["改进建议"],
  "encouragement": "鼓励语",
  "audioEval": true,
  "transcript": "语音转写文本（音频评估时）",
  "wordCount": 15,
  "createTime": "ServerDate"
}
```

### checkin 集合

```json
{
  "openid": "用户 OpenID",
  "checkinDate": "2025-04-06",
  "practiceTime": 0,
  "practiceCount": 0,
  "averageScore": 0,
  "createTime": "ServerDate"
}
```

### collection 集合

```json
{
  "openid": "用户 OpenID",
  "content": "收藏的句子",
  "role": "assistant",
  "source": "自由对话",
  "mastered": false,
  "createTime": "ServerDate"
}
```

### challenge 集合

```json
{
  "openid": "用户 OpenID",
  "score": 85,
  "date": "2025-04-06",
  "nickName": "用户昵称",
  "createTime": "ServerDate"
}
```

## License

MIT
