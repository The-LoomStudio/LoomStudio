export { createConsoleLogSink } from './console-sink.js'
export { createRootLogger } from './logger.js'
export {
  createMemoryLogSink,
  type LogGap,
  type LogPage,
  type LogQuery,
  type LogReader,
  type MemoryLogSink,
} from './memory-sink.js'
export type {
  CreateRootLoggerOptions,
  LogError,
  LogFields,
  Logger,
  LogLevel,
  LogRecord,
  LogSink,
  LogSinkFailure,
  RootLogger,
} from './types.js'
