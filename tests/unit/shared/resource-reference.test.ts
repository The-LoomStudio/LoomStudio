import { describe, expect, it } from 'vitest'
import { formatResourceReference, parseResourceReference, type ResourceReference } from '../../../packages/shared/src/resource-reference.js'

describe('resource reference URI', () => {
  it.each<ResourceReference>([
    { kind: 'prompt-resource', resourceId: '卡 /?&', nodeId: '节点#1', version: 2, startLine: 3, endLine: 8 },
    { kind: 'state', target: { scope: 'timeline', timelineId: 't', branchId: 'b' }, revisionId: 'r', pointer: '/a~1b/inventory', startLine: 1, endLine: 2 },
    { kind: 'state', target: { scope: 'global' }, revisionId: 'r1', pointer: '', startLine: 1, endLine: 1 },
    { kind: 'script', documentId: 'doc', version: 3, startLine: 1, endLine: 5 },
  ])('round trips target and version: $kind', reference => {
    expect(parseResourceReference(formatResourceReference(reference))).toEqual(reference)
  })
  it.each([
    'javascript:alert(1)',
    'loom-resource://prompt-resource?resource=a&node=b&version=1#L0-L1',
    'loom-resource://prompt-resource?resource=a&node=b&version=1#L8-L1',
    'loom-resource://prompt-resource?resource=a&node=b&version=1&version=2#L1-L1',
    'loom-resource://script?document=a&version=1&command=delete#L1-L1',
    'loom-resource://user@script?document=a&version=1#L1-L1',
    'loom-resource://state?scope=global&revision=r&pointer=%2Fbad~2#L1-L1',
    'loom-resource://state?scope=timeline&timeline=t&revision=r&pointer=#L1-L1',
  ])('rejects malformed or non-read reference: %s', uri => {
    expect(parseResourceReference(uri)).toBeUndefined()
  })
})
