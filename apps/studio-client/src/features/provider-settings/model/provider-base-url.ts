export function normalizeOpenAICompatibleBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (trimmed === 'https://api.openai.com') return 'https://api.openai.com/v1'
  return trimmed
}

export function readChatCompletionsEndpoint(baseUrl: string): string {
  const normalized = normalizeOpenAICompatibleBaseUrl(baseUrl)
  return normalized ? `${normalized}/chat/completions` : ''
}

export function isLikelyProviderEndpoint(baseUrl: string): boolean {
  return /\/(?:chat\/completions|completions|embeddings|images\/generations|responses)$/.test(normalizeOpenAICompatibleBaseUrl(baseUrl))
}
