import { describe, expect, it, vi } from 'vitest'
import type { ExtensionHostOptions } from '@loom-studio/extension-host'
import { createExtensionFixture, createExtensionHostHarness } from './helpers.js'

const contribution = {
  id: 'example.state.character-status',
  entityTypes: [],
  templates: [{
    id: 'example.state.character-status',
    templateVersion: 1,
    componentKey: 'status',
    targetEntityTypeIds: ['character'],
    schema: { type: 'object' },
    initial: {},
  }],
  entities: [],
  componentMounts: [{
    templateId: 'example.state.character-status',
    templateVersion: 1,
    componentKey: 'status',
    target: { kind: 'entity-type', typeId: 'character' },
  }],
  bindings: [],
}

function fixture(capabilities: Record<string, boolean>, id = contribution.id, accessState = false) {
  return createExtensionFixture(`state-${Object.keys(capabilities).join('-')}-${id}`, {
    manifest: {
      manifestVersion: 2,
      id: 'example.state',
      version: '1.2.3',
      displayName: 'State Extension',
      engines: { studio: '^0.1.0' },
      modules: [{ id: 'server', runtime: 'server', entry: './dist/index.js', capabilities }],
    },
    source: `export async function activate(ctx) {
      ctx.state.contribute(${JSON.stringify({ ...contribution, id })});
      ${accessState ? `
      await ctx.state.read({ scope: 'global' });
      await ctx.state.write({ target: { scope: 'global' }, expectedRevisionId: 'revision-1', operations: [] });` : ''}
    }`,
  })
}

describe('Extension State contribution contract', () => {
  it('attributes contribution ownership and disposes the registration with the Extension scope', async () => {
    const dispose = vi.fn()
    const registerStateContribution = vi.fn<NonNullable<ExtensionHostOptions['registerStateContribution']>>(() => ({ dispose }))
    const { extensionHost } = createExtensionHostHarness({ registerStateContribution })
    await extensionHost.discover(fixture({ 'state.contribute': true }))
    await extensionHost.activate('example.state', 'server')

    expect(registerStateContribution).toHaveBeenCalledWith(
      expect.objectContaining({ id: contribution.id }),
      expect.objectContaining({ packageId: 'example.state', moduleId: 'server', packageVersion: '1.2.3' }),
    )
    await extensionHost.dispose('example.state', 'server')
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('rejects missing capability and foreign contribution ids', async () => {
    for (const directory of [fixture({ 'state.contribute': false }), fixture({ 'state.contribute': true }, 'another.package.status')]) {
      const registerStateContribution = vi.fn(() => ({ dispose() {} }))
      const { extensionHost } = createExtensionHostHarness({ registerStateContribution })
      await extensionHost.discover(directory)
      await expect(extensionHost.activate('example.state', 'server')).resolves.toMatchObject({ instance: { state: 'activation_failed' } })
      expect(registerStateContribution).not.toHaveBeenCalled()
    }
  })

  it('forwards capability-gated runtime reads and writes without exposing the Store', async () => {
    const readState = vi.fn<NonNullable<ExtensionHostOptions['readState']>>(async target => ({ scopeId: 'scope-1', target, revisionId: 'revision-1', value: {}, createdAt: 'now' }))
    const writeState = vi.fn<NonNullable<ExtensionHostOptions['writeState']>>(async input => ({ snapshot: { scopeId: 'scope-1', target: input.target, revisionId: 'revision-2', value: {}, createdAt: 'now' }, changesetId: 'changeset-1' }))
    const { extensionHost } = createExtensionHostHarness({ registerStateContribution: () => ({ dispose() {} }), readState, writeState })
    await extensionHost.discover(fixture({ 'state.contribute': true, 'state.read': true, 'state.write': true }, contribution.id, true))
    await expect(extensionHost.activate('example.state', 'server')).resolves.toMatchObject({ instance: { state: 'active' } })
    expect(readState).toHaveBeenCalledWith({ scope: 'global' }, expect.objectContaining({ packageId: 'example.state' }))
    expect(writeState).toHaveBeenCalledWith(expect.objectContaining({ expectedRevisionId: 'revision-1' }), expect.objectContaining({ packageId: 'example.state' }))
  })
})
