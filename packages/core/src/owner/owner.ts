import type { Diagnostic } from '../diagnostic/types.js'
import type { Fragment } from '../fragment/types.js'
import { deepEqual } from '../utils/deep-equal.js'

export type OwnerMeta = Record<string, unknown> & { __owner?: string }

function asMetaRecord(meta: unknown): OwnerMeta {
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    return meta as OwnerMeta
  }
  return {}
}

function ownerOf(fragment: Fragment<unknown>): string | undefined {
  const owner = asMetaRecord(fragment.meta).__owner
  return typeof owner === 'string' ? owner : undefined
}

function withoutOwner(meta: unknown): unknown {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return meta
  const rest = { ...meta as OwnerMeta }
  delete rest.__owner
  return rest
}

function withOwner<M>(fragment: Fragment<M>, owner: string): Fragment<M> {
  const rest = { ...asMetaRecord(fragment.meta) }
  delete rest.__owner
  return {
    ...fragment,
    meta: { ...rest, __owner: owner } as M,
  }
}

function fragmentChanged(before: Fragment<unknown>, after: Fragment<unknown>): boolean {
  return before.content !== after.content || !deepEqual(withoutOwner(before.meta), withoutOwner(after.meta))
}

export function annotateOwners<M>(
  before: readonly Fragment<M>[],
  after: readonly Fragment<M>[],
  passName: string
): Fragment<M>[] {
  const beforeById = new Map(before.map((fragment) => [fragment.id, fragment]))

  return after.map((fragment) => {
    const previous = beforeById.get(fragment.id)
    if (previous) {
      return withOwner(fragment, ownerOf(previous) ?? 'input')
    }
    return withOwner(fragment, passName)
  })
}

export function assertOwnerNotMutated<M>(
  before: readonly Fragment<M>[],
  after: readonly Fragment<M>[]
): void {
  const beforeById = new Map(before.map((fragment) => [fragment.id, fragment]))

  for (const next of after) {
    const previous = beforeById.get(next.id)
    if (!previous) continue

    const previousOwner = ownerOf(previous)
    const nextOwner = ownerOf(next)
    if (nextOwner !== undefined && previousOwner !== nextOwner) {
      throw new Error(`Fragment "${next.id}" meta.__owner cannot be modified`)
    }
  }
}

export function detectCrossOwnerWrites<M>(
  before: readonly Fragment<M>[],
  after: readonly Fragment<M>[],
  passName: string
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const beforeById = new Map(before.map((fragment) => [fragment.id, fragment]))
  const afterIds = new Set(after.map((fragment) => fragment.id))

  for (const next of after) {
    const previous = beforeById.get(next.id)
    if (!previous) continue
    const owner = ownerOf(previous)
    if (!owner || owner === passName || !fragmentChanged(previous, next)) continue

    diagnostics.push({
      severity: 'warning',
      code: 'loom/cross-owner-write',
      message: `Pass "${passName}" modified fragment "${next.id}" owned by "${owner}"`,
      pass: passName,
      fragmentId: next.id,
      meta: { owner },
    })
  }

  for (const previous of before) {
    if (afterIds.has(previous.id)) continue
    const owner = ownerOf(previous)
    if (!owner || owner === passName) continue

    diagnostics.push({
      severity: 'warning',
      code: 'loom/cross-owner-write',
      message: `Pass "${passName}" removed fragment "${previous.id}" owned by "${owner}"`,
      pass: passName,
      fragmentId: previous.id,
      meta: { owner, operation: 'remove' },
    })
  }

  return diagnostics
}
