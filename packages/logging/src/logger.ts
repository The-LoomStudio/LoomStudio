import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type {
  CreateRootLoggerOptions,
  LogError,
  LogFields,
  Logger,
  LogLevel,
  LogRecord,
  LogSinkFailure,
  RootLogger,
} from './types.js'

const sensitiveKeys = new Set([
  'authorization',
  'cookie',
  'password',
  'secret',
  'accesstoken',
  'refreshtoken',
  'apikey',
])

export function createRootLogger(options: CreateRootLoggerOptions): RootLogger {
  assertNamespace(options.service, 'service')
  assertName(options.instanceId, 'instanceId')

  const sinks = [...options.sinks]
  let closed = false
  const reportSinkFailure = (failure: LogSinkFailure): void => {
    try {
      if (options.onSinkError) options.onSinkError(failure)
      else console.error(`[logging] ${failure.sink}.${failure.operation} failed`, failure.error)
    } catch (error) {
      console.error('[logging] sink error handler failed', error)
    }
  }

  const emit = (namespace: string, level: LogLevel, message: string, fields: LogFields = {}): void => {
    if (closed) return
    if (typeof message !== 'string' || message.length === 0) {
      throw new Error('Log message must be a non-empty string')
    }
    if (fields.event !== undefined) assertNamespace(fields.event, 'event')

    const record: LogRecord = {
      timestamp: (options.clock?.now() ?? new Date()).toISOString(),
      level,
      service: options.service,
      instanceId: options.instanceId,
      namespace,
      message,
      ...(fields.event ? { event: fields.event } : {}),
      ...(fields.data ? { data: normalizeData(fields.data) } : {}),
      ...(fields.error !== undefined ? { error: normalizeError(fields.error) } : {}),
      ...(fields.correlationId ? { correlationId: fields.correlationId } : {}),
      ...(fields.callId ? { callId: fields.callId } : {}),
      ...(fields.parentCallId ? { parentCallId: fields.parentCallId } : {}),
    }

    Object.freeze(record)

    for (const sink of sinks) {
      try {
        sink.write(record)
      } catch (error) {
        reportSinkFailure({ sink: sink.name, operation: 'write', error })
      }
    }
  }

  const createLogger = (namespace: string): Logger => ({
    child: childNamespace => createLogger(joinNamespace(namespace, childNamespace)),
    debug: (message, fields) => emit(namespace, 'debug', message, fields),
    info: (message, fields) => emit(namespace, 'info', message, fields),
    warn: (message, fields) => emit(namespace, 'warn', message, fields),
    error: (message, fields) => emit(namespace, 'error', message, fields),
  })

  const runSinkLifecycle = async (operation: 'flush' | 'close'): Promise<void> => {
    for (const sink of sinks) {
      const method = sink[operation]
      if (!method) continue
      try {
        await method.call(sink)
      } catch (error) {
        reportSinkFailure({ sink: sink.name, operation, error })
      }
    }
  }

  return {
    child: namespace => {
      assertNamespace(namespace, 'namespace')
      return createLogger(namespace)
    },
    flush: () => runSinkLifecycle('flush'),
    close: async () => {
      if (closed) return
      await runSinkLifecycle('flush')
      closed = true
      await runSinkLifecycle('close')
    },
  }
}

function joinNamespace(parent: string, child: string): string {
  assertNamespace(child, 'namespace')
  return `${parent}.${child}`
}

function assertNamespace(value: string, label: string): void {
  const valid = typeof value === 'string'
    && value.split('.').every(segment => /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/.test(segment))
  if (!valid) {
    throw new Error(`Log ${label} must be a lowercase dot-separated name: ${value}`)
  }
}

function assertName(value: string, label: string): void {
  if (typeof value !== 'string' || value.length === 0 || /\s/.test(value)) {
    throw new Error(`Log ${label} must be a non-empty string without whitespace`)
  }
}

function normalizeData(data: JsonObject): JsonObject {
  return normalizeObject(data, new WeakSet())
}

function normalizeObject(value: object, ancestors: WeakSet<object>): JsonObject {
  if (ancestors.has(value)) return { value: '[Circular]' }
  ancestors.add(value)
  const result: JsonObject = {}

  try {
    for (const key of Object.keys(value)) {
      if (isSensitiveKey(key)) {
        result[key] = '[REDACTED]'
        continue
      }

      let item: unknown
      try {
        item = (value as Record<string, unknown>)[key]
      } catch {
        result[key] = '[Unserializable]'
        continue
      }

      const normalized = normalizeValue(item, ancestors)
      if (normalized !== undefined) result[key] = normalized
    }
  } finally {
    ancestors.delete(value)
  }

  return result
}

function normalizeValue(value: unknown, ancestors: WeakSet<object>): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return value.toString()
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) return normalizeError(value) as unknown as JsonObject
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return '[Circular]'
    ancestors.add(value)
    try {
      return value.map(item => normalizeValue(item, ancestors) ?? null)
    } finally {
      ancestors.delete(value)
    }
  }
  if (typeof value === 'object') return ancestors.has(value) ? '[Circular]' : normalizeObject(value, ancestors)
  return String(value)
}

function normalizeError(error: unknown): LogError {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
    return {
      name: error.name,
      ...(code ? { code } : {}),
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    }
  }

  return { message: String(error) }
}

function isSensitiveKey(key: string): boolean {
  return sensitiveKeys.has(key.toLowerCase().replaceAll(/[-_]/g, ''))
}
