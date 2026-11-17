import { describe, expect, it, vi } from 'vitest'
import type { ExtensionHostOptions } from '@loom-studio/kernel/extension-host'
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
  it('requires all content-processing grants and stops handlers when their installation is disposed', async () => {
    const source = `export function activate(ctx) {
      ctx.state.registerContentHandler({
        id: 'example.state/mvu', contributionId: 'example.state.data', path: '/data',
        process: async ({ value, signal }) => {
          signal.throwIfAborted();
          return { value };
        }
      });
    }`
    const registerStateContentHandler = vi.fn<NonNullable<ExtensionHostOptions['registerStateContentHandler']>>(() => ({ dispose() {} }))
    const harness = createExtensionHostHarness({ registerStateContentHandler })
    const directory = createExtensionFixture('state-content-grants', {
      source,
      manifest: {
        manifestVersion: 2, id: 'example.state', version: '1.0.0', displayName: 'Content',
        engines: { studio: '^0.1.0' }, modules: [{
          id: 'server', runtime: 'server', entry: './dist/index.js',
          capabilities: { 'state.processContent': true, 'state.read': true, 'state.write': true },
        }],
      },
    })
    await harness.extensionHost.discover(directory)
    await expect(harness.extensionHost.activate('example.state', 'server')).resolves.toMatchObject({ instance: { state: 'active' } })
    const handler = registerStateContentHandler.mock.calls[0]![0]
    await expect(handler.process({ text: 'body', value: { hp: 1 }, signal: new AbortController().signal })).resolves.toEqual({ value: { hp: 1 } })
    await harness.extensionHost.dispose('example.state', 'server')
    await expect(handler.process({ text: 'body', value: {}, signal: new AbortController().signal })).rejects.toThrow()

    const denied = createExtensionHostHarness({ registerStateContentHandler: vi.fn(() => ({ dispose() {} })) })
    await denied.extensionHost.discover(createExtensionFixture('state-content-denied', {
      source,
      manifest: {
        manifestVersion: 2, id: 'example.state', version: '1.0.0', displayName: 'Content',
        engines: { studio: '^0.1.0' }, modules: [{
          id: 'server', runtime: 'server', entry: './dist/index.js',
          capabilities: { 'state.processContent': true, 'state.read': true },
        }],
      },
    }))
    await expect(denied.extensionHost.activate('example.state', 'server')).resolves.toMatchObject({ instance: { state: 'activation_failed' } })
  })

  it('attributes contribution ownership and disposes the registration with the Extension scope', async () => {
    const dispose = vi.fn()
    const registerStateContribution = vi.fn<NonNullable<ExtensionHostOptions['registerStateContribution']>>(() => ({ dispose }))
    const { extensionHost } = createExtensionHostHarness({ registerStateContribution })
    await extensionHost.discover(fixture({ 'state.contribute': true }))
    await extensionHost.activate('example.state', 'server')

    expect(registerStateContribution).toHaveBeenCalledWith(
      expect.objectContaining({ id: contribution.id }),
      expect.objectContaining({ packageId: 'example.state', moduleId: 'server', packageVersion: '1.2.3' }),
      undefined,
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
