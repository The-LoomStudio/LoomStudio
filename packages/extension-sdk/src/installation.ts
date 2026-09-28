export type ExtensionInstallationTarget = { kind: 'global' } | { kind: 'card'; cardId: string }

export function extensionInstallationId(packageId: string, target: ExtensionInstallationTarget): string {
  if (target.kind === 'global') return `extension-installation:${JSON.stringify(['global', packageId])}`
  if (target.kind !== 'card') throw new Error('Extension installation target must be global or card')
  if (typeof target.cardId !== 'string' || target.cardId.trim().length === 0) throw new Error('cardId cannot be empty')
  return `extension-installation:${JSON.stringify(['card', target.cardId, packageId])}`
}

export function installedExtensionContributionId(packageId: string, target: ExtensionInstallationTarget, authoredId: string): string {
  return target.kind === 'global' ? authoredId : `${extensionInstallationId(packageId, target)}:${authoredId}`
}
