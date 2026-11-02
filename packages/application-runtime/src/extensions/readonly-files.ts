import type { ExtensionInstallationTarget, ExtensionReadonlyFiles } from '@loom-studio/extension-sdk'
import type { VfsEntry } from '../vfs/types.js'

type Target = { timelineId: string; branchId: string }
export type ExtensionReadonlyFilesOwner = {
  target: ExtensionInstallationTarget
  isAvailable(target: Target): boolean | Promise<boolean>
}
export type ExtensionReadonlyFilesRegistry = ReturnType<typeof createExtensionReadonlyFilesRegistry>

// Built-ins are emitted by vfs-gateway, resource-filesystem, agent-tool-scope and CodeAct context.
const reservedRoots = new Set(['/context', '/resources', '/state', '/workspace', '/narrative', '/attachments'])

/** Providers supply projections only: no mutation binding can enter the Agent filesystem. */
export function createExtensionReadonlyFilesRegistry() {
  const registrations = new Set<{ provider: ExtensionReadonlyFiles; owner: ExtensionReadonlyFilesOwner }>()
  return {
    register(provider: ExtensionReadonlyFiles, owner: ExtensionReadonlyFilesOwner) {
      if (!provider.id.trim()) throw new Error('Readonly file provider id is required')
      if (!/^\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(provider.root) || reservedRoots.has(provider.root))
        throw new Error(`Readonly file provider requires a non-reserved single root: ${provider.root}`)
      const registration = { provider: { ...provider }, owner: { ...owner, target: { ...owner.target } } }
      registrations.add(registration)
      return { dispose() { registrations.delete(registration) } }
    },
    async resolve(target: Target, cardId?: string): Promise<VfsEntry[]> {
      const roots = new Set<string>()
      const entries: VfsEntry[] = []
      for (const registration of registrations) {
        const { provider, owner } = registration
        if (owner.target.kind === 'card' && owner.target.cardId !== cardId) continue
        if (!await owner.isAvailable({ ...target }) || !registrations.has(registration)) continue
        const resolved = await provider.resolve({ ...target })
        if (!await owner.isAvailable({ ...target }) || !registrations.has(registration)) continue
        if (roots.has(provider.root)) throw new Error(`Readonly file provider root conflict: ${provider.root}`)
        roots.add(provider.root)
        const files = new Map<string, VfsEntry>([[provider.root, { path: provider.root, kind: 'directory' }]])
        const supplied = new Set<string>()
        for (const entry of resolved) {
          if (typeof entry.path !== 'string' || entry.path !== provider.root && !entry.path.startsWith(`${provider.root}/`)
            // eslint-disable-next-line no-control-regex -- Control characters are intentionally rejected or encoded in paths and CSS values.
            || entry.path.includes('\\') || /[\x00-\x1f\x7f]/.test(entry.path)
            || entry.path.slice(1).split('/').some(part => !part || part === '.' || part === '..'))
            throw new Error(`Readonly file path escapes or is invalid for ${provider.root}: ${entry.path}`)
          if (entry.kind !== 'directory' && entry.kind !== 'file'
            || entry.kind === 'file' && typeof entry.content !== 'string'
            || entry.path === provider.root && entry.kind !== 'directory')
            throw new Error(`Invalid readonly file entry: ${entry.path}`)
          if (supplied.has(entry.path)) throw new Error(`Duplicate readonly file path: ${entry.path}`)
          supplied.add(entry.path)
          files.set(entry.path, { path: entry.path, kind: entry.kind,
            ...(entry.kind === 'file' ? { content: entry.content } : {}) })
        }
        for (const entry of [...files.values()]) {
          let parent = entry.path.slice(0, entry.path.lastIndexOf('/'))
          while (parent.length >= provider.root.length) {
            const existing = files.get(parent)
            if (existing?.kind === 'file') throw new Error(`Readonly file cannot contain children: ${parent}`)
            if (!existing) files.set(parent, { path: parent, kind: 'directory' })
            parent = parent.slice(0, parent.lastIndexOf('/'))
          }
        }
        entries.push(...files.values())
      }
      return entries
    },
  }
}
