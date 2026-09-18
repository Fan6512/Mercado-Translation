// ===== 默认全局 Prompt =====
const DEFAULT_GLOBAL_PROMPT = `你是资深跨境电商运营 + 多语言 SEO 专家，精通亚马逊/Shopee/Mercado Libre/Shein/速卖通的搜索算法和标题优化。

【任务】输出四语标题：
1. English（全球/北美/跨境大盘）
2. Español（中性拉美西语，针对墨西哥/智利/哥伦比亚，避免西班牙本土用词）
3. Português（巴西本土口语化电商表达，区别于葡萄牙葡语）
4. 中文（淘宝/拼多多/虾皮台湾）

【字符数硬规则 — 必须严格遵守】
- 英语/西语/葡语：每条标题 **必须 ≤ {CHAR_LIMIT} 字符**（含空格），不允许超过哪怕 1 个字符
- 中文：**必须 ≤ {CHAR_LIMIT_CN} 字符**（汉字=2字符，标点/数字/字母=1字符）
- 凭经验控制长度，不要逐字去数：写完一条若明显偏长，直接删掉次要形容词收缩
- 宁可少 5 个字符也不要超 1 个字符（万一超限有后续自动压缩兜底，无需为此反复核对）

【内容规则】
- **不要在标题里加数量单位**（如 1 Pcs、1 Pza、1 Un、1件装、1个装），除非用户明确告知是多件套装
- 标题骨架 = 风格/材质标签 + 核心类目大词（高搜词） + 1-2个关键卖点
- 不堆无意义形容词，每词承担 SEO 权重
- 拼写 100% 正确，西/葡语重音必须对：Corazón、Coração、Ajustável、Aço Inoxidável

【输出格式】只返回 JSON，不要任何前后文字、不要 markdown 代码块：
{
  "en": { "title": "..." },
  "es": { "title": "...", "analysis": "核心大词 / 卖点 / 字符策略" },
  "pt": { "title": "...", "analysis": "..." },
  "zh": { "title": "..." }
}
注意：仅 es 和 pt 需要 analysis 字段，en 和 zh 只输出 title 即可（节省 token 加快速度）。`;

// ===== 状态 =====
const STORE = {
  settings: 'translator_settings_v1',      // 旧版（仅迁移用）
  profiles: 'translator_profiles_v1',      // 新：多配置
  globalPrompt: 'translator_global_prompt_v1',
  history: 'translator_history_v1',
};

// 预设模板（新建配置时可选）
const PROFILE_PRESETS = {
  '移动云 MiniMax': { base: 'https://zhenze-huhehaote.cmecloud.cn/v1', key: '', model: 'minimax-m2.5', temp: 0.7, maxTokens: 4096 },
  'OpenAI': { base: 'https://api.openai.com/v1', key: '', model: 'gpt-4o-mini', temp: 0.7, maxTokens: 4000 },
  'Gemini': { base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: '', model: 'gemini-2.5-flash', temp: 0.7, maxTokens: 4000 },
  'DeepSeek': { base: 'https://api.deepseek.com/v1', key: '', model: 'deepseek-chat', temp: 0.7, maxTokens: 4000 },
  'OpenRouter': { base: 'https://openrouter.ai/api/v1', key: '', model: 'google/gemini-2.5-flash', temp: 0.7, maxTokens: 4000 },
  '通义千问': { base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', key: '', model: 'qwen-plus', temp: 0.7, maxTokens: 4000 },
  '空白': { base: '', key: '', model: '', temp: 0.7, maxTokens: 4000 },
};

// ===== 配置数据模型 =====
function genId() { return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// 补齐配置的新增字段（向后兼容旧数据）。
// 字符上限原本存在 store 级，现下放到每个配置：老配置继承全局值，之后各自独立。
function normalizeProfile(p, data) {
  const defaults = {
    name: '未命名配置', base: '', key: '', model: '',
    temp: 0.7, maxTokens: 4000, stream: true,
    timeout: 120, retry: 2,
    charLimit: data.charLimit ?? 55,
    charLimitCN: data.charLimitCN ?? 60,
  };
  const out = { ...defaults, ...p };
  // proxy 是对象，需合并而非整体替换，避免旧数据缺字段
  out.proxy = { enabled: false, mode: 'system', url: '', ...(p && p.proxy ? p.proxy : {}) };
  return out;
}

const SCHEMA_VERSION = 2;
function loadProfilesStore() {
  let data = JSON.parse(localStorage.getItem(STORE.profiles) || 'null');
  if (!data) {
    // 迁移旧版单配置
    const old = JSON.parse(localStorage.getItem(STORE.settings) || 'null');
    const id = genId();
    data = (old && (old.base || old.key))
      ? {
          profiles: [{ id, name: '默认配置', base: old.base || '', key: old.key || '', model: old.model || '', temp: old.temp ?? 0.7, maxTokens: old.maxTokens ?? 4000 }],
          activeId: id,
          charLimit: old.charLimit ?? 55,
          charLimitCN: old.charLimitCN ?? 60,
        }
      : {
          profiles: [{ id, name: '默认配置', ...PROFILE_PRESETS['空白'] }],
          activeId: id,
          charLimit: 55,
          charLimitCN: 60,
        };
  }
  // 内存中始终补齐新增字段；首次升级时落盘一次
  data.profiles = (data.profiles || []).map(p => normalizeProfile(p, data));
  if (data.schemaVersion !== SCHEMA_VERSION) {
    data.schemaVersion = SCHEMA_VERSION;
    try { localStorage.setItem(STORE.profiles, JSON.stringify(data)); } catch {}
  }
  return data;
}
function saveProfilesStore(data) {
  localStorage.setItem(STORE.profiles, JSON.stringify(data));
}
function getActiveProfile() {
  const data = loadProfilesStore();
  return data.profiles.find(p => p.id === data.activeId) || data.profiles[0];
}
function getSettings() {
  const data = loadProfilesStore();
  const active = getActiveProfile();
  // 字符上限已下放到配置；老数据回退到 store 级全局值
  return {
    ...active,
    charLimit: active.charLimit ?? data.charLimit ?? 55,
    charLimitCN: active.charLimitCN ?? data.charLimitCN ?? 60,
  };
}
