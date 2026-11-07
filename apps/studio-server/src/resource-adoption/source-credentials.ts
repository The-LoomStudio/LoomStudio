import { readFile } from 'node:fs/promises'
import type { SecretRef, SecretStore } from '@loom-studio/secret-store'
import { writeJsonAtomically } from '../platform/atomic-json.js'

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
      if (refs[id]) await store().replace({ ...context, ref: refs[id] })
      else {
        const { metadata } = await store().create({ ...context, purpose: 'platform-authentication', label: name })
        refs[id] = metadata.ref
        await writeJsonAtomically(filename, refs)
      }
    }),
    remove: (packageId: string, name: string) => serial(async () => {
      const refs = await load(); const id = key(packageId, name); const ref = refs[id]
      if (!ref) return
      await store().delete({ ref, owner: { type: 'resource-source', id: packageId }, actor: { kind: 'extension', id: packageId }, reason: 'resource-source.disconnect' })
      delete refs[id]; await writeJsonAtomically(filename, refs)
    }),
  }
}
