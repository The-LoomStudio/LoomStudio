import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { CardDirectoryPreview, CardDirectorySaveResult, JsonObject, JsonValue } from '@loom-studio/shared'
import { encodeCardBundleFiles, loadCardBundleFiles, maxBundleBytes, type CardBundleFilesInput } from '../codecs/card-bundle-zip.js'
import type { RuntimeRequestContext } from '@loom-studio/application-runtime'
import { validateBundlePath } from '../codecs/card-bundle-files.js'
import { isPng, stripPngTextMetadata } from '../codecs/card-png.js'
import { readString } from '../rpc/rpc-params.js'

type Baseline = { version: 1; cardId: string; files: Record<string, string>; snapshot?: JsonObject; mediaRefs?: { avatarAssetId?: string; coverAssetId?: string } }
type Journal = { before: Baseline | null; after: Baseline }
type Operation = { path: string; before: string | null; after: string | null }

export function createCardDirectoryService(options: {
  dataRoot: string
  readCard(cardId: string): Promise<CardBundleFilesInput & { snapshot?: JsonObject }>
  applyCard?(cardId: string, artifact: CardBundleFilesInput['artifact'], snapshot: JsonObject, context?: RuntimeRequestContext): Promise<void>
}) {
  const root = resolve(options.dataRoot)
  const busy = new Set<string>()
  const names = new Map<string, string>()
  const directory = (id: string) => `characters/${names.get(id) ?? id}`
  const metadata = (id: string) => `.loom/card-directories/${id}`

  async function exclusive<T>(id: string, action: () => Promise<T>): Promise<T> {
    assertCardId(id)
    if (busy.has(id)) throw new Error('Card directory operation is already running')
    busy.add(id)
    try {
      const binding = await readCardDirectoryBinding(root, id)
      if (binding) names.set(id, binding.directoryName)
      return await action()
    } finally {
      names.delete(id)
      busy.delete(id)
    }
  }

  async function loadBaseline(id: string): Promise<Baseline | null> {
    const bytes = await readOptional(root, `${metadata(id)}/baseline.json`)
    return bytes ? parseBaseline(JSON.parse(bytes.toString('utf8')), id) : null
  }

  async function prepare(id: string, applying = false) {
    if (!applying && await readOptional(root, `${metadata(id)}/apply.json`)) throw new Error('Card directory has an unfinished apply; recover it first')
    if (await readOptional(root, `${metadata(id)}/delete.json`)) throw new Error('Card directory has an unfinished deletion')
    if (await readOptional(root, `${metadata(id)}/pending/journal.json`)) {
      throw new Error('Card directory has an unfinished save; recover it before saving again')
    }
    const bundle = structuredClone(await options.readCard(id))
    if (bundle.artifact.metadata) delete bundle.artifact.metadata.exportedAt
    const files = encodeCardBundleFiles(bundle)
    const baseline = await loadBaseline(id)
    const next: Baseline = { version: 1, cardId: id, files: hashes(files), mediaRefs: bundle.artifact.card.media ?? {}, ...(bundle.snapshot ? { snapshot: bundle.snapshot } : {}) }
    const operations = changes(baseline, next)
    const current: Record<string, string | null> = {}
    const conflicts: string[] = []
    let bytesRead = 0
    for (const path of unionPaths(baseline, next)) {
      const bytes = await readOptional(root, `${directory(id)}/${path}`)
      bytesRead += bytes?.length ?? 0
      if (bytesRead > maxBundleBytes) throw new Error('Card directory exceeds read budget')
      current[path] = bytes ? digest(bytes) : null
      if (current[path] !== (baseline?.files[path] ?? null)) conflicts.push(path)
    }
    const preview: CardDirectoryPreview = {
      cardId: id,
      directory: join(root, directory(id)),
      token: digest(Buffer.from(JSON.stringify({ baseline, next, current }))),
      changes: operations.map(op => ({ path: op.path, kind: op.before === null ? 'added' : op.after === null ? 'deleted' : 'modified' })),
      conflicts,
    }
    return { preview, baseline, next, files, operations }
  }

  async function recover(id: string) {
    if (await readOptional(root, `${metadata(id)}/apply.json`)) return recoverApply(id)
    return recoverSave(id)
  }

  async function recoverSave(id: string) {
    const pending = `${metadata(id)}/pending`
    const source = await readOptional(root, `${pending}/journal.json`)
    if (!source) return { recovered: false }
    const value = JSON.parse(source.toString('utf8'))
    const journal: Journal = {
      before: value.before === null ? null : parseBaseline(value.before, id),
      after: parseBaseline(value.after, id),
    }
    const baseline = await loadBaseline(id)
    if (isDeepStrictEqual(baseline, journal.after)) {
      // Baseline is the commit marker; later IDE edits must never be rolled back.
      await fs.rm(await safePath(root, pending), { recursive: true })
      return { recovered: true }
    }
    if (!isDeepStrictEqual(baseline, journal.before)) throw new Error('Recovery baseline conflict')
    const operations = changes(journal.before, journal.after)
    const restore: Array<{ path: string; current: string | null; old: Buffer | null }> = []
    let backupBytes = 0
    for (const [index, op] of operations.entries()) {
      const bytes = await readOptional(root, `${directory(id)}/${op.path}`)
      const current = bytes ? digest(bytes) : null
      if (current !== op.before && current !== op.after) throw new Error(`Recovery conflict; external edit preserved: ${op.path}`)
      const old = op.before === null ? null : await readOptional(root, `${pending}/before/${index}`)
      if (op.before !== null && (!old || digest(old) !== op.before)) throw new Error(`Recovery backup is missing or corrupt: ${op.path}`)
      backupBytes += old?.length ?? 0
      if (backupBytes > maxBundleBytes) throw new Error('Recovery backup exceeds read budget')
      restore.push({ path: op.path, current, old })
    }
    for (const item of restore) {
      await assertHash(root, `${directory(id)}/${item.path}`, item.current)
      if (item.old) await replace(root, `${directory(id)}/${item.path}`, item.old)
      else await removeOptional(root, `${directory(id)}/${item.path}`)
    }
    await fs.rm(await safePath(root, pending), { recursive: true })
    return { recovered: true }
  }

  async function prepareApply(id: string) {
    for (const marker of ['apply.json', 'delete.json', 'import.json', 'pending/journal.json']) {
      if (await readOptional(root, `${metadata(id)}/${marker}`)) throw new Error('Card directory has an unfinished operation; recover it first')
    }
    const baseline = await loadBaseline(id)
    if (!baseline?.snapshot) throw new Error('Save this card directory once to establish its identity and version baseline before applying files')
    const { bundle, files } = await loadCardBundleFiles(async path => {
      const bytes = await readOptional(root, `${directory(id)}/${path}`)
      if (!bytes) throw new Error(`Missing directory file: ${path}`)
      return bytes
    })
    const current = hashes(Object.fromEntries(files))
    const operations = changes(baseline, { version: 1, cardId: id, files: current })
    const database = await options.readCard(id)
    const conflicts = isDeepStrictEqual(database.snapshot, baseline.snapshot) ? [] : ['database']
    const preview: CardDirectoryPreview = { cardId: id, directory: join(root, directory(id)), token: digest(json({ baseline, current, snapshot: database.snapshot })), changes: operations.map(op => ({ path: op.path, kind: op.before === null ? 'added' : op.after === null ? 'deleted' : 'modified' })), conflicts }
    return { bundle, baseline, current, preview }
  }

  function normalizedFiles(bundle: CardBundleFilesInput) {
    const copy = structuredClone(bundle)
    if (copy.artifact.metadata) delete copy.artifact.metadata.exportedAt
    // The export envelope can derive its label/description from Card content.
    // Apply validates the original envelope; recovery compares the editable content.
    copy.artifact.displayName = copy.artifact.card.name
    copy.artifact.description = copy.artifact.card.description
    for (const media of [copy.avatar, copy.background]) {
      if (media?.mediaType === 'image/png' && isPng(media.bytes)) media.bytes = stripPngTextMetadata(media.bytes)
    }
    return hashes(encodeCardBundleFiles(copy))
  }

  async function recoverApply(id: string) {
    const source = await readOptional(root, `${metadata(id)}/apply.json`)
    if (!source) return { recovered: false }
    const journal = JSON.parse(source.toString('utf8'))
    const before = parseBaseline(journal.before, id)
    const after = parseBaseline(journal.after, id)
    const desired = parseBaseline(journal.desired, id)
    const database = await options.readCard(id)
    if (!after.snapshot) {
      if (isDeepStrictEqual(normalizedFiles(database), desired.files)) {
        after.snapshot = database.snapshot
        await replace(root, `${metadata(id)}/apply.json`, json({ before, after, desired }))
      } else {
        if (!isDeepStrictEqual(database.snapshot, before.snapshot)) throw new Error('Apply recovery conflicts with current database changes; no files or database content were overwritten')
        await fs.rm(await safePath(root, `${metadata(id)}/apply.json`))
        return { recovered: true }
      }
    }
    if (!isDeepStrictEqual(database.snapshot, after.snapshot)) throw new Error('Database changed after Apply committed; directory finalization requires review')
    await recoverSave(id)
    const baseline = await loadBaseline(id)
    if (isDeepStrictEqual(baseline, before)) await replace(root, `${metadata(id)}/baseline.json`, json(after))
    else if (!isDeepStrictEqual(baseline?.snapshot, after.snapshot)) throw new Error('Apply recovery baseline conflict')
    // Finish through the same journaled writer, including derived manifest metadata.
    await savePrepared(id, await prepare(id, true))
    await fs.rm(await safePath(root, `${metadata(id)}/apply.json`))
    return { recovered: true }
  }

  async function savePrepared(id: string, state: Awaited<ReturnType<typeof prepare>>): Promise<CardDirectorySaveResult> {
    if (state.preview.conflicts.length) throw new Error(`External edits preserved; synchronization required: ${state.preview.conflicts.join(', ')}`)
    if (!state.operations.length) {
      await replace(root, `${metadata(id)}/baseline.json`, json(state.next))
      return { directory: state.preview.directory, changedFiles: 0 }
    }
    const pending = `${metadata(id)}/pending`
    const pendingPath = await safePath(root, pending)
    await fs.mkdir(dirname(pendingPath), { recursive: true })
    // Leftover staging without a journal never touched managed files.
    await fs.rm(pendingPath, { recursive: true, force: true })
    await fs.mkdir(pendingPath)
    for (const [index, op] of state.operations.entries()) {
      const old = await readOptional(root, `${directory(id)}/${op.path}`)
      if ((old ? digest(old) : null) !== op.before) throw new Error(`External edit preserved: ${op.path}`)
      if (old) await replace(root, `${pending}/before/${index}`, old)
      const bytes = state.files[op.path]
      if (bytes) await replace(root, `${pending}/after/${index}`, bytes)
    }
    await replace(root, `${pending}/journal.json`, json({ before: state.baseline, after: state.next }))
    // ponytail: recoverable process interruption, not power-loss atomicity or an IDE-wide filesystem lock.
    for (const [index, op] of state.operations.entries()) {
      await assertHash(root, `${directory(id)}/${op.path}`, op.before)
      if (op.after === null) await removeOptional(root, `${directory(id)}/${op.path}`)
      else {
        const bytes = await readOptional(root, `${pending}/after/${index}`)
        if (!bytes || digest(bytes) !== op.after) throw new Error(`Staged content changed: ${op.path}`)
        await replace(root, `${directory(id)}/${op.path}`, bytes)
      }
    }
    for (const op of state.operations) await assertHash(root, `${directory(id)}/${op.path}`, op.after)
    await replace(root, `${metadata(id)}/baseline.json`, json(state.next))
    await fs.rm(pendingPath, { recursive: true })
    return { directory: state.preview.directory, changedFiles: state.operations.length }
  }

  return {
    async recoverApplies() {
      const errors: Array<{ cardId: string; error: string }> = []
      let ids: string[]
      try { ids = await fs.readdir(await safePath(root, '.loom/card-directories')) }
      catch (error) { if (isMissing(error)) return errors; throw error }
      for (const id of ids) {
        try {
          assertCardId(id)
          if (await readOptional(root, `${metadata(id)}/apply.json`)) await exclusive(id, () => recoverApply(id))
        } catch (error) { errors.push({ cardId: id, error: error instanceof Error ? error.message : String(error) }) }
      }
      return errors
    },
    previewApply: (id: string) => exclusive(id, async () => (await prepareApply(id)).preview),
    apply: (id: string, token: string, context?: RuntimeRequestContext) => exclusive(id, async () => {
      if (!options.applyCard) throw new Error('Directory apply is not configured')
      const prepared = await prepareApply(id)
      if (prepared.preview.token !== token) throw new Error('Directory apply preview is stale; inspect changes again')
      if (prepared.preview.conflicts.length) throw new Error('Database changed since this directory was saved; refusing to overwrite it')
      if (!prepared.preview.changes.length) return { cardId: id }
      const after: Baseline = { version: 1, cardId: id, files: prepared.current, mediaRefs: prepared.baseline.mediaRefs }
      const desired: Baseline = { version: 1, cardId: id, files: normalizedFiles(prepared.bundle) }
      await replace(root, `${metadata(id)}/apply.json`, json({ before: prepared.baseline, after, desired }))
      try {
        await options.applyCard(id, prepared.bundle.artifact, prepared.baseline.snapshot!, context)
      } catch (error) {
        try { await recoverApply(id) }
        catch (recoveryError) { throw new AggregateError([error, recoveryError], 'Card Apply failed; recovery requires attention', { cause: recoveryError }) }
        throw error
      }
      await recoverApply(id)
      return { cardId: id }
    }),
    deleteCard: <T>(id: string, commit: () => Promise<T>) => exclusive(id, async () => {
      const marker = `${metadata(id)}/delete.json`
      const staged = `${metadata(id)}/deleted`
      if (await readOptional(root, marker)) throw new Error('Card directory has an unfinished deletion; restart to recover')
      const source = await safePath(root, directory(id))
      let exists = false
      try { exists = (await fs.stat(source)).isDirectory() } catch (error) { if (!isMissing(error)) throw error }
      if (exists && !await loadBaseline(id)) throw new Error('Cannot delete an unregistered card directory')
      await replace(root, marker, json({ cardId: id }))
      let result: T
      try {
        if (exists) await fs.rename(source, await safePath(root, staged))
        result = await commit()
      } catch (error) {
        try {
          const stagedPath = await safePath(root, staged)
          let stagedExists = false
          try { stagedExists = (await fs.stat(stagedPath)).isDirectory() } catch (statError) { if (!isMissing(statError)) throw statError }
          if (stagedExists) {
            let sourceReappeared = false
            try { await fs.lstat(source); sourceReappeared = true } catch (statError) { if (!isMissing(statError)) throw statError }
            if (sourceReappeared) throw new Error('A new directory conflicts with deletion rollback', { cause: error })
            await fs.rename(stagedPath, source)
          }
        } catch (restoreError) { throw new AggregateError([error, restoreError], 'Card deletion failed; directory recovery required', { cause: restoreError }) }
        await fs.rm(await safePath(root, marker))
        throw error
      }
      // The DB tombstone commits deletion. Cleanup cannot roll it back and is retried at startup.
      try { await fs.rm(await safePath(root, metadata(id)), { recursive: true }) }
      catch (error) { console.error(`Card ${id} deleted; directory cleanup will retry at startup`, error) }
      return result
    }),
    async recoverDeletions(cardExists: (id: string) => Promise<boolean>) {
      const parent = await safePath(root, '.loom/card-directories')
      let entries: import('node:fs').Dirent[]
      try { entries = await fs.readdir(parent, { withFileTypes: true }) } catch (error) { if (isMissing(error)) return; throw error }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const id = entry.name
        assertCardId(id)
        const marker = `${metadata(id)}/delete.json`
        const bytes = await readOptional(root, marker)
        if (!bytes) continue
        if (JSON.parse(bytes.toString('utf8')).cardId !== id) throw new Error('Invalid card deletion journal')
        await exclusive(id, async () => {
          if (await cardExists(id)) {
            const source = await safePath(root, directory(id))
            const staged = await safePath(root, `${metadata(id)}/deleted`)
            let stagedExists = false
            try { stagedExists = (await fs.stat(staged)).isDirectory() } catch (error) { if (!isMissing(error)) throw error }
            if (stagedExists) {
              try { await fs.lstat(source); throw new Error('Card deletion recovery conflicts with a new directory') } catch (error) { if (!isMissing(error)) throw error }
              await fs.rename(staged, source)
            }
            await fs.rm(await safePath(root, marker))
          } else await fs.rm(await safePath(root, metadata(id)), { recursive: true })
        })
      }
    },
    previewCard: (id: string) => exclusive(id, async () => (await prepare(id)).preview),
    saveCard: (id: string, token: string) => exclusive(id, async (): Promise<CardDirectorySaveResult> => {
      const state = await prepare(id)
      if (state.preview.token !== token) throw new Error('Card directory preview is stale; inspect changes again')
      return savePrepared(id, state)
    }),
    recoverCard: (id: string) => exclusive(id, () => recover(id)),
    async call(method: string, params: JsonValue | undefined, context?: RuntimeRequestContext): Promise<JsonValue> {
      const id = readString(params, 'cardId')
      if (method === 'directories.previewApply') return await this.previewApply(id) as unknown as JsonValue
      if (method === 'directories.apply') return await this.apply(id, readString(params, 'token'), context)
      if (method === 'directories.previewCard') return await this.previewCard(id) as unknown as JsonValue
      if (method === 'directories.saveCard') return await this.saveCard(id, readString(params, 'token')) as unknown as JsonValue
      if (method === 'directories.recoverCard') return await this.recoverCard(id)
      throw new Error(`Unknown directory method: ${method}`)
    },
  }
}

