import type { Diagnostic } from '../diagnostic/types.js'
import type { Fragment } from './types.js'

export function validateFragments(
  fragments: readonly Fragment[],
  pass: string = 'core'
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const seen = new Set<string>()

  for (const fragment of fragments) {
    if (!fragment || typeof fragment !== 'object') {
      diagnostics.push({
        severity: 'error',
        code: 'loom/invalid-fragment',
        message: 'Fragment must be an object',
        pass,
      })
      continue
    }

    if (typeof fragment.id !== 'string' || fragment.id.length === 0) {
      diagnostics.push({
        severity: 'error',
        code: 'loom/empty-id',
        message: 'Fragment id must be a non-empty string',
        pass,
      })
    } else if (seen.has(fragment.id)) {
      diagnostics.push({
        severity: 'error',
        code: 'loom/duplicate-id',
        message: `Duplicate fragment id "${fragment.id}"`,
        pass,
        fragmentId: fragment.id,
      })
    } else {
      seen.add(fragment.id)
    }

    if (typeof fragment.content !== 'string') {
      const diagnostic: Diagnostic = {
        severity: 'error',
        code: 'loom/invalid-content',
        message: `Fragment "${fragment.id}" content must be a string`,
        pass,
      }
      if (typeof fragment.id === 'string') {
        diagnostics.push({ ...diagnostic, fragmentId: fragment.id })
      } else {
        diagnostics.push(diagnostic)
      }
    }
  }

  return diagnostics
}
