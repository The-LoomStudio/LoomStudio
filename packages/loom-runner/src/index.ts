import type { Diagnostic } from '@loom-studio/diagnostics'
import type { JsonValue } from '@loom-studio/shared'

export type LoomRunInput = {
  fragments: JsonValue[]
  passes: JsonValue[]
}

export type LoomRunResult = {
  fragments: JsonValue[]
  traceId?: string
  diagnostics?: Diagnostic[]
}

export type LoomRunner = {
  run(input: LoomRunInput): Promise<LoomRunResult>
}
