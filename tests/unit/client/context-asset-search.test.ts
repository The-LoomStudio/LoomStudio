import { describe, expect, it } from 'vitest'
import type { ContextAssetNode } from '../../../apps/studio-client/src/entities/index.js'
import { buildContextAssetSearchIndex, searchContextAssets } from '../../../apps/studio-client/src/features/context-assets/model/context-asset-search.js'

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

  it.each([
    `${' \n\t'.repeat(100)}Target phrase and remaining text`,
    `${'İ'.repeat(200)} Target phrase and remaining text`,
    `${'😀'.repeat(100)} Target phrase and remaining text`,
  ])('keeps matched text in the excerpt despite offset-changing prefixes', body => {
    const records = buildContextAssetSearchIndex([{ id: 'text', kind: 'entry', label: 'Text', body }])
    const result = searchContextAssets(records, 'target')[0]
    expect(result?.excerpt).toContain('Target phrase')
    expect(result?.excerpt).not.toContain('\n')
  })
})
