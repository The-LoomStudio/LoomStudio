import type { Diagnostic, DiagnosticInput } from '../diagnostic/types.js'
import type { PassContext } from '../pass/types.js'
import { now } from '../utils/time.js'

export function createPassContext(input: {
  readonly passName: string
  readonly passIndex: number
  readonly diagnostics: Diagnostic[]
}): PassContext {
  return {
    passName: input.passName,
    passIndex: input.passIndex,
    diagnose(diagnostic: DiagnosticInput): void {
      input.diagnostics.push({
        ...diagnostic,
        pass: input.passName,
        at: now(),
      })
    },
  }
}
