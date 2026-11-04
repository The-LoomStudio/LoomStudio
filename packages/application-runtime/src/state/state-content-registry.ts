import { installedExtensionContributionId, type ExtensionInstallationTarget, type ExtensionStateContentHandler } from '@loom-studio/extension-sdk'
import { isRecord, type JsonObject } from '@loom-studio/shared'
import type { StateMutationOperation } from '../types.js'

export type StateContentRegistry = ReturnType<typeof createStateContentRegistry>
type TimelineTarget = import('@loom-studio/extension-sdk').ExtensionTimelineTarget
type Availability = (target: TimelineTarget | undefined) => Promise<boolean>

export function createStateContentRegistry() {
  const registrations = new Map<string, {
    handler: ExtensionStateContentHandler
    contributionId: string
    target: ExtensionInstallationTarget
    controller: AbortController
    isAvailable?: Availability
  }>()
  return {
    register(handler: ExtensionStateContentHandler, owner: { packageId: string; target: ExtensionInstallationTarget; isAvailable?: Availability }) {
      if (!handler.id.startsWith(`${owner.packageId}/`) || !handler.contributionId.startsWith(`${owner.packageId}.`))
        throw new Error('State content handler must use its package namespace')
      if (!handler.path.startsWith('/') || handler.path === '/' || /~(?![01])/u.test(handler.path))
        throw new Error('State content handler requires a non-root JSON Pointer')
      const key = JSON.stringify([handler.id, owner.target])
      if (registrations.has(key)) throw new Error(`State content handler already registered: ${handler.id}`)
      const registration = {
        handler: { ...handler }, target: structuredClone(owner.target), controller: new AbortController(),
        contributionId: installedExtensionContributionId(owner.packageId, owner.target, handler.contributionId),
        isAvailable: owner.isAvailable,
      }
      registrations.set(key, registration)
      return { dispose() {
        if (registrations.get(key) !== registration) return
        registration.controller.abort()
        registrations.delete(key)
      } }
    },
    async process(input: {
      text: string; value: JsonObject; cardId?: string; contributionIds: string[]; signal: AbortSignal; target?: TimelineTarget
    }): Promise<{ operations: StateMutationOperation[]; diagnostics: string[]; contributionIds: string[] }> {
      const operations: StateMutationOperation[] = []
      const diagnostics: string[] = []
      const contributionIds = new Set<string>()
      for (const { handler, target, controller, contributionId, isAvailable } of registrations.values()) {
        if (!input.contributionIds.includes(contributionId)
          || target.kind === 'card' && target.cardId !== input.cardId) continue
        if (isAvailable && !await isAvailable(input.target)) continue
        const signal = AbortSignal.any([input.signal, controller.signal])
        signal.throwIfAborted()
        const path = handler.path
        const readPath = (pointer: string): unknown => {
          let value: unknown = input.value
          for (const part of pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
            value = isRecord(value) && Object.hasOwn(value, part) ? value[part] : undefined
          }
          return value
        }
        const value = readPath(path)
        if (!isRecord(value)) throw new Error(`Adopted State content data is missing: ${path}`)
        const result = await handler.process({
          text: input.text, value: structuredClone(value) as JsonObject, signal,
          target: input.target ? Object.freeze({ ...input.target }) : undefined,
        })
        signal.throwIfAborted()
        if (!result) continue
        if (!isRecord(result.value)) throw new Error(`State content handler must return object data: ${handler.id}`)
        if (operations.some(operation => operation.path === path
          || operation.path.startsWith(`${path}/`) || path.startsWith(`${operation.path}/`)))
          throw new Error('State content handlers cannot update overlapping paths')
        if (JSON.stringify(result.value) !== JSON.stringify(value)) {
          operations.push({ op: 'set', path, value: structuredClone(result.value) as JsonObject })
          contributionIds.add(contributionId)
        }
        diagnostics.push(...(result.diagnostics ?? []).map(item => `${handler.id}: ${item.message}`))
      }
      return { operations, diagnostics, contributionIds: [...contributionIds] }
    },
  }
}
