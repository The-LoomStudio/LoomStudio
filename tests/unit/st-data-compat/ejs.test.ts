import { describe, expect, it } from 'vitest'
import { ejsProcessor } from '../../../extensions/st-data-compat/src/runtime/ejs.js'
import type { ExtensionPromptEntry } from '@loom-studio/extension-sdk'
import { convertSillyTavernLorebook } from '../../../extensions/st-data-compat/src/normalizer/lorebook.js'
import { evaluatePromptActivation, isPromptActivation } from '../../../packages/application-runtime/src/prompt/prompt-activation.js'

const entry = (id: string, content: string, label = id): ExtensionPromptEntry => ({
  id, sourceId: 'world', sourceLabel: 'World', sourceNodeId: id, kind: 'lore', label, content,
})
const context = () => ({
  mode: 'runtime' as const, signal: new AbortController().signal,
  timeline: { timelineId: 't', branchId: 'b', revisionId: 'r', value: {
    mvu: {
      stat_data: { hp: 10 }, schema: {}, initialized_lorebooks: {},
    },
  } },
})

describe('isolated EJS data compatibility', () => {
  it('keeps empty-key Lore dormant while allowing explicit EJS activation and suppressing initvar', async () => {
    const nodes = convertSillyTavernLorebook({ entries: [
      { comment: 'Dormant', keys: [], content: 'Dormant text' },
      { comment: 'Forced', keys: [], content: 'Forced text' },
      { comment: 'Directive', keys: [], content: '@@activate\nDirective text' },
      { comment: '[initvar]', keys: [], content: 'hp: 10' },
      { comment: '[Preprocessing]', constant: true, content: '<% await activewi("Forced", true); %>' },
    ] }).artifact.rootNode.children!
    expect(nodes.every(node => isPromptActivation(node.capabilities?.activation))).toBe(true)
    expect(nodes.every(node => node.enabled)).toBe(true)
    expect(nodes.slice(0, 4).map(node => evaluatePromptActivation({ activation: node.capabilities?.activation }).active))
      .toEqual([false, false, false, false])
    expect(evaluatePromptActivation({ activation: nodes[4]!.capabilities?.activation }).active).toBe(true)
    const session = await ejsProcessor.create(context())
    try {
      const patches = await session.prepare!(nodes.map(node => entry(node.id, node.body!, node.label)))
      expect(patches).not.toContainEqual({ id: nodes[0]!.id, active: true })
      expect(patches).toContainEqual({ id: nodes[1]!.id, active: true })
      expect(patches).toContainEqual({ id: nodes[2]!.id, active: true })
      expect(patches).toContainEqual({ id: nodes[3]!.id, active: false })
    } finally { await session.dispose?.() }
  })

  it('renders escaped/raw expressions, print, async code and latest MVU reads', async () => {
    const session = await ejsProcessor.create(context())
    try {
      const value = await session.render(entry('text',
        '<% const hp = getvar("stat_data.hp"); print(await Promise.resolve(hp)); %>|<%= "<b>" %>|<%- "<b>" %>'))
      expect(value).toBe('10|&lt;b&gt;|<b>')
      expect(await session.render(entry('macro', '{{get_message_variable::stat_data}}'))).toBe('{\n  "hp": 10\n}')
    } finally { await session.dispose?.() }
  })

  it('prepares controller activation and conditions once, without persisting guest changes', async () => {
    const ctx = context()
    const session = await ejsProcessor.create(ctx)
    try {
      const controller = entry('controller', '<% globalThis.runs = (globalThis.runs || 0) + 1; await activewi("Target", true); %><%- runs %>', '[Preprocessing]')
      const patches = await session.prepare!([controller, entry('target', '<%- getvar("stat_data.hp") %>', 'Target'),
        entry('excluded', '@@if getvar("stat_data.hp") < 0\nNever')])
      expect(patches).toContainEqual({ id: 'target', active: true })
      expect(patches).toContainEqual({ id: 'excluded', active: false })
      expect(await session.render(controller)).toBe('1')
      expect(await session.render(entry('read', '<%- runs %>'))).toBe('1')
      expect(ctx.timeline.value.mvu.stat_data.hp).toBe(10)
    } finally { await session.dispose?.() }
  })

  it('rejects historical APIs, host access, unsupported decorators and unbounded code', async () => {
    const session = await ejsProcessor.create(context())
    try {
      await expect(session.render(entry('history', '<%- getVariables({message_id: 1}) %>'))).rejects.toThrow('historical')
      await expect(session.render(entry('host', '<%- process.env.HOME %>'))).rejects.toThrow('process')
      await expect(session.prepare!([entry('directive', '@@inject x\nText')])).rejects.toThrow('Unsupported')
      await expect(session.render(entry('loop', '<% while(true) {} %>'))).rejects.toThrow()
    } finally { await session.dispose?.() }
  })

  it('keeps State macro output as data instead of compiling it as EJS', async () => {
    const ctx = context()
    const payload = '<% throw Error("model text was executed") %>'
    Object.assign(ctx.timeline.value.mvu.stat_data, { payload })
    const session = await ejsProcessor.create(ctx)
    try {
      expect(await session.render(entry('macro', '{{get_message_variable::stat_data.payload}}'))).toBe(payload)
    } finally { await session.dispose?.() }
  })
})
