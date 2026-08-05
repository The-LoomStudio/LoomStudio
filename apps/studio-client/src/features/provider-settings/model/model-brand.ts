export type ModelBrand = 'anthropic' | 'deepseek' | 'gemini' | 'grok' | 'meta' | 'mistral' | 'ollama' | 'openai' | 'openrouter' | 'qwen'

const modelBrands: Array<[ModelBrand, RegExp]> = [
  ['anthropic', /(^|[/:-])claude/],
  ['deepseek', /(^|[/:-])deepseek/],
  ['gemini', /(^|[/:-])(gemini|gemma)/],
  ['grok', /(^|[/:-])grok/],
  ['meta', /(^|[/:-])llama/],
  ['mistral', /(^|[/:-])(mistral|mixtral)/],
  ['ollama', /(^|[/:-])ollama/],
  ['openrouter', /(^|[/:-])openrouter/],
  ['qwen', /(^|[/:-])qwen/],
  ['openai', /(^|[/:-])(gpt|chatgpt|o1|o3|o4)([-.:/]|$)/],
]

export function resolveModelBrand(modelId: string): ModelBrand | null {
  const normalized = modelId.trim().toLocaleLowerCase()
  return modelBrands.find(([, pattern]) => pattern.test(normalized))?.[0] ?? null
}

export function resolveProviderBrand(...hints: string[]): ModelBrand | null {
  const normalized = hints.join(' ').toLocaleLowerCase()
  if (/openrouter/.test(normalized)) return 'openrouter'
  if (/anthropic|claude/.test(normalized)) return 'anthropic'
  if (/deepseek/.test(normalized)) return 'deepseek'
  if (/google|gemini/.test(normalized)) return 'gemini'
  if (/ollama/.test(normalized)) return 'ollama'
  if (/openai/.test(normalized)) return 'openai'
  return null
}
