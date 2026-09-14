import { bench, run, summary } from 'mitata'

import type { ContextAssetNode } from '../apps/studio-client/src/entities/index.js'
import { buildContextAssetSearchIndex, searchContextAssets } from '../apps/studio-client/src/features/context-assets/model/context-asset-search.js'
import { buildProjectionWorkbenchModel } from '../apps/studio-client/src/features/context-assets/model/projection-workbench.js'
import { moveContextAssetNode, updateContextAssetNode } from '../apps/studio-client/src/features/context-assets/model/tree-ops.js'

const sizes = [500, 5_000, 50_000]
const fixtures = new Map(sizes.map(size => [size, createContextAssetFixture(size)]))
const searchIndexes = new Map(sizes.map(size => [
  size,
  buildContextAssetSearchIndex(readFixture(size)),
]))

summary(() => {
  for (const size of sizes) {
    const nodes = readFixture(size)
    const index = searchIndexes.get(size)!
    const lastId = `entry-${size - 1}`
    const middleId = `entry-${Math.floor(size / 2)}`

    bench(`build search index / ${size.toLocaleString('en-US')} nodes`, () => {
      return buildContextAssetSearchIndex(nodes)
    })

    bench(`search context assets / ${size.toLocaleString('en-US')} nodes`, () => {
      return searchContextAssets(index, 'district 42 maintenance')
    })

    bench(`build projection model / ${size.toLocaleString('en-US')} nodes`, () => {
      return buildProjectionWorkbenchModel(nodes)
    })

    bench(`update final node / ${size.toLocaleString('en-US')} nodes`, () => {
      return updateContextAssetNode(nodes, lastId, { body: 'Updated benchmark body.' })
    })

    bench(`move middle node / ${size.toLocaleString('en-US')} nodes`, () => {
      return moveContextAssetNode(nodes, middleId, lastId, 'after')
    })
  }
})

await run({ throw: true })

function createContextAssetFixture(size: number): ContextAssetNode[] {
  const children = Array.from({ length: size }, (_, index): ContextAssetNode => ({
    id: `entry-${index}`,
    kind: 'entry',
    label: `District ${index}`,
    meta: index % 5 === 0 ? 'setting location maintenance' : 'setting location',
    body: `Archive entry ${index}. The maintenance gate belongs to district ${index % 100}.`,
    projection: {
      lifecycle: 'always',
      order: `entry: ${index * 10}`,
      slotKey: 'setting-layer:benchmark@setting.stable',
      sourceKind: 'actual',
      zoneId: 'setting.stable',
      entryOrder: index * 10,
    },
  }))

  return [{
    id: 'benchmark-root',
    kind: 'module',
    category: 'setting',
    label: 'Benchmark Setting',
    children,
  }]
}

function readFixture(size: number): ContextAssetNode[] {
  const fixture = fixtures.get(size)
  if (!fixture) throw new Error(`Missing context asset benchmark fixture: ${size}`)
  return fixture
}
