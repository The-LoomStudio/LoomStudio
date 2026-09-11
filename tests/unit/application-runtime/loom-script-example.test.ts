import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createBlobStore } from '@loom-studio/blob-store'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createNarrativeStore } from '@loom-studio/narrative-store'
import { createPromptResourceStore } from '@loom-studio/prompt-resource-store'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []
const exampleRoot = join(process.cwd(), 'examples/loom-scripts')

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Loom Script tutorial example', () => {
  it('imports the sample through the formal Application API and resolves both renderers', async () => {
    const runtime = await createRuntime() as any
    const card = await runtime.createCard({ name: 'Alice Tutorial' })
    const owner = { kind: 'card', cardId: card.card.id } as const
    const rule = JSON.parse(await readFile(join(exampleRoot, 'character-status.rule.json'), 'utf8'))
    const extractor = JSON.parse(await readFile(join(exampleRoot, 'character-status.extractor.json'), 'utf8'))
    const source = await readFile(join(exampleRoot, 'alice-presentation.loom.js'), 'utf8')

    await runtime.upsertTextTransformRule({ ruleId: 'character-status', rule: { ...rule, owner } })
    await runtime.upsertTextExtractor({ extractorId: 'character-status-artifact', extractor: { ...extractor, owner } })
    const imported = await runtime.importLoomScript({ owner, fileName: 'alice-presentation.loom.js', source })
    expect(imported.script.contributions.map((item: any) => item.renderer.id)).toEqual(['status-panel', 'status-summary'])

    const created = await runtime.createLoomScriptMount({ target: owner, scriptDocumentId: imported.script.id, orderIndex: 0 })
    expect(created.mount).toMatchObject({ enabled: false, grantedCapabilities: [] })
    const enabled = await runtime.updateLoomScriptMount({
      mountId: created.mount.id,
      expectedVersion: created.mount.version,
      enabled: true,
      orderIndex: 0,
      grantedCapabilities: [],
    })
    expect(enabled.mount).toMatchObject({ enabled: true, grantedCapabilities: [] })

    const timeline = await runtime.createNarrativeTimeline({ cardId: card.card.id })
    const resolved = await runtime.resolveLoomScriptRendererMounts({ timelineId: timeline.timeline.id })
    expect(resolved.mounts).toHaveLength(1)
    expect(resolved.mounts[0]?.source).toBe(source)
    expect(resolved.mounts[0]?.script.contributions.map((item: any) => item.renderer.id)).toEqual(['status-panel', 'status-summary'])
  })
})

async function createRuntime() {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-09-11T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const rootDirectory = await mkdtemp(join(tmpdir(), 'loom-script-example-'))
  roots.push(rootDirectory)
  return createApplicationRuntime({
    dataEngine: engine,
    documents: createSqliteDocumentStore({ engine }),
    narratives: createNarrativeStore({ engine, createId, now }),
    promptResources: createPromptResourceStore({ engine, createId, now }),
    blobs: createBlobStore({ engine, rootDirectory, createId, now }),
  })
}
