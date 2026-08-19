import {
  createSqliteDataEngine,
  type SqliteDataEngine,
} from '../packages/data-engine/src/index.js'
import {
  createSqliteDocumentStore,
  type SqliteDocumentStore,
} from '../packages/document-store/src/index.js'
import {
  createPromptResourceStore,
  type PromptResourceStore,
} from '../packages/prompt-resource-store/src/index.js'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { JsonValue } from '../packages/shared/src/index.js'

const SETTING_ENTRY_COUNT = 500
const PRESET_ENTRY_COUNT = 100
const UPDATE_COUNT = 100
const ENTRY_BODY_BYTES = 1024
const ACTOR = {
  kind: 'system',
  id: 'prompt-resource-storage-characterization',
} as const
const DOCUMENT_TYPE = 'airp.promptResource'

type FixtureNode = {
  id: string
  kind: 'module' | 'entry'
  category: 'setting' | 'preset'
  label: string
  enabled: true
  body: string
  children?: FixtureNode[]
}

type FixtureResource = {
  resourceKind: 'setting' | 'preset'
  rootNode: FixtureNode
}

type StorageMeasurement = {
  initialCheckpointDbBytes: number
  walBytesAfterUpdates: number
  finalCheckpointDbBytes: number
  updateElapsedMs: number
  rows: Record<string, number>
}

type EngineBundle = {
  directory: string
  filename: string
  walFilename: string
  engine: SqliteDataEngine
}

function createIdFactory(label: string): (prefix: string) => string {
  let sequence = 0
  return (prefix) => `${label}-${prefix}-${++sequence}`
}

function makeBody(entryIndex: number, revision: number): string {
  const prefix = `fixture-entry-${String(entryIndex).padStart(3, '0')}-revision-${String(revision).padStart(3, '0')}-`
  return prefix + 'x'.repeat(Math.max(0, ENTRY_BODY_BYTES - prefix.length))
}

function makeResource(
  resourceKind: FixtureResource['resourceKind'],
  entryCount: number,
): FixtureResource {
  const rootId = `fixture.${resourceKind}.root`
  return {
    resourceKind,
    rootNode: {
      id: rootId,
      kind: 'module',
      category: resourceKind,
      label: `Storage Characterization ${resourceKind}`,
      enabled: true,
      body: makeBody(-1, 0),
      children: Array.from({ length: entryCount }, (_, index) => ({
        id: `fixture.${resourceKind}.entry.${String(index).padStart(3, '0')}`,
        kind: 'entry' as const,
        category: resourceKind,
        label: `Entry ${String(index).padStart(3, '0')}`,
        enabled: true as const,
        body: makeBody(index, 0),
      })),
    },
  }
}

function configureWal(engine: SqliteDataEngine): void {
  engine.database.exec('PRAGMA wal_autocheckpoint = 0')
}

function checkpoint(engine: SqliteDataEngine): void {
  engine.database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()
}

async function fileBytes(filename: string): Promise<number> {
  try {
    return (await stat(filename)).size
  } catch {
    return 0
  }
}

