import type { JsonObject } from '@loom-studio/shared'

/** Processes a complete accepted assistant response, never reasoning, tool input or stream chunks. */
export type ExtensionStateContentHandler = {
  id: string
  contributionId: string
  /** JSON Pointer to the adopted contribution's data. The handler cannot replace the State root. */
  path: string
  process(input: {
    text: string
    value: JsonObject
    signal: AbortSignal
    target?: Readonly<import('./timeline.js').ExtensionTimelineTarget>
  }): Promise<{ value: JsonObject; diagnostics?: Array<{ message: string }> } | undefined>
}
