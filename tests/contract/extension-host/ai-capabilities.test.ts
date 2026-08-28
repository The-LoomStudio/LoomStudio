import { createAiGatewayCapabilityRegistry, createProfiledAiGateway } from '@loom-studio/ai-gateway'
import { describe, expect, it } from 'vitest'
import { createExtensionFixture, createExtensionHostHarness } from './helpers.js'

describe('Extension AI Gateway capabilities', () => {
  it('registers on activation and unregisters on dispose', async () => {
    const aiCapabilities = createAiGatewayCapabilityRegistry()
    const { extensionHost } = createExtensionHostHarness({ aiCapabilities })
    const directory = createExtensionFixture('ai-capability-provider', {
      manifest: {
        manifestVersion: 2,
        id: 'example.ai',
        version: '0.0.0',
        displayName: 'AI Capability Provider',
        engines: { studio: '^0.1.0' },
        modules: [{
          id: 'server',
          runtime: 'server',
          entry: './dist/index.js',
          contributes: { aiProviders: [{ id: 'example.ai.echo' }] },
        }],
      },
      source: `export async function activate(ctx) {
        ctx.ai.registerProvider({
          provider: {
            id: 'example.ai.echo',
            displayName: 'Extension Echo',
            capabilities: [{
              id: 'text.generate',
              displayName: 'Text Generation',
              inputFields: [{ key: 'text', label: 'Text', type: 'string', required: true }],
            }],
          },
          handlers: {
            'text.generate': ({ input }) => ({ text: 'Extension: ' + input.text }),
          },
        })
      }`,
    })

    await extensionHost.discover(directory)
    await extensionHost.activate('example.ai', 'server')
    expect(aiCapabilities.list().map(provider => provider.id)).toEqual(['example.ai.echo'])
    await expect(aiCapabilities.invokeRegistered({
      providerId: 'example.ai.echo',
      capabilityId: 'text.generate',
      accountConfig: {},
      profileConfig: {},
      input: { text: 'hello' },
    })).resolves.toMatchObject({ output: { text: 'Extension: hello' } })

    await extensionHost.dispose('example.ai', 'server')
    expect(aiCapabilities.list()).toEqual([])
  })

  it('aborts an in-flight provider call before unregistering on dispose', async () => {
    const aiCapabilities = createAiGatewayCapabilityRegistry()
    const { extensionHost } = createExtensionHostHarness({ aiCapabilities })
    const directory = createExtensionFixture('ai-capability-lifecycle', {
      manifest: {
        manifestVersion: 2,
        id: 'example.ai-lifecycle',
        version: '0.0.0',
        displayName: 'AI Capability Lifecycle',
        engines: { studio: '^0.1.0' },
        modules: [{
          id: 'server',
          runtime: 'server',
          entry: './dist/index.js',
          contributes: { aiProviders: [{ id: 'example.ai-lifecycle.wait' }] },
        }],
      },
      source: `export async function activate(ctx) {
        ctx.ai.registerProvider({
          provider: {
            id: 'example.ai-lifecycle.wait',
            displayName: 'Wait Provider',
            capabilities: [{ id: 'test.wait', displayName: 'Wait' }],
          },
          handlers: {
            'test.wait': ({ signal }) => new Promise(resolve => {
              signal.addEventListener('abort', () => resolve({ aborted: true }), { once: true })
            }),
          },
        })
      }`,
    })

    await extensionHost.discover(directory)
    await extensionHost.activate('example.ai-lifecycle', 'server')
    const invocation = aiCapabilities.invokeRegistered({
      providerId: 'example.ai-lifecycle.wait',
      capabilityId: 'test.wait',
      accountConfig: {},
      profileConfig: {},
      input: {},
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    await extensionHost.dispose('example.ai-lifecycle', 'server')

    await expect(invocation).resolves.toMatchObject({ output: { aborted: true } })
    expect(aiCapabilities.list()).toEqual([])
  })

  it('routes extension invocation through a profile-backed gateway', async () => {
    const aiCapabilities = createAiGatewayCapabilityRegistry()
    const aiGateway = createProfiledAiGateway({
      registry: aiCapabilities,
      resolveProfile: async profileId => ({
        profileId,
        providerProfileId: 'provider-profile-1',
        providerId: 'example.ai-profiled.echo',
        capabilityId: 'text.generate',
        accountConfig: { endpoint: 'https://provider.test' },
        profileConfig: { prefix: 'Profiled' },
      }),
      credentials: {
        withCredential: async (_profile, operation) => await operation({ apiKey: 'secret-value' }),
      },
    })
    const { extensionHost, kernel } = createExtensionHostHarness({ aiCapabilities, aiGateway })
    const providerDirectory = createExtensionFixture('ai-profiled-provider', {
      manifest: {
        manifestVersion: 2,
        id: 'example.ai-profiled',
        version: '0.0.0',
        displayName: 'Profiled Provider',
        engines: { studio: '^0.1.0' },
        modules: [{
          id: 'server',
          runtime: 'server',
          entry: './dist/index.js',
          contributes: { aiProviders: [{ id: 'example.ai-profiled.echo' }] },
        }],
      },
      source: `export async function activate(ctx) {
        ctx.ai.registerProvider({
          provider: {
            id: 'example.ai-profiled.echo',
            displayName: 'Profiled Echo',
            accountFields: [{ key: 'endpoint', label: 'Endpoint', type: 'string', required: true }],
            credentialFields: [{ key: 'apiKey', label: 'API Key', type: 'secret', required: true }],
            capabilities: [{
              id: 'text.generate',
              displayName: 'Text Generation',
              profileFields: [{ key: 'prefix', label: 'Prefix', type: 'string', required: true }],
              inputFields: [{ key: 'text', label: 'Text', type: 'string', required: true }],
            }],
          },
          handlers: {
            'text.generate': ({ accountConfig, credential, profileConfig, input }) => ({
              text: profileConfig.prefix + ': ' + input.text,
              endpoint: accountConfig.endpoint,
              authorized: credential.apiKey === 'secret-value',
            }),
          },
        })
      }`,
    })
    const consumerDirectory = createExtensionFixture('ai-profiled-consumer', {
      manifest: {
        manifestVersion: 2,
        id: 'example.ai-consumer',
        version: '0.0.0',
        displayName: 'AI Consumer',
        engines: { studio: '^0.1.0' },
        modules: [{
          id: 'server',
          runtime: 'server',
          entry: './dist/index.js',
          capabilities: { 'ai.invoke': true },
          contributes: { rpc: [{ name: 'example.ai-consumer.invoke' }] },
        }],
      },
      source: `export async function activate(ctx) {
        ctx.rpc.register('example.ai-consumer.invoke', params => ctx.ai.invoke({
          profileId: 'capability-profile-1',
          input: params,
        }))
      }`,
    })

    await extensionHost.discover(providerDirectory)
    await extensionHost.discover(consumerDirectory)
    await extensionHost.activate('example.ai-profiled', 'server')
    await extensionHost.activate('example.ai-consumer', 'server')

    await expect(kernel.callRpc('example.ai-consumer.invoke', { text: 'hello' })).resolves.toMatchObject({
      profileId: 'capability-profile-1',
      output: {
        text: 'Profiled: hello',
        endpoint: 'https://provider.test',
        authorized: true,
      },
    })
  })
})
