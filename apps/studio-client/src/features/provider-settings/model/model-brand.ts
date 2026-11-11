import { normalizeSearchText } from '../../../shared/lib/text.js'

export type ModelBrand =
  | 'anthropic'
  | 'deepseek'
  | 'gemini'
  | 'grok'
  | 'meta'
  | 'mistral'
  | 'ollama'
  | 'openai'
  | 'openrouter'
  | 'qwen'
  | 'zhipu'
  | 'moonshot'
  | 'siliconcloud'
  | 'minimax'
  | 'doubao'
  | 'stepfun'
  | 'nvidia'
  | 'cohere'
  | 'perplexity'
  | 'yi'
  | 'hunyuan'
  | 'baichuan'
  | 'groq'

const modelBrands: Array<[ModelBrand, RegExp]> = [
  ['deepseek', /deepseek/],
  ['zhipu', /glm|chatglm|zhipu/],
  ['stepfun', /stepfun|(^|[^a-z0-9])step[-_]?[0-9]/],
  ['anthropic', /claude|anthropic/],
  ['gemini', /gemini|gemma/],
  ['qwen', /qwen|qwq/],
  ['nvidia', /nvidia|nemotron/],
  ['moonshot', /moonshot|kimi/],
  ['doubao', /doubao/],
  ['minimax', /minimax|abab/],
  ['cohere', /cohere|command[-_]?r?/],
  ['perplexity', /perplexity|sonar/],
  ['yi', /01-ai|(^|[^a-z0-9])yi[-_.:/0-9]/],
  ['hunyuan', /hunyuan/],
  ['baichuan', /baichuan/],
  ['groq', /groq/],
  ['grok', /grok/],
  ['meta', /llama/],
  ['mistral', /mistral|mixtral/],
  ['siliconcloud', /silicon/],
  ['ollama', /ollama/],
  ['openrouter', /openrouter/],
  ['openai', /(^|[^a-z0-9])(gpt|chatgpt|o1|o3|o4|dall-e)([-_.:/0-9]|$)/],
]

export function resolveModelBrand(modelId: string): ModelBrand | null {
  const normalized = normalizeSearchText(modelId)
  return modelBrands.find(([, pattern]) => pattern.test(normalized))?.[0] ?? null
}

export function resolveProviderBrand(...hints: string[]): ModelBrand | null {
  const normalized = normalizeSearchText(hints.join(' '))
  if (/openrouter/.test(normalized)) return 'openrouter'
  if (/anthropic|claude/.test(normalized)) return 'anthropic'
  if (/deepseek/.test(normalized)) return 'deepseek'
  if (/google|gemini/.test(normalized)) return 'gemini'
  if (/nvidia/.test(normalized)) return 'nvidia'
  if (/ollama/.test(normalized)) return 'ollama'
  if (/siliconcloud|siliconflow/.test(normalized)) return 'siliconcloud'
  if (/moonshot|kimi/.test(normalized)) return 'moonshot'
  if (/zhipu|bigmodel|glm/.test(normalized)) return 'zhipu'
  if (/stepfun/.test(normalized)) return 'stepfun'
  if (/minimax/.test(normalized)) return 'minimax'
  if (/doubao|volcengine/.test(normalized)) return 'doubao'
  if (/mistral/.test(normalized)) return 'mistral'
  if (/cohere/.test(normalized)) return 'cohere'
  if (/perplexity/.test(normalized)) return 'perplexity'
  if (/groq/.test(normalized)) return 'groq'
  if (/yi|zeroone|01-ai/.test(normalized)) return 'yi'
  if (/hunyuan|tencent/.test(normalized)) return 'hunyuan'
  if (/baichuan/.test(normalized)) return 'baichuan'
  if (/grok|xai/.test(normalized)) return 'grok'
  if (/meta|llama/.test(normalized)) return 'meta'
  if (/qwen|aliyun|dashscope/.test(normalized)) return 'qwen'
  // 若无特定专有品牌，按适配协议类型默认兜底（OpenAI API 兼容协议默认回退为 OpenAI 图标）
  if (/openai/.test(normalized)) return 'openai'
  return null
}
