/**
 * 常用大模型接口预设（单一事实来源）。
 *
 * 口径（Wayne 2026-09-15）：
 *   - 别人部署这套系统后，应该「选一个预设 → 填 key → 测通 → 拉模型 → 分配用途」四步搞定，
 *     而不是让他自己去查 base_url 和兼容模式；
 *   - 预设只是**便利清单**，不是白名单：所有字段都能手改（自定义预设就是空模板）；
 *   - 模型清单同理：能拉就拉真实的，拉不到就用这里的推荐值兜底。
 *
 * mode 的含义（= 界面上的「接口兼容模式」）：
 *   openai    走 OpenAI 风格 `POST {base}/chat/completions` + `GET {base}/models`
 *   anthropic 走 Claude Messages API `POST {base}/messages` + `GET {base}/models`
 */

/**
 * 两种协议的 Base URL 写法**不一样**，界面上的示例要分别给（Wayne 2026-09-15）：
 * 本系统是「Base URL + 固定后缀」的拼法，所以用户填的东西必须写到能接后缀的那一层：
 *   openai     → {base}/chat/completions、{base}/models
 *   anthropic  → {base}/messages、{base}/models
 * 最容易踩的坑是照抄 Anthropic SDK 文档里的 base_url —— SDK 会自己补 /v1，本系统不补。
 */
