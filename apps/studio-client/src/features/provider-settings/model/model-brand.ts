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

const modelBrands: Array<[ModelBrand, RegExp]> = [
  ['deepseek', /deepseek/],
  ['zhipu', /glm|chatglm|zhipu/],
  ['stepfun', /stepfun|(^|[^a-z0-9])step[-_]?[0-9]/],
  ['anthropic', /claude|anthropic/],
  ['gemini', /gemini|gemma/],
  ['qwen', /qwen|qwq/],
  ['moonshot', /moonshot|kimi/],
  ['doubao', /doubao/],
  ['minimax', /minimax|abab/],
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
  if (/ollama/.test(normalized)) return 'ollama'
  if (/siliconcloud|siliconflow/.test(normalized)) return 'siliconcloud'
  if (/moonshot|kimi/.test(normalized)) return 'moonshot'
  if (/zhipu|bigmodel|glm/.test(normalized)) return 'zhipu'
  if (/stepfun/.test(normalized)) return 'stepfun'
  if (/minimax/.test(normalized)) return 'minimax'
  if (/doubao|volcengine/.test(normalized)) return 'doubao'
  if (/mistral/.test(normalized)) return 'mistral'
  if (/grok|xai/.test(normalized)) return 'grok'
  if (/meta|llama/.test(normalized)) return 'meta'
  if (/qwen|aliyun|dashscope/.test(normalized)) return 'qwen'
  if (/\bofficial\.openai\b|api\.openai\.com/.test(normalized)) return 'openai'
  if (/\bopenai\b/.test(normalized) && !/openai[-_ ]compatible/.test(normalized)) return 'openai'
  return null
}
