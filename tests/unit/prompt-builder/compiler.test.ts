import { describe, expect, it } from 'vitest'
import { compilePromptDataModel } from '../../../packages/application-runtime/src/prompt/prompt-build-pipeline.js'
import type { PromptContribution, SourceNode } from '../../../packages/application-runtime/src/prompt/prompt-builder.js'
import { combineActivationGates } from '../../../packages/application-runtime/src/prompt/prompt-activation.js'

function node(id: string, parentId: string | null, orderIndex: number, kind: SourceNode['kind']): SourceNode {
  return {
    id,
    sourceId: 'src-1',
    parentId,
    displayName: `Node ${id}`,
    orderIndex,
    kind,
  }
}

function contribution(
  id: string,
  sourceNodeId: string,
  content: string,
  targetAnchorId?: string,
  localDepth?: number,
  roleHint: 'system' | 'user' | 'assistant' | 'developer' = 'system',
  activation?: any
): PromptContribution {
  return {
    id,
    sourceRef: { kind: 'preset', sourceId: 'src-1', sourceNodeId },
    content,
    capabilities: {
      targetAnchorId,
      localDepth,
      roleHint,
      activation,
    },
  }
}

const basicSourceNodes: SourceNode[] = [
  node('root', null, 0, 'folder'),
  node('anchor1', 'root', 0, 'virtual'),
  node('entry1', 'root', 1, 'entry'),
  node('folder1', 'root', 2, 'folder'),
  node('entry2', 'folder1', 0, 'entry'),
  node('anchor2', 'folder1', 1, 'virtual'),
]

describe('PromptBuildPipeline', () => {
  it('filters inactive contributions', () => {
    const activation = combineActivationGates([{ kind: 'manual' }])
    const compiled = compilePromptDataModel({
      sourceNodes: basicSourceNodes,
      contributions: [
        contribution('c1', 'entry1', 'Active Content', 'anchor1'),
        contribution('c2', 'entry2', 'Inactive Content', 'anchor1', undefined, 'system', activation),
      ],
      activationFacts: { manualOverrides: new Set() },
    })

    expect(compiled.messages.length).toBe(1)
    expect(compiled.messages[0]?.content).toBe('Active Content')
    expect(compiled.messages[0]?.fragmentIds).toEqual(['c1'])
  })

  it('traverses the tree in DFS order and combines sequential same-role fragments', () => {
    const compiled = compilePromptDataModel({
      sourceNodes: basicSourceNodes,
      contributions: [
        contribution('c1', 'entry1', 'First system message', 'anchor1'),
        contribution('c2', 'entry2', 'Second system message', 'anchor2'),
      ],
    })

    expect(compiled.messages.length).toBe(1)
    expect(compiled.messages[0]?.role).toBe('system')
    expect(compiled.messages[0]?.content).toBe('First system message\n\nSecond system message')
    expect(compiled.messages[0]?.fragmentIds).toEqual(['c1', 'c2'])
  })

  it('sorts virtual anchor contributions by local depth', () => {
    const compiled = compilePromptDataModel({
      sourceNodes: [
        node('root', null, 0, 'folder'),
        node('anchor', 'root', 0, 'virtual'),
      ],
      contributions: [
        contribution('c1', '', 'Middle', 'anchor', 10),
        contribution('c2', '', 'Last', 'anchor', 20),
        contribution('c3', '', 'First', 'anchor', 5),
      ],
    })

    expect(compiled.messages.length).toBe(1)
    expect(compiled.messages[0]?.content).toBe('First\n\nMiddle\n\nLast')
    expect(compiled.messages[0]?.fragmentIds).toEqual(['c3', 'c1', 'c2'])
  })

  it('separates messages when roles differ', () => {
    const compiled = compilePromptDataModel({
      sourceNodes: basicSourceNodes,
      contributions: [
        contribution('c1', 'entry1', 'Sys 1', 'anchor1', undefined, 'system'),
        contribution('c2', 'entry2', 'User 1', 'anchor2', undefined, 'user'),
        contribution('c3', 'entry2', 'Sys 2', 'anchor2', undefined, 'system'),
      ],
    })

    expect(compiled.messages.length).toBe(3)
    expect(compiled.messages[0]?.role).toBe('system')
    expect(compiled.messages[0]?.content).toBe('Sys 1')
    expect(compiled.messages[1]?.role).toBe('user')
    expect(compiled.messages[1]?.content).toBe('User 1')
    expect(compiled.messages[2]?.role).toBe('system')
    expect(compiled.messages[2]?.content).toBe('Sys 2')
  })

  it('treats kind: message as first-class message boundaries and does not merge adjacent same-role messages', () => {
    const compiled = compilePromptDataModel({
      sourceNodes: [
        node('root', null, 0, 'module'),
        {
          id: 'msg1',
          sourceId: 'preset',
          parentId: 'root',
          orderIndex: 0,
          kind: 'message',
          capabilities: { roleHint: 'system' },
        },
        {
          id: 'entry1',
          sourceId: 'preset',
          parentId: 'msg1',
          orderIndex: 0,
          kind: 'entry',
          body: 'System Part A',
        },
        {
          id: 'msg2',
          sourceId: 'preset',
          parentId: 'root',
          orderIndex: 1,
          kind: 'message',
          capabilities: { roleHint: 'system' },
        },
        {
          id: 'anchor2',
          sourceId: 'preset',
          parentId: 'msg2',
          orderIndex: 0,
          kind: 'virtual',
          capabilities: { targetAnchorId: '@test.setting' },
        },
        {
          id: 'msg3',
          sourceId: 'preset',
          parentId: 'root',
          orderIndex: 2,
          kind: 'message',
          capabilities: { roleHint: 'user' },
        },
        {
          id: 'anchor3',
          sourceId: 'preset',
          parentId: 'msg3',
          orderIndex: 0,
          kind: 'virtual',
          capabilities: { targetAnchorId: '@chat.input' },
        },
      ],
      contributions: [
        contribution('c-setting', 'setting1', 'System Part B (World Setting)', '@test.setting'),
        contribution('c-input', 'input1', 'User Input Content', '@chat.input'),
      ],
    })

    expect(compiled.messages.length).toBe(3)
    expect(compiled.messages[0]).toEqual({
      role: 'system',
      content: 'System Part A',
      fragmentIds: ['entry1'],
    })
    expect(compiled.messages[1]).toEqual({
      role: 'system',
      content: 'System Part B (World Setting)',
      fragmentIds: ['c-setting'],
    })
    expect(compiled.messages[2]).toEqual({
      role: 'user',
      content: 'User Input Content',
      fragmentIds: ['c-input'],
    })
  })
})

