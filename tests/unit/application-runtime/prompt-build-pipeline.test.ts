import { describe, expect, it } from 'vitest'
import { compilePromptWithCore } from '../../../packages/application-runtime/src/prompt-build-pipeline.js'
import { compilePromptDataModel, defaultCompositionSkeleton } from '../../../packages/application-runtime/src/prompt-builder.js'

describe('PromptBuild Core pipeline', () => {
  it('runs materialize, order, and emit while preserving activation projection', () => {
    const result = compilePromptWithCore({
      skeleton: defaultCompositionSkeleton,
      sourceNodes: [
        { id: 'root', sourceId: 'preset-1', parentId: null, displayName: 'Preset', orderIndex: 0 },
        { id: 'system', sourceId: 'preset-1', parentId: 'root', displayName: 'System', orderIndex: 0 },
        { id: 'setting', sourceId: 'setting-1', parentId: null, displayName: 'Setting', orderIndex: 1 },
      ],
      orderProfile: { id: 'profile.test', scope: 'global', slotRanks: [] },
      currentInput: 'rain',
      contributions: [
        {
          id: 'setting-entry',
          sourceRef: { kind: 'settingLayer', sourceId: 'setting-1', sourceNodeId: 'setting' },
          content: 'Stable setting.',
          capabilities: {
            projection: { zoneId: 'setting.stable', entryOrderHint: 0 },
          },
        },
        {
          id: 'preset-entry',
          sourceRef: { kind: 'preset', sourceId: 'preset-1', sourceNodeId: 'system' },
          content: 'Preset instruction.',
          capabilities: {
            projection: { zoneId: 'preset.system', entryOrderHint: 0 },
          },
        },
        {
          id: 'inactive-entry',
          sourceRef: { kind: 'settingLayer', sourceId: 'setting-1', sourceNodeId: 'setting' },
          content: 'Only when snow.',
          capabilities: {
            projection: { zoneId: 'setting.stable', entryOrderHint: 1 },
            activation: { kind: 'keyword', keywords: ['snow'] },
          },
        },
      ],
      buildId: 'build-test',
      runId: 'run-test',
      agentSessionId: 'agent-session-test',
    })

    expect(result.projection.messages).toEqual([
      { role: 'system', content: 'Preset instruction.' },
      { role: 'system', content: 'Stable setting.' },
    ])
    expect(result.projection.editorProjection.sourceRows).toEqual([
      expect.objectContaining({ fragmentId: 'preset-entry', active: true }),
      expect.objectContaining({ fragmentId: 'setting-entry', active: true }),
      expect.objectContaining({ fragmentId: 'inactive-entry', active: false }),
    ])
    expect(result.trace.status).toBe('ok')
    expect(result.trace.buildId).toBe('build-test')
    expect(result.trace.executions.map(execution => execution.passName)).toEqual([
      'prompt.materialize',
      'prompt.order',
      'prompt.emit',
    ])
    expect(result.trace.messageFragmentCount).toBe(2)
    expect(JSON.stringify(result.trace)).not.toContain('Stable setting.')
  })

  it('keeps the canonical projection compatible with the existing compiler for a basic build', () => {
    const input = {
      skeleton: defaultCompositionSkeleton,
      sourceNodes: [
        { id: 'root', sourceId: 'preset-1', parentId: null, displayName: 'Preset', orderIndex: 0 },
      ],
      orderProfile: { id: 'profile.test', scope: 'global' as const, slotRanks: [] },
      currentInput: 'hello',
      contributions: [{
        id: 'preset-entry',
        sourceRef: { kind: 'preset' as const, sourceId: 'preset-1', sourceNodeId: 'root' },
        content: 'Preset instruction.',
        capabilities: { projection: { zoneId: 'preset.system' } },
      }],
    }

    expect(compilePromptWithCore(input).projection).toEqual(compilePromptDataModel(input))
  })
})