async function createEngineBundle(
  root: string,
  label: string,
): Promise<EngineBundle> {
  const directory = await mkdtemp(join(root, `${label}-`))
  const filename = join(directory, 'storage.sqlite')
  try {
    const engine = createSqliteDataEngine({
      filename,
      createId: createIdFactory(label),
      now: () => '2026-08-19T00:00:00.000Z',
    })
    configureWal(engine)
    return { directory, filename, walFilename: `${filename}-wal`, engine }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

async function measureV1(
  root: string,
  fixture: { setting: FixtureResource; preset: FixtureResource },
): Promise<StorageMeasurement> {
  const bundle = await createEngineBundle(root, 'v1-document-store')
  let documents: SqliteDocumentStore | undefined
  try {
    documents = createSqliteDocumentStore({ engine: bundle.engine })
    await documents.write({
      id: 'fixture.setting',
      type: DOCUMENT_TYPE,
      content: fixture.setting as unknown as JsonValue,
      actor: ACTOR,
      reason: 'storage-characterization.create',
    })
    await documents.write({
      id: 'fixture.preset',
      type: DOCUMENT_TYPE,
      content: fixture.preset as unknown as JsonValue,
      actor: ACTOR,
      reason: 'storage-characterization.create',
    })
    checkpoint(bundle.engine)
    const initialCheckpointDbBytes = await fileBytes(bundle.filename)

    let version = 1
    const startedAt = performance.now()
    for (let revision = 1; revision <= UPDATE_COUNT; revision += 1) {
      const content = structuredClone(fixture.setting)
      content.rootNode.children![0]!.body = makeBody(0, revision)
      const result = await documents.write({
        id: 'fixture.setting',
        type: DOCUMENT_TYPE,
        content: content as unknown as JsonValue,
        expectedVersion: version,
        actor: ACTOR,
        reason: 'storage-characterization.update',
      })
      version = result.documents[0]?.version ?? version + 1
    }
    const updateElapsedMs = performance.now() - startedAt
    const walBytesAfterUpdates = await fileBytes(bundle.walFilename)
    checkpoint(bundle.engine)
    const finalCheckpointDbBytes = await fileBytes(bundle.filename)
    const rows = {
      changesets: Number(
        bundle.engine.database
          .prepare('SELECT COUNT(*) AS count FROM changesets')
          .get()?.count ?? 0,
      ),
      documents: Number(
        bundle.engine.database
          .prepare('SELECT COUNT(*) AS count FROM documents')
          .get()?.count ?? 0,
      ),
      documentRevisions: Number(
        bundle.engine.database
          .prepare('SELECT COUNT(*) AS count FROM document_revisions')
          .get()?.count ?? 0,
      ),
    }
    return {
      initialCheckpointDbBytes,
      walBytesAfterUpdates,
      finalCheckpointDbBytes,
      updateElapsedMs,
      rows,
    }
  } finally {
    try {
      documents?.close()
    } finally {
      try {
        bundle.engine.close()
      } finally {
        await rm(bundle.directory, { recursive: true, force: true })
      }
    }
  }
}

async function measureV2(
  root: string,
  fixture: { setting: FixtureResource; preset: FixtureResource },
): Promise<StorageMeasurement> {
  const bundle = await createEngineBundle(root, 'v2-prompt-resource-store')
  let store: PromptResourceStore | undefined
  try {
    store = createPromptResourceStore({
      engine: bundle.engine,
      createId: createIdFactory('v2-store'),
      now: () => '2026-08-19T00:00:00.000Z',
    })
    await store.createResource({
      id: 'fixture.setting',
      resourceKind: 'setting',
      rootNode: fixture.setting.rootNode,
      actor: ACTOR,
      reason: 'storage-characterization.create',
    })
    await store.createResource({
      id: 'fixture.preset',
      resourceKind: 'preset',
      rootNode: fixture.preset.rootNode,
      actor: ACTOR,
      reason: 'storage-characterization.create',
    })
    checkpoint(bundle.engine)
    const initialCheckpointDbBytes = await fileBytes(bundle.filename)

    let version = 1
    const startedAt = performance.now()
    for (let revision = 1; revision <= UPDATE_COUNT; revision += 1) {
      const result = await store.mutateResource({
        resourceId: 'fixture.setting',
        expectedVersion: version,
        actor: ACTOR,
        reason: 'storage-characterization.update',
        mutations: [
          {
            kind: 'node.update',
            nodeId: 'fixture.setting.entry.000',
            patch: { body: makeBody(0, revision) },
          },
        ],
      })
      version = result.resource.version
    }
    const updateElapsedMs = performance.now() - startedAt
    const walBytesAfterUpdates = await fileBytes(bundle.walFilename)
    checkpoint(bundle.engine)
    const finalCheckpointDbBytes = await fileBytes(bundle.filename)
    const rows = {
      changesets: Number(
        bundle.engine.database
          .prepare('SELECT COUNT(*) AS count FROM changesets')
          .get()?.count ?? 0,
      ),
      promptResources: Number(
        bundle.engine.database
          .prepare('SELECT COUNT(*) AS count FROM prompt_resources')
          .get()?.count ?? 0,
      ),
      promptResourceNodes: Number(
        bundle.engine.database
          .prepare('SELECT COUNT(*) AS count FROM prompt_resource_nodes')
          .get()?.count ?? 0,
      ),
      promptResourceNodeRevisions: Number(
        bundle.engine.database
          .prepare(
            'SELECT COUNT(*) AS count FROM prompt_resource_node_revisions',
          )
          .get()?.count ?? 0,
      ),
      promptResourceHeaderRevisions: Number(
        bundle.engine.database
          .prepare(
            'SELECT COUNT(*) AS count FROM prompt_resource_header_revisions',
          )
          .get()?.count ?? 0,
      ),
    }
    return {
      initialCheckpointDbBytes,
      walBytesAfterUpdates,
      finalCheckpointDbBytes,
      updateElapsedMs,
      rows,
    }
  } finally {
    try {
      bundle.engine.close()
    } finally {
      await rm(bundle.directory, { recursive: true, force: true })
    }
  }
}

const root = await mkdtemp(
  join(tmpdir(), 'loom-prompt-resource-storage-measurement-'),
)
try {
  const fixture = {
    setting: makeResource('setting', SETTING_ENTRY_COUNT),
    preset: makeResource('preset', PRESET_ENTRY_COUNT),
  }
  const v1 = await measureV1(root, fixture)
  const v2 = await measureV2(root, fixture)
  console.log(
    JSON.stringify(
      {
        characterization: 'local-only; not a performance SLA',
        fixture: {
          settingEntries: SETTING_ENTRY_COUNT,
          presetEntries: PRESET_ENTRY_COUNT,
          updateCount: UPDATE_COUNT,
          entryBodyBytes: ENTRY_BODY_BYTES,
          updatedNode: 'fixture.setting.entry.000',
        },
        v1DocumentStore: v1,
        v2PromptResourceStore: v2,
      },
      null,
      2,
    ),
  )
} finally {
  await rm(root, { recursive: true, force: true })
}
