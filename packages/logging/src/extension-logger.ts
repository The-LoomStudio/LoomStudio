import type { JsonObject } from '@loom-studio/shared'
import type { LogFields, LogLevel, Logger, LogExtensionIdentity } from './types.js'
import type { LogQuery, LogPage } from './memory-sink.js'
import type { LogHistoryPage } from './history-types.js'
import { normalizeLogData } from './logger.js'

export type ExtensionLogFields = Pick<LogFields, 'event' | 'data' | 'correlationId' | 'callId' | 'parentCallId'>
export type ExtensionLogWriter = {
  child(namespace: string): ExtensionLogWriter
  log(level: LogLevel, message: string, fields?: ExtensionLogFields): void
  debug(message: string, data?: JsonObject): void
  info(message: string, data?: JsonObject): void
  warn(message: string, data?: JsonObject): void
  error(message: string, data?: JsonObject): void
}
export type ExtensionLogQuery = Omit<LogQuery, 'packageId' | 'service' | 'instanceId' | 'installationId'> & { source?: 'current' | 'history' }
export type ExtensionLogPage = (LogPage | LogHistoryPage) & { sources: string[] }
export type ExtensionLogAccess = { query(input: ExtensionLogQuery): Promise<ExtensionLogPage> }
export type ExtensionHostLogWriter = Pick<Logger, 'info' | 'error'> & Partial<Pick<Logger, 'debug' | 'warn' | 'child'>>

type WriteBudget = { windowStart: number; count: number; dropped: number }
const hostBudgets = new WeakMap<object, Map<string, WriteBudget>>()

export function createExtensionLogWriter(logger: ExtensionHostLogWriter | undefined, identity: LogExtensionIdentity): ExtensionLogWriter {
  let budgets = logger ? hostBudgets.get(logger) : undefined
  if (logger && !budgets) { budgets = new Map(); hostBudgets.set(logger, budgets) }
  const ownerKey = identity.installationId ?? identity.packageId
  const budget = budgets?.get(ownerKey) ?? { windowStart: Date.now(), count: 0, dropped: 0 }
  budgets?.set(ownerKey, budget)
  const extension = Object.freeze({ ...identity })
  const packageIdentity = { packageId: identity.packageId, runtime: identity.runtime, ...(identity.installationId ? { installationId: identity.installationId } : {}) }
  const create = (namespace: string, target: ExtensionHostLogWriter | undefined): ExtensionLogWriter => {
    const log = (level: LogLevel, message: string, fields: ExtensionLogFields = {}) => {
      if (!['debug', 'info', 'warn', 'error'].includes(level)) throw new Error('Invalid extension log level')
      if (typeof message !== 'string' || !message) throw new Error('Log message must be non-empty')
      if (fields.event !== undefined && (typeof fields.event !== 'string' || fields.event.length > 128 || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(fields.event))) throw new Error('Invalid extension log event')
      if (Date.now() - budget.windowStart >= 60_000) {
        if (budget.dropped) logger?.warn?.('Extension logs rate limited', { extension: packageIdentity, event: 'extension.logs.dropped', data: { dropped: budget.dropped } })
        budget.windowStart = Date.now()
        budget.count = 0
        budget.dropped = 0
      }
      // ponytail: 200 records/minute per installation and host, shared across modules/reloads; raise with measured demand.
      if (++budget.count > 200) {
        budget.dropped++
        if (budget.dropped === 1) logger?.warn?.('Extension log rate limit reached', { extension: packageIdentity, event: 'extension.logs.limited', data: { limit: 200, windowMs: 60_000 } })
        return
      }
      const data = fields.data ? normalizeLogData(fields.data) : undefined
      const bytes = new TextEncoder().encode(JSON.stringify(data ?? {})).byteLength
      const output: LogFields = {
        extension,
        event: fields.event ? `extension.${fields.event}` : 'extension.runtime.log',
        data: {
          ...(bytes <= 16_384 ? data : { logDataOmitted: true, originalBytes: bytes }),
          component: namespace,
          ...(message.length > 2_000 ? { messageTruncated: true } : {}),
        },
        correlationId: fields.correlationId?.slice(0, 256),
        callId: fields.callId?.slice(0, 256),
        parentCallId: fields.parentCallId?.slice(0, 256),
      }
      const write = target?.[level] ?? target?.info
      write?.(message.slice(0, 2_000), output)
    }
    return {
      child: child => {
        if (typeof child !== 'string' || namespace.length + child.length > 256 || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(child)) throw new Error('Invalid extension log namespace')
        return create(namespace ? `${namespace}.${child}` : child, target?.child?.(child) ?? target)
      },
      log,
      debug: (message, data) => log('debug', message, { data }),
      info: (message, data) => log('info', message, { data }),
      warn: (message, data) => log('warn', message, { data }),
      error: (message, data) => log('error', message, { data }),
    }
  }
  return create('', logger)
}
