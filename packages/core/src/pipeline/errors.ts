import type { Fragment } from '../fragment/types.js'

export interface SerializedError {
  readonly name: string
  readonly message: string
  readonly stack?: string
}

export class LoomError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message)
    this.name = 'LoomError'
  }
}

export class PipelineError extends LoomError {
  constructor(
    message: string,
    public readonly passName: string,
    public readonly passIndex: number,
    cause?: unknown,
    public readonly fragments?: readonly Fragment[]
  ) {
    super(message, cause)
    this.name = 'PipelineError'
  }
}

export class PipelineValidationError extends LoomError {
  constructor(
    message: string,
    public readonly diagnostics: readonly { readonly code: string; readonly message: string }[]
  ) {
    super(message)
    this.name = 'PipelineValidationError'
  }
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    }
  }
  return { name: 'Error', message: String(error) }
}