function assertCardId(id: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(id)) throw new Error('Invalid card directory ID')
}

function digest(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function json(value: unknown) {
  return Buffer.from(JSON.stringify(value, null, 2) + '\n')
}

function hashes(files: Record<string, Uint8Array>) {
  return Object.fromEntries(Object.keys(files).sort().map(path => [path, digest(files[path]!)]))
}

function unionPaths(before: Baseline | null, after: Baseline) {
  return [...new Set([...Object.keys(before?.files ?? {}), ...Object.keys(after.files)])].sort()
}

function changes(before: Baseline | null, after: Baseline): Operation[] {
  return unionPaths(before, after).filter(path => before?.files[path] !== after.files[path])
    .map(path => ({ path, before: before?.files[path] ?? null, after: after.files[path] ?? null }))
}

export function parseBaseline(value: unknown, cardId: string): Baseline {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1
    || !('cardId' in value) || value.cardId !== cardId || !('files' in value)
    || !value.files || typeof value.files !== 'object' || Array.isArray(value.files)) throw new Error('Invalid card directory baseline')
  const entries = Object.entries(value.files)
  if (entries.length > 4096) throw new Error('Card directory baseline exceeds file count')
  for (const [path, hash] of entries) {
    validateBundlePath(path)
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid card directory baseline hash')
  }
  if ('snapshot' in value && (!value.snapshot || typeof value.snapshot !== 'object' || Array.isArray(value.snapshot))) throw new Error('Invalid runtime snapshot')
  if ('mediaRefs' in value && (!value.mediaRefs || typeof value.mediaRefs !== 'object' || Array.isArray(value.mediaRefs) || Object.values(value.mediaRefs).some(id => typeof id !== 'string'))) throw new Error('Invalid directory media references')
  return { version: 1, cardId, files: Object.fromEntries(entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)), ...('snapshot' in value ? { snapshot: value.snapshot as JsonObject } : {}), ...('mediaRefs' in value ? { mediaRefs: value.mediaRefs as Baseline['mediaRefs'] } : {}) }
}