const MODES = [
  {
    value: 'openai',
    label: 'OpenAI 兼容',
    hint: '大多数国内厂商与本地推理服务都兼容这套路由',
    base_placeholder: 'https://api.deepseek.com/v1',
    base_suffix: '/chat/completions',
    /* 界面上的示例说明：写清楚「填到哪一层」+「结尾长什么样因厂商而异」 */
    base_hint: '只填到服务根路径，系统会在后面自动拼 /chat/completions 与 /models。'
      + '结尾不一定是 /v1 —— DeepSeek、Kimi 是 /v1，火山方舟是 /api/v3，智谱是 /api/paas/v4，照服务商文档填即可。',
    base_examples: [
      { label: 'DeepSeek', url: 'https://api.deepseek.com/v1' },
      { label: '通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      { label: '火山方舟', url: 'https://ark.cn-beijing.volces.com/api/v3' }
    ]
  },
  {
    value: 'anthropic',
    label: 'Anthropic Messages',
    hint: 'Claude 原生协议的 /messages 路由',
    base_placeholder: 'https://api.anthropic.com/v1',
    base_suffix: '/messages',
    /* ⚠️ 这条是本轮要讲清楚的区别：SDK 文档的 base_url 少了 /v1，直接抄会 404 */
    base_hint: '填的这一层后面会拼 /messages（不是 /chat/completions），所以必须带上 /v1：'
      + '官方是 https://api.anthropic.com/v1，Kimi 是 https://api.moonshot.cn/anthropic/v1，'
      + '智谱是 https://open.bigmodel.cn/api/anthropic/v1。'
      + '注意各家 SDK 文档里的 base_url 通常写到 /anthropic 为止（由 SDK 补 /v1），本系统不补，别直接照抄。',
    base_examples: [
      { label: 'Claude 官方', url: 'https://api.anthropic.com/v1' },
      { label: 'Kimi', url: 'https://api.moonshot.cn/anthropic/v1' },
      { label: '智谱 GLM', url: 'https://open.bigmodel.cn/api/anthropic/v1' }
    ]
  }
]

/** 模型用途：一个用途 = 系统里一处需要智能能力的地方，各自可挂不同模型 */
const PURPOSES = [
  { key: 'assistant_chat', label: '智能助手对话', hint: '右上角小皮的问答与指令理解', vision: false },
  { key: 'contract_parse', label: '合同智能解析', hint: '合同清洗中心抽取品名、价格、账期等字段', vision: false },
  { key: 'ocr', label: '图片 / 扫描件识别', hint: 'PDF 扫描件与图片资料，需要多模态模型', vision: true },
  { key: 'customer_profile', label: '客户画像分析', hint: '辅助判断客户跟进优先级', vision: false },
  { key: 'quote_suggest', label: '报价建议', hint: '基于历史成交价给出报价参考', vision: false }
]

const PRESETS = [
  {
    key: 'openai',
    label: 'OpenAI',
    base_url: 'https://api.openai.com/v1',
    mode: 'openai',
    key_hint: 'sk-...',
    docs: 'https://platform.openai.com/api-keys',
    note: '官方直连，国内网络通常需要自备代理',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini']
  },
  {
    key: 'anthropic',
    label: 'Anthropic Claude',
    base_url: 'https://api.anthropic.com/v1',
    mode: 'anthropic',
    key_hint: 'sk-ant-...',
    docs: 'https://console.anthropic.com/settings/keys',
    note: '长文档与合同条款理解表现好',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-3-5-haiku-latest']
  },
  {
    /* 和下面的 Kimi（OpenAI 兼容）是两个不同的地址，放一起就是为了让对比一眼可见 */
    key: 'moonshot-anthropic',
    label: '月之暗面 Kimi · Anthropic 协议',
    base_url: 'https://api.moonshot.cn/anthropic/v1',
    mode: 'anthropic',
    key_hint: 'sk-...',
    docs: 'https://platform.moonshot.cn/console/api-keys',
    note: '同一个 Kimi key，但地址与下面那条「Kimi」不一样：这条是 /anthropic/v1（Claude 协议），'
      + '那条是 /v1（OpenAI 协议），填错会 404',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-128k']
  },
  {
    key: 'zhipu-anthropic',
    label: '智谱 GLM · Anthropic 协议',
    base_url: 'https://open.bigmodel.cn/api/anthropic/v1',
    mode: 'anthropic',
    key_hint: 'xxxxx.xxxxx',
    docs: 'https://open.bigmodel.cn/usercenter/apikeys',
    note: '同一家的 Anthropic 兼容入口是 /api/anthropic/v1，OpenAI 兼容是 /api/paas/v4',
    models: ['glm-4-plus', 'glm-4-air']
  },
  {
    key: 'deepseek',
    label: 'DeepSeek 深度求索',
    base_url: 'https://api.deepseek.com/v1',
    mode: 'openai',
    key_hint: 'sk-...',
    docs: 'https://platform.deepseek.com/api_keys',
    note: '性价比高，中文业务理解稳定',
    models: ['deepseek-chat', 'deepseek-reasoner']
  },
  {
    key: 'moonshot',
    label: '月之暗面 Kimi',
    base_url: 'https://api.moonshot.cn/v1',
    mode: 'openai',
    key_hint: 'sk-...',
    docs: 'https://platform.moonshot.cn/console/api-keys',
    note: '长上下文，适合整份合同通读',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-32k', 'moonshot-v1-128k']
  },
  {
    key: 'qwen',
    label: '阿里通义千问（DashScope 兼容模式）',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    mode: 'openai',
    key_hint: 'sk-...',
    docs: 'https://bailian.console.aliyun.com/',
    note: 'qwen-vl 系列可用于图片识别',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-vl-max']
  },
  {
    key: 'zhipu',
    label: '智谱 GLM',
    base_url: 'https://open.bigmodel.cn/api/paas/v4',
    mode: 'openai',
    key_hint: 'xxxxx.xxxxx',
    docs: 'https://open.bigmodel.cn/usercenter/apikeys',
    note: 'glm-4v 支持图片输入',
    models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash', 'glm-4v-plus']
  },
  {
    key: 'doubao',
    label: '火山方舟（豆包）',
    base_url: 'https://ark.cn-beijing.volces.com/api/v3',
    mode: 'openai',
    key_hint: '火山方舟 API Key',
    docs: 'https://console.volcengine.com/ark',
    note: '模型名要填方舟上的「推理接入点 ID」（ep-开头），或直接填模型名',
    models: []
  },
  {
    key: 'openrouter',
    label: 'OpenRouter（聚合网关）',
    base_url: 'https://openrouter.ai/api/v1',
    mode: 'openai',
    key_hint: 'sk-or-...',
    docs: 'https://openrouter.ai/keys',
    note: '一个 key 打通多家模型，适合先试后定',
    models: []
  },
  {
    key: 'ollama',
    label: '本地 Ollama',
    base_url: 'http://127.0.0.1:11434/v1',
    mode: 'openai',
    key_hint: '本地服务通常留空',
    docs: 'https://ollama.com/download',
    note: '完全离线，数据不出本机；密钥可留空',
    needs_key: false,
    models: ['qwen2.5:7b', 'qwen2.5:14b', 'llama3.1:8b', 'deepseek-r1:7b']
  },
  {
    key: 'custom',
    label: '自定义 / 私有部署',
    base_url: '',
    mode: 'openai',
    key_hint: '按你的网关要求填写',
    docs: '',
    note: '任何兼容 OpenAI 或 Anthropic 协议的网关都可以接',
    models: []
  }
]

const PRESET_MAP = new Map(PRESETS.map(item => [item.key, item]));
const PURPOSE_KEYS = PURPOSES.map(item => item.key);

module.exports = { MODES, PRESETS, PRESET_MAP, PURPOSES, PURPOSE_KEYS };
