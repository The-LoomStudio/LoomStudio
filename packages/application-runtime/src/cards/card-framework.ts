import { satisfies, valid, validRange } from 'semver'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import type { DocumentTransaction } from '@loom-studio/document-store'
import type { PromptResourceStore } from '@loom-studio/application-data'
import type { CardFrameworkFields, ExtensionInstallationContent } from '../types.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { readDocument } from '../foundation/document-store.js'
import { isObject } from '../foundation/json.js'

/** Card dependencies refer to global installations, not archives embedded in the Card. */
export function parseCardFrameworkFields(value: Record<string, unknown>): CardFrameworkFields {
  const result: CardFrameworkFields = {}
  const token = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  if (value.extensionDependencies !== undefined) {
    if (!Array.isArray(value.extensionDependencies) || value.extensionDependencies.length > 100) throw new Error('Card extension dependencies must be a bounded array')
    const ids = new Set<string>()
    result.extensionDependencies = value.extensionDependencies.map(item => {
      if (!isObject(item) || !token(item.id) || ids.has(item.id) || item.target !== 'global' || typeof item.version !== 'string' || !validRange(item.version)) throw new Error('Invalid Card global extension dependency')
      ids.add(item.id)
      return { id: item.id, version: item.version, target: 'global' }
    })
  }
  if (value.defaultPreset !== undefined) {
    const reference = value.defaultPreset
    if (!isObject(reference) || !token(reference.packageId) || !token(reference.contributionId) || reference.target !== 'global') throw new Error('Invalid Card default Preset reference')
    if (!result.extensionDependencies?.some(item => item.id === reference.packageId)) throw new Error('Card default Preset requires a declared global extension dependency')
    result.defaultPreset = { packageId: reference.packageId, contributionId: reference.contributionId, target: 'global' }
  }
  if (value.catalogSource !== undefined) {
    const source = value.catalogSource
    if (!isObject(source) || !token(source.packageId) || !token(source.characterId) || typeof source.version !== 'string' || !valid(source.version) || typeof source.digest !== 'string' || !/^[a-f0-9]{64}$/.test(source.digest)) throw new Error('Invalid Card catalog source')
    result.catalogSource = { packageId: source.packageId, characterId: source.characterId, version: source.version, digest: source.digest }
  }
  return result
}

export async function validateCardFramework(
  documents: DocumentTransaction,
  promptResources: Pick<PromptResourceStore, 'listResources'>,
  input: CardFrameworkFields,
): Promise<{ presetId?: string }> {
  const card = parseCardFrameworkFields(input as Record<string, unknown>)
  for (const dependency of card.extensionDependencies ?? []) {
    const installation = await readDocument<ExtensionInstallationContent>(documents,
      extensionInstallationId(dependency.id, { kind: 'global' }), applicationDocumentTypes.extensionInstallation)
    if (installation.content.packageId !== dependency.id || installation.content.target.kind !== 'global'
      || !valid(installation.content.packageVersion) || !satisfies(installation.content.packageVersion, dependency.version)) {
      throw new Error(`Card requires global extension ${dependency.id}@${dependency.version}`)
    }
  }
  if (!card.defaultPreset) return {}
  const reference = card.defaultPreset
  let cursor: string | undefined
  do {
    const page = await promptResources.listResources({ resourceKind: 'preset', limit: 500, cursor, order: 'id' })
    for (const preset of page.resources) {
      const origin = preset.metadata.origin as { packageId?: string; contributionId?: string; installationId?: string } | undefined
      if (origin?.packageId === reference.packageId && origin.contributionId === reference.contributionId
        && (origin.installationId === undefined || origin.installationId === extensionInstallationId(reference.packageId, { kind: 'global' }))) return { presetId: preset.id }
    }
    cursor = page.nextCursor
  } while (cursor)
  throw new Error(`Card default Preset is unavailable: ${reference.packageId}/${reference.contributionId}`)
}

/** Protect the lookup-to-write interval without reentering the SQLite reader inside a transaction. */
export async function withCardFramework<T>(ctx: {
  documents: DocumentTransaction
  promptResources: Pick<PromptResourceStore, 'listResources'>
  dataEngine: import('@loom-studio/data-engine').SqliteDataEngine
}, card: CardFrameworkFields, operation: (resolved: { presetId?: string }) => Promise<T>): Promise<T> {
  if (!card.extensionDependencies?.length && !card.defaultPreset) return operation({})
  let stale = false
  const subscription = ctx.dataEngine.subscribeCommits(() => { stale = true })
  try {
    const resolved = await validateCardFramework(ctx.documents, ctx.promptResources, card)
    return await ctx.dataEngine.withTransactionGuard(async () => {
      if (stale) throw new Error('Card Framework changed during preparation; retry')
    }, () => operation(resolved))
  } finally { subscription.dispose() }
}
