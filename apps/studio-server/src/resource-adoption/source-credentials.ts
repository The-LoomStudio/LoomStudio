import { readFile } from 'node:fs/promises'
import type { SecretRef, SecretStore } from '@loom-studio/kernel/secret-store'
import { writeJsonAtomically } from '@loom-studio/kernel/platform'

/** Only secret references are stored here; credentials remain in SecretStore. */
export function createSourceCredentialStore(filename: string, secrets?: SecretStore) {
  let pending = Promise.resolve()
  async function load(): Promise<Record<string, SecretRef>> {
    try { return JSON.parse(await readFile(filename, 'utf8')) as Record<string, SecretRef> }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error }
  }
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation)
    pending = result.then(() => undefined, () => undefined)
    return result
  }
  function key(packageId: string, name: string) {
    if (!name || name.length > 200) throw new Error('Credential name must contain 1–200 characters')
    return JSON.stringify([packageId, name])
  }
  function store() { if (!secrets) throw new Error('Secure credential storage is unavailable'); return secrets }
  return {
    get: (packageId: string, name: string) => serial(async () => {
      const ref = (await load())[key(packageId, name)]
      if (!ref) return undefined
      return store().withSecret(ref, { caller: packageId, owner: { type: 'resource-source', id: packageId }, purpose: 'platform-authentication' }, async plaintext => ({ ...plaintext.values }))
    }),
    set: (packageId: string, name: string, values: Record<string, string>) => serial(async () => {
      const refs = await load(); const id = key(packageId, name)
      const context = { actor: { kind: 'extension' as const, id: packageId }, reason: 'resource-source.credentials', owner: { type: 'resource-source', id: packageId }, plaintext: { values } }
      if (refs[id]) {
        try {
          await store().replace({ ...context, ref: refs[id] })
          return
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'secret.not_found')) throw error
        }
      }
      const { metadata } = await store().create({ ...context, purpose: 'platform-authentication', label: name })
      refs[id] = metadata.ref
      try {
        await writeJsonAtomically(filename, refs)
      } catch (error) {
        await store().delete({ ref: metadata.ref, owner: context.owner, actor: context.actor, reason: 'resource-source.credentials.rollback' }).catch(() => undefined)
        throw error
      }
    }),
    remove: (packageId: string, name: string) => serial(async () => {
      const refs = await load(); const id = key(packageId, name); const ref = refs[id]
      if (!ref) return
      delete refs[id]
      await writeJsonAtomically(filename, refs)
      try {
        await store().delete({ ref, owner: { type: 'resource-source', id: packageId }, actor: { kind: 'extension', id: packageId }, reason: 'resource-source.disconnect' })
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'secret.not_found')) throw error
      }
    }),
  }
}
