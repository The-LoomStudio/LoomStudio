import type { Clock, JsonObject } from '@loom-studio/shared'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogError = {
  name?: string
  code?: string
  message: string
  stack?: string
}

export type LogRecord = {
  timestamp: string
  level: LogLevel
  service: string
  instanceId: string
  namespace: string
  message: string
  event?: string
  data?: JsonObject
  error?: LogError
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type LogFields = {
  event?: string
  data?: JsonObject
  error?: unknown
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type LogSink = {
  name: string
  write(record: LogRecord): void
  flush?(): Promise<void>
  close?(): Promise<void>
}

export type LogSinkFailure = {
  sink: string
  operation: 'write' | 'flush' | 'close'
  error: unknown
}

export type Logger = {
  child(namespace: string): Logger
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
}

export type RootLogger = {
  child(namespace: string): Logger
  flush(): Promise<void>
  close(): Promise<void>
}

export type CreateRootLoggerOptions = {
  service: string
  instanceId: string
  sinks: readonly LogSink[]
  clock?: Clock
  onSinkError?: (failure: LogSinkFailure) => void
}
