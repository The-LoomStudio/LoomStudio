import { collectPromptInputs } from '../../../packages/application-runtime/src/cards/card-bundle-codec.js'
import { createVariableRenderContext } from '../../../packages/application-runtime/src/prompt/variables.js'
import type { ObservationBuild } from '../../../packages/application-runtime/src/observability/types.js'
import { describe, expect, it } from 'vitest'
import { compilePromptDataModel } from '../../../packages/application-runtime/src/prompt/prompt-build-pipeline.js'
import type { PromptContribution, SourceNode } from '../../../packages/application-runtime/src/prompt/prompt-builder.js'
import { combineActivationGates, type PromptActivation } from '../../../packages/application-runtime/src/prompt/prompt-activation.js'

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
  activation?: PromptActivation
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
  it('restores a disabled folder without rewriting descendants or external Lore', () => {
    const root: Parameters<typeof collectPromptInputs>[0]['nodes'][number] = {
      id: 'preset', kind: 'module', category: 'preset', label: 'Preset', children: [{
        id: 'message', kind: 'message', label: 'Message', capabilities: { roleHint: 'system' }, children: [{
          id: 'optional', kind: 'folder', label: 'Optional', enabled: false, children: [
            { id: 'on', kind: 'entry', label: 'On', enabled: true, body: 'ENABLED_TEXT' },
            { id: 'off', kind: 'entry', label: 'Off', enabled: false, body: 'DISABLED_TEXT' },
            { id: 'nested', kind: 'folder', label: 'Nested', enabled: false, children: [
              { id: 'nested-on', kind: 'entry', label: 'Nested on', enabled: true, body: 'NESTED_TEXT' },
            ] },
            { id: 'anchor', kind: 'virtual', label: 'Anchor', capabilities: { targetAnchorId: '@custom.lore' } },
          ],
        }],
      }],
    }
    const lore: typeof root = { id: 'lore', kind: 'module', category: 'lore', label: 'Lore', children: [
      { id: 'external', kind: 'entry', label: 'External', enabled: true, body: 'EXTERNAL_TEXT', capabilities: { targetAnchorId: '@custom.lore' } },
    ] }
    const folder = root.children![0]!.children![0]!
    const originalChildren = structuredClone(folder.children)
    const originalLore = structuredClone(lore)
    function build() {
      const sourceNodes: SourceNode[] = []
      const contributions: PromptContribution[] = []
      collectPromptInputs({ nodes: [root, lore], contributions, sourceNodes, variables: createVariableRenderContext(),
        parentEnabled: true, parentActivationGates: [], parentId: null, inheritedCategory: undefined, inheritedSourceId: undefined })
      return { sourceNodes, output: compilePromptDataModel({ sourceNodes, contributions, skeletonRootId: root.id }) }
    }
    const disabled = build()
    expect(disabled.output.messages).toEqual([])
    expect(disabled.sourceNodes.find(node => node.id === 'on')).toMatchObject({ enabled: false, evidence: { disabledReason: 'ancestor disabled' } })
    expect(disabled.sourceNodes.find(node => node.id === 'external')?.enabled).toBe(true)
    folder.enabled = true
    const restored = build()
    const text = restored.output.messages.map(message => message.content).join('\n')
    expect(text).toContain('ENABLED_TEXT')
    expect(text).toContain('EXTERNAL_TEXT')
    expect(text).not.toContain('DISABLED_TEXT')
    expect(text).not.toContain('NESTED_TEXT')
    expect(folder.children).toEqual(originalChildren)
    expect(lore).toEqual(originalLore)
  })

  it('keeps Prompt output intact when evidence exceeds its budget or rejects writes', () => {
    const model = { sourceNodes: [{ ...node('entry', null, 0, 'entry'), body: 'x'.repeat(300_000) }], contributions: [] }
    const observation: ObservationBuild = {}
    expect(compilePromptDataModel(model, observation).messages).toEqual(compilePromptDataModel(model).messages)
    expect(observation.diagnostics).toContainEqual(expect.objectContaining({ code: 'observation.budget_exceeded' }))
    expect(observation.sources?.[0]?.original).toBeUndefined()
    expect(compilePromptDataModel(model, Object.freeze({})).messages).toEqual(compilePromptDataModel(model).messages)
  })

  it('uses only the selected skeleton and respects disabled and conditional subtrees', () => {
    const observation: ObservationBuild = {}
    const compiled = compilePromptDataModel({
      skeletonRootId: 'root',
      currentInput: 'hello',
      sourceNodes: [
        node('root', null, 0, 'module'),
        { ...node('before', 'root', 0, 'entry'), body: 'Before' },
        { ...node('off', 'root', 1, 'folder'), enabled: false },
        { ...node('hidden', 'off', 0, 'entry'), body: 'Disabled' },
        { ...node('conditional', 'root', 2, 'entry'), body: 'Conditional',
          capabilities: { activation: { kind: 'keyword', keywords: ['dragon'] } } },
        node('slot', 'root', 3, 'virtual'),
        { ...node('after', 'root', 4, 'entry'), body: 'After' },
        { ...node('external', null, 1, 'entry'), body: 'Must not leak' },
      ],
      contributions: [contribution('mounted', 'external', 'Mounted once', 'slot')],
    }, observation)
    expect(observation.sources?.find(source => source.id === 'slot')).toMatchObject({ parentId: 'root', orderIndex: 3, nodeKind: 'virtual' })
    expect(compiled.messages.map(message => message.content)).toEqual(['Before\n\nMounted once\n\nAfter'])
  })

  it.each([false, true])('preserves Session roles and individual messages (inside MessageBlock: %s)', wrapped => {
    const history = ['user', 'assistant', 'assistant'].map((role, index) => ({
      ...contribution(`history-${index}`, `history-node-${index}`, `History ${index}`, '@chat.session', index, role as 'user' | 'assistant'),
      sourceRef: { kind: 'sessionHistory' as const, sourceId: 'session', sourceNodeId: `history-node-${index}` },
    }))
    const build = () => compilePromptDataModel({
      sourceNodes: [
        node('root', null, 0, 'module'),
        ...(wrapped ? [{ ...node('wrapper', 'root', 0, 'message'), capabilities: { roleHint: 'system' as const } }] : []),
        { ...node('session', wrapped ? 'wrapper' : 'root', 0, 'virtual'), capabilities: { targetAnchorId: '@chat.session' } },
      ],
      contributions: history,
    })
    const compiled = build()
    expect(compiled.messages).toEqual(history.map(item => ({
      role: item.capabilities.roleHint, content: item.content, fragmentIds: [item.id],
    })))
  })

  it('rejects text in the native Session sequence and messages in text anchors', () => {
    const slot = { ...node('session', null, 0, 'virtual'), capabilities: { targetAnchorId: '@chat.session' } }
    expect(() => compilePromptDataModel({ sourceNodes: [slot],
      contributions: [contribution('text', 'lore', 'Lore text', '@chat.session')],
    })).toThrow('cannot receive text contributions')
    expect(() => compilePromptDataModel({ sourceNodes: [node('text', null, 0, 'virtual')],
      contributions: [{ ...contribution('native', 'session', '', 'text'),
        sourceRef: { kind: 'sessionHistory', sourceId: 'session', sourceNodeId: 'session' },
        messages: [{ role: 'assistant', tool_calls: [{ id: 'call', type: 'function', function: { name: 'read', arguments: '{}' } }] },
          { role: 'tool', tool_call_id: 'call', content: 'result' }] }],
    })).toThrow('require a message sequence inlet')
  })

  it('preserves native tool call/result pairs at the Session sequence', () => {
    const messages = [{ role: 'assistant' as const, content: '', tool_calls: [{ id: 'call', type: 'function' as const, function: { name: 'read', arguments: '{}' } }] },
      { role: 'tool' as const, tool_call_id: 'call', content: 'result' }]
    const compiled = compilePromptDataModel({
      sourceNodes: [{ ...node('session', null, 0, 'virtual'), capabilities: { targetAnchorId: '@chat.session' } }],
      contributions: [{ ...contribution('native', 'entry', '', '@chat.session'),
        sourceRef: { kind: 'sessionHistory', sourceId: 'session', sourceNodeId: 'entry' }, messages }],
    })
    expect(compiled.messages).toEqual(messages.map(message => ({ ...message, content: message.content ?? '', fragmentIds: ['native'] })))
  })

  it('does not re-inject a disabled explicit anchor through the legacy Session fallback', () => {
    const compiled = compilePromptDataModel({
      sourceNodes: [
        node('root', null, 0, 'module'),
        { ...node('session', 'root', 0, 'virtual'), capabilities: { targetAnchorId: '@chat.session' } },
        { ...node('lower', 'root', 1, 'virtual'), enabled: false, capabilities: { targetAnchorId: '@lore.lower' } },
      ],
      contributions: [contribution('dynamic', 'lore', 'Disabled context', '@lore.lower')],
    })
    expect(compiled.messages).toEqual([])
  })

  it('filters inactive contributions', () => {
    const activation = combineActivationGates([{ kind: 'manual' }])
    const compiled = compilePromptDataModel({
      sourceNodes: basicSourceNodes,
      contributions: [
        contribution('c1', 'entry1', 'Active Content', 'anchor1'),
        contribution('c2', 'entry2', 'Inactive Content', 'anchor1', undefined, 'system', activation),
      ],
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
          displayName: 'Message 1',
          sourceId: 'preset',
          parentId: 'root',
          orderIndex: 0,
          kind: 'message',
          capabilities: { roleHint: 'system' },
        },
        {
          id: 'entry1',
          displayName: 'Entry 1',
          sourceId: 'preset',
          parentId: 'msg1',
          orderIndex: 0,
          kind: 'entry',
          body: 'System Part A',
        },
        {
          id: 'msg2',
          displayName: 'Message 2',
          sourceId: 'preset',
          parentId: 'root',
          orderIndex: 1,
          kind: 'message',
          capabilities: { roleHint: 'system' },
        },
        {
          id: 'anchor2',
          displayName: 'Setting',
          sourceId: 'preset',
          parentId: 'msg2',
          orderIndex: 0,
          kind: 'virtual',
          capabilities: { targetAnchorId: '@test.setting' },
        },
        {
          id: 'msg3',
          displayName: 'Message 3',
          sourceId: 'preset',
          parentId: 'root',
          orderIndex: 2,
          kind: 'message',
          capabilities: { roleHint: 'user' },
        },
        {
          id: 'anchor3',
          displayName: 'Input',
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
