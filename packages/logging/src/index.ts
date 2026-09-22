export { createConsoleLogSink } from './console-sink.js'
export { createRootLogger } from './logger.js'
export { readLogFailure } from './failure.js'
export { formatLogDuration, readLogPresentation } from './presentation.js'
export { createExtensionLogWriter, type ExtensionLogWriter, type ExtensionLogFields, type ExtensionLogQuery, type ExtensionLogPage, type ExtensionLogAccess, type ExtensionHostLogWriter } from './extension-logger.js'
export type { LogHistoryQuery, LogHistoryPage, LogHistoryReader } from './history-types.js'
export { readLogQuery, queryExtensionLogs } from './query.js'
export {
  createMemoryLogSink,
  matchesLogQuery,
  type LogGap,
  type LogPage,
  type LogQuery,
  type LogReader,
  type MemoryLogSink,
} from './memory-sink.js'
export type {
  CreateRootLoggerOptions,
  LogError,
  LogExtensionIdentity,
  LogFields,
  Logger,
  LogLevel,
  LogRecord,
  LogSink,
  LogSinkFailure,
  RootLogger,
} from './types.js'
