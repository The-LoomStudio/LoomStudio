const failureReasons: Record<string, string> = {
  Error: 'Operation failed',
  TypeError: 'Invalid operation or value type',
  RangeError: 'Value out of range',
  SyntaxError: 'Invalid syntax',
  AbortError: 'Operation cancelled',
  TimeoutError: 'Operation timed out',
  ProviderConnectTimeoutError: 'Provider connection timed out',
  ProviderDnsError: 'Provider host could not be resolved',
  ProviderTlsError: 'Provider TLS validation failed',
  ProviderNetworkError: 'Provider network request failed',
}

// Only known classifications and numeric HTTP status cross the logging boundary.
// Error text, response bodies, headers and arbitrary error codes are not safe metadata.
export function readLogFailure(error: unknown): {
  failureType: string
  failureReason: string
  statusCode?: number
} {
  const name = error instanceof Error && Object.hasOwn(failureReasons, error.name) ? error.name : 'Error'
  let current = error
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const status = 'statusCode' in current ? current.statusCode : undefined
    if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
      const reason = status === 401 ? 'Authentication failed'
        : status === 403 ? 'Access denied'
          : status === 404 ? 'Endpoint or resource not found'
            : status === 408 || status === 504 ? 'Request timed out'
              : status === 429 ? 'Rate limit exceeded'
                : status >= 500 ? 'Upstream service failed'
                  : 'Request rejected'
      return { failureType: 'HttpError', failureReason: `${reason} (HTTP ${status})`, statusCode: status }
    }
    current = 'cause' in current ? current.cause : undefined
  }
  return { failureType: name, failureReason: failureReasons[name]! }
}