export async function readCardDirectoryBinding(root: string, id: string): Promise<{ directoryName: string; artifactId: string } | undefined> {
  assertCardId(id)
  const bytes = await readOptional(root, `.loom/card-directories/${id}/binding.json`)
  if (!bytes) return undefined
  const value = JSON.parse(bytes.toString('utf8'))
  if (typeof value.directoryName !== 'string' || value.directoryName.includes('/') || value.directoryName.includes('\\') || typeof value.artifactId !== 'string') throw new Error('Invalid card directory binding')
  validateBundlePath(value.directoryName)
  return value
}

export async function safePath(root: string, path: string) {
  validateBundlePath(path)
  let current = await fs.realpath(root)
  for (const segment of path.split('/')) {
    current = join(current, segment)
    try {
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink()) throw new Error(`Directory resource cannot follow a symbolic link: ${path}`)
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }
  return current
}

export async function readOptional(root: string, path: string, maxBytes = 64 * 1024 * 1024): Promise<Buffer | null> {
  const target = await safePath(root, path)
  try {
    const stat = await fs.stat(target)
    if (!stat.isFile() || stat.size > maxBytes) throw new Error(`Invalid or oversized directory file: ${path}`)
    const bytes = await fs.readFile(target)
    if (bytes.length > maxBytes) throw new Error(`Oversized directory file: ${path}`)
    return bytes
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

async function assertHash(root: string, path: string, expected: string | null) {
  const bytes = await readOptional(root, path)
  if ((bytes ? digest(bytes) : null) !== expected) throw new Error(`External edit preserved: ${path}`)
}

export async function replace(root: string, path: string, bytes: Uint8Array) {
  const target = await safePath(root, path)
  await fs.mkdir(dirname(target), { recursive: true })
  const temp = `${target}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temp, bytes, { flag: 'wx', mode: 0o600 })
    await fs.rename(temp, target)
  } finally {
    await fs.rm(temp, { force: true })
  }
}

async function removeOptional(root: string, path: string) {
  await fs.rm(await safePath(root, path), { force: true })
}

function isMissing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
