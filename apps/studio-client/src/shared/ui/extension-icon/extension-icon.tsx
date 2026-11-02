import { extensionInstallationId } from '@loom-studio/extension-sdk'
import type { PromptResourceDisplayMetadata } from '@loom-studio/shared'
import { createContext, useContext, useState } from 'react'
import { Package } from 'lucide-react'

type ExtensionIdentity = {
  packageId: string; displayName: string; iconUrl?: string; version?: string; fileRevision?: string
  target?: { kind: 'global' } | { kind: 'card'; cardId: string }; archiveDigest?: string
}

export function presetIconUrl(preset: { metadata?: PromptResourceDisplayMetadata; origin?: { kind: string; packageId?: string; installationId?: string } }, packages: readonly ExtensionIdentity[]): string | undefined {
  const icon = preset.metadata?.icon
  if (icon) {
    // Legacy global icons predate target binding. Card references always require an exact Card target.
    const target = icon.target ?? (icon.scope === 'card' ? undefined : { kind: 'global' as const })
    if (!target) return undefined
    const pkg = packages.find(item => item.packageId === icon.packageId && (target?.kind === 'card'
      ? item.target?.kind === 'card' && item.target.cardId === target.cardId
      : item.target?.kind !== 'card'))
    if (pkg?.version) {
      const path = icon.path.split('/').map(encodeURIComponent).join('/')
      if (target?.kind === 'card') {
        if (pkg.archiveDigest) return `/card-extensions/${encodeURIComponent(target.cardId)}/${encodeURIComponent(pkg.packageId)}/${encodeURIComponent(pkg.version)}/${pkg.archiveDigest}/files/${path}`
      } else return `/extensions/${encodeURIComponent(pkg.packageId)}/${encodeURIComponent(pkg.fileRevision ?? pkg.version)}/files/${path}`
    }
    return undefined
  }
  const origin = preset.origin
  if (!origin?.packageId) return undefined
  const installationId = origin.installationId ?? extensionInstallationId(origin.packageId, { kind: 'global' })
  return packages.find(item => item.packageId === origin.packageId
    && extensionInstallationId(item.packageId, item.target ?? { kind: 'global' }) === installationId)?.iconUrl
}

// Reuse the runtime's discovered package metadata without issuing per-view requests.
export const ExtensionIdentityContext = createContext<readonly ExtensionIdentity[]>([])

export function useExtensionIdentities() {
  return useContext(ExtensionIdentityContext)
}

export function ExtensionIcon(props: { packageId?: string; iconUrl?: string; size?: number; className?: string }) {
  const packages = useExtensionIdentities()
  const url = props.iconUrl ?? packages.find(item => item.packageId === props.packageId)?.iconUrl
  const [failedUrl, setFailedUrl] = useState<string>()
  const size = props.size ?? 20
  const style = { width: size, height: size, flex: `0 0 ${size}px`, objectFit: 'contain' as const }
  return url && url !== failedUrl
    ? <img src={url} alt="" aria-hidden="true" className={props.className} style={style} onError={() => setFailedUrl(url)} />
    : <Package aria-hidden="true" className={props.className} style={style} />
}
