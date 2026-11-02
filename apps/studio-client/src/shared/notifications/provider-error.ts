import type { Translator } from '../i18n/index.js'

export type ParsedProviderError = {
  messageKey: string
  params?: Record<string, string | number>
  detail?: string
  statusCode?: number
}

function parseJsonSafe(input: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(input)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Non-JSON input
  }
  return undefined
}

export function parseProviderError(error: unknown): ParsedProviderError {
  let statusCode: number | undefined
  const errorName = error instanceof Error ? error.name : ''
  const rawMessage = error instanceof Error ? error.message : String(error)
  let providerCode: string | undefined
  let providerDetailMessage: string | undefined

  // 1. 递归检查 status / statusCode / cause
  let current: unknown = error
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    if ('statusCode' in current && typeof current.statusCode === 'number') {
      statusCode = current.statusCode
    } else if ('status' in current && typeof current.status === 'number') {
      statusCode = current.status
    }

    if ('code' in current && typeof current.code === 'string') {
      providerCode ??= current.code
    }

    if ('responseBody' in current && typeof current.responseBody === 'string') {
      const parsedBody = parseJsonSafe(current.responseBody)
      if (parsedBody?.error && typeof parsedBody.error === 'object' && !Array.isArray(parsedBody.error)) {
        const errObj = parsedBody.error as Record<string, unknown>
        if (typeof errObj.message === 'string') providerDetailMessage ??= errObj.message
        if (typeof errObj.code === 'string') providerCode ??= errObj.code
      }
    }

    current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined
  }

  // 2. 从 message 文本中提取状态码和 JSON 错误体 (例如 "Provider request failed (401): ...")
  if (statusCode === undefined) {
    const statusMatch = /(?:HTTP\s*|failed\s*\(|status\s*[:=]\s*)(\d{3})\)?/i.exec(rawMessage)
    if (statusMatch?.[1]) {
      const parsedStatus = Number.parseInt(statusMatch[1], 10)
      if (parsedStatus >= 100 && parsedStatus <= 599) statusCode = parsedStatus
    }
  }

  // 检查 message 是否包含内嵌 JSON
  const jsonMatch = /\{.*"error".*\}/s.exec(rawMessage)
  if (jsonMatch) {
    const parsed = parseJsonSafe(jsonMatch[0])
    if (parsed?.error && typeof parsed.error === 'object' && !Array.isArray(parsed.error)) {
      const errObj = parsed.error as Record<string, unknown>
      if (typeof errObj.message === 'string') providerDetailMessage ??= errObj.message
      if (typeof errObj.code === 'string') providerCode ??= errObj.code
    }
  }

  const detail = providerDetailMessage || (rawMessage !== 'Error' && !rawMessage.startsWith('Provider request failed') ? rawMessage : undefined)
  const lowerMsg = (rawMessage + ' ' + (detail ?? '')).toLowerCase()

  // 3. 针对网络与系统级底层错误匹配
  if (errorName === 'ProviderConnectTimeoutError' || errorName === 'TimeoutError' || lowerMsg.includes('timeout') || lowerMsg.includes('timed out')) {
    return { messageKey: 'notify.provider.networkTimeout', detail, statusCode }
  }
  if (errorName === 'ProviderDnsError' || lowerMsg.includes('enotfound') || lowerMsg.includes('eai_again')) {
    return { messageKey: 'notify.provider.networkDns', detail, statusCode }
  }
  if (errorName === 'ProviderTlsError' || lowerMsg.includes('cert_') || lowerMsg.includes('unable_to_verify_leaf_signature')) {
    return { messageKey: 'notify.provider.networkTls', detail, statusCode }
  }
  if (errorName === 'ProviderNetworkError' || errorName === 'NetworkError' || lowerMsg.includes('failed to fetch') || lowerMsg.includes('econnrefused')) {
    return { messageKey: 'notify.provider.networkError', detail, statusCode }
  }
  if (lowerMsg.includes('stream ended') || lowerMsg.includes('stream interrupted')) {
    return { messageKey: 'notify.provider.streamInterrupted', detail, statusCode }
  }

  // 4. HTTP 状态码与厂商特征匹配
  if (statusCode === 401 || providerCode === 'invalid_api_key' || lowerMsg.includes('incorrect api key') || lowerMsg.includes('invalid api key')) {
    return { messageKey: 'notify.provider.authInvalid', detail, statusCode: 401 }
  }

  if (statusCode === 403 || lowerMsg.includes('country, region, or territory not supported') || lowerMsg.includes('forbidden')) {
    return { messageKey: 'notify.provider.forbidden', detail, statusCode: 403 }
  }

  if (statusCode === 404 || providerCode === 'model_not_found' || lowerMsg.includes('model not found') || lowerMsg.includes('does not exist')) {
    return { messageKey: 'notify.provider.modelNotFound', detail, statusCode: 404 }
  }

  if (statusCode === 429) {
    if (providerCode === 'insufficient_quota' || lowerMsg.includes('quota') || lowerMsg.includes('billing') || lowerMsg.includes('credit')) {
      return { messageKey: 'notify.provider.quotaExceeded', detail, statusCode: 429 }
    }
    return { messageKey: 'notify.provider.rateLimited', detail, statusCode: 429 }
  }

  if (statusCode === 400 || statusCode === 422) {
    if (lowerMsg.includes('context') || lowerMsg.includes('maximum context length') || lowerMsg.includes('too long') || lowerMsg.includes('token count')) {
      return { messageKey: 'notify.provider.contextOverflow', detail, statusCode }
    }
    return { messageKey: 'notify.provider.badRequest', detail, statusCode }
  }

  if (statusCode === 503 && lowerMsg.includes('overloaded')) {
    return { messageKey: 'notify.provider.upstreamOverloaded', detail, statusCode: 503 }
  }

  if (typeof statusCode === 'number' && statusCode >= 500) {
    return { messageKey: 'notify.provider.upstreamFailed', params: { status: statusCode }, detail, statusCode }
  }

  // 默认兜底
  return {
    messageKey: 'notify.provider.genericFailed',
    params: { detail: detail ? (detail.length > 80 ? `${detail.slice(0, 80)}...` : detail) : (statusCode ? `HTTP ${statusCode}` : '未知异常') },
    detail,
    statusCode,
  }
}

export function formatProviderErrorMessage(error: unknown, t?: Translator): { title: string; description?: string } {
  const parsed = parseProviderError(error)
  const title = t ? t(parsed.messageKey as never, parsed.messageKey === 'notify.provider.genericFailed' ? { detail: parsed.statusCode ? `HTTP ${parsed.statusCode}` : '请查看详情' } : parsed.params) : '模型调用失败'
  return {
    title,
    description: parsed.detail && parsed.detail !== title ? parsed.detail : undefined,
  }
}

/** Operation scopes also contain catalog reads; unknown failures do not identify a model call. */
export function isProviderOperationError(scope: string, message: string): boolean {
  const providerScope = scope === 'provider-settings' || scope === 'agent-chat' || /\bProvider\b/i.test(message)
  return providerScope && parseProviderError(message).messageKey !== 'notify.provider.genericFailed'
}
