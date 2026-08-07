import { describe, expect, it } from 'vitest'
import type { ContextAssetNode } from '../../../entities/index.js'
import { buildContextAssetSearchIndex, searchContextAssets } from './context-asset-search.js'

const nodes: ContextAssetNode[] = [{
  id: 'root',
  kind: 'module',
  label: '城区档案',
  children: [{
    id: 'station',
    kind: 'entry',
    label: 'Rainline Station',
    meta: 'setting / location',
    body: '黄铜检票口后方藏着 maintenance gate。',
  }],
}]

describe('context asset search', () => {
  const index = buildContextAssetSearchIndex(nodes)

  it('matches labels, paths, metadata and body text with stable ranking', () => {
    expect(searchContextAssets(index, 'rainline')[0]?.id).toBe('station')
    expect(searchContextAssets(index, '城区 station')[0]?.id).toBe('station')
    expect(searchContextAssets(index, 'location')[0]?.id).toBe('station')
    expect(searchContextAssets(index, 'maintenance')[0]).toMatchObject({ id: 'station', rank: 5 })
  })

  it('returns no results for an empty or unmatched query', () => {
    expect(searchContextAssets(index, '  ')).toEqual([])
    expect(searchContextAssets(index, 'clocktower')).toEqual([])
  })
})
