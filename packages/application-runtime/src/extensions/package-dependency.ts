import { satisfies, valid, validRange } from 'semver'
import { extensionInstallationId, type ExtensionDependency, type ExtensionInstallationTarget } from '@loom-studio/extension-sdk'
import type { DocumentTransaction } from '@loom-studio/document-store'
import { readDocument } from '../foundation/document-store.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import type { ExtensionInstallationContent } from '../types.js'

/** Exact installation resolution shared by tools and package-owned assets; never falls back between scopes. */
export type ResolvePackageDependencyInput = {
  packageId: string
  target: ExtensionInstallationTarget
  consumerPackageId: string
  consumerTarget: ExtensionInstallationTarget
  dependencies?: readonly ExtensionDependency[]
  documents: DocumentTransaction
}

export async function resolvePackageDependency(input: ResolvePackageDependencyInput) {
  if (input.target.kind === 'card' && (input.consumerTarget.kind !== 'card' || input.target.cardId !== input.consumerTarget.cardId)) {
    throw new Error('Package dependency cannot access another Card installation')
  }
  const samePackage = input.packageId === input.consumerPackageId
  const dependency = samePackage ? undefined : input.dependencies?.find(item => item.id === input.packageId)
  if (!samePackage && !dependency) throw new Error(`Package dependency is not declared: ${input.packageId}`)
  if (dependency?.target && dependency.target !== input.target.kind) throw new Error(`Package dependency target mismatch: ${input.packageId} requires ${dependency.target}`)
  const id = extensionInstallationId(input.packageId, input.target)
  const installation = await readDocument<ExtensionInstallationContent>(input.documents, id, applicationDocumentTypes.extensionInstallation)
  if (installation.content.packageId !== input.packageId || extensionInstallationId(input.packageId, installation.content.target) !== id) {
    throw new Error(`Package installation identity mismatch: ${id}`)
  }
  if (dependency && (!validRange(dependency.version) || !valid(installation.content.packageVersion)
    || !satisfies(installation.content.packageVersion, dependency.version))) {
    throw new Error(`Package dependency version mismatch: ${input.packageId} requires ${dependency.version}, installed ${installation.content.packageVersion}`)
  }
  return { installation, checks: [{ id: installation.id, version: installation.version }] }
}

export type PackageIconReference = NonNullable<import('@loom-studio/shared').PromptResourceDisplayMetadata['icon']>

export async function resolvePackageIcon(input: {
  icon: PackageIconReference
  consumerPackageId: string
  consumerTarget: ExtensionInstallationTarget
  dependencies?: readonly ExtensionDependency[]
  documents: DocumentTransaction
  /** Only the current installation import may resolve its not-yet-written installation. */
  importingVersion?: string
}) {
  const { icon, consumerTarget } = input
  if (icon.packageId !== input.consumerPackageId && !icon.scope) throw new Error('Cross-package icon requires an explicit scope')
  const target: ExtensionInstallationTarget = icon.scope === 'global' ? { kind: 'global' }
    : icon.scope === 'card' ? consumerTarget.kind === 'card' ? consumerTarget : (() => { throw new Error('Global extension cannot reference a Card icon') })()
      : consumerTarget
  if (icon.target && extensionInstallationId(icon.packageId, icon.target) !== extensionInstallationId(icon.packageId, target)) {
    throw new Error('Icon installation target cannot override its declared scope')
  }
  const sameInstallation = icon.packageId === input.consumerPackageId
    && extensionInstallationId(icon.packageId, target) === extensionInstallationId(input.consumerPackageId, consumerTarget)
  if (sameInstallation && input.importingVersion) return { icon: { ...icon, target }, packageVersion: input.importingVersion, checks: [] as Array<{ id: string; version: number }>, sameInstallation }
  const resolved = await resolvePackageDependency({ packageId: icon.packageId, target, consumerPackageId: input.consumerPackageId,
    consumerTarget, dependencies: input.dependencies, documents: input.documents })
  return { icon: { ...icon, target }, packageVersion: resolved.installation.content.packageVersion, checks: resolved.checks, sameInstallation }
}

export async function assertPackageDependencyRevisions(documents: DocumentTransaction, checks: readonly { id: string; version: number }[]): Promise<void> {
  for (const [id, version] of new Map(checks.map(check => [check.id, check.version] as const))) {
    const current = await documents.get(id)
    if (!current || current.version !== version) throw new Error(`Package dependency changed during preparation: ${id}`)
  }
}

export type ResolvedPackageDependency = Awaited<ReturnType<typeof resolvePackageDependency>>

/** Explicit targets are checked even when no individual resource is mounted. Legacy references keep their authored scopes. */
export async function resolveDeclaredPackageDependencies(input: {
  packageId: string
  target: ExtensionInstallationTarget
  dependencies?: readonly ExtensionDependency[]
  documents: DocumentTransaction
}) {
  const checks: Array<{ id: string; version: number }> = []
  for (const dependency of input.dependencies ?? []) {
    if (!dependency.target) continue
    if (dependency.target === 'card' && input.target.kind !== 'card') throw new Error('Global extension cannot depend on a Card installation')
    const resolved = await resolvePackageDependency({ packageId: dependency.id,
      target: dependency.target === 'global' ? { kind: 'global' } : input.target,
      consumerPackageId: input.packageId, consumerTarget: input.target,
      dependencies: input.dependencies, documents: input.documents })
    checks.push(...resolved.checks)
  }
  return checks
}
