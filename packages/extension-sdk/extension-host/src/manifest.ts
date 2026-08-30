import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type {
  ExtensionManifest,
  ExtensionModuleManifest,
  ExtensionPromptResourceContribution,
} from '@loom-studio/extension-sdk'
import {
  extensionStorageTokenPattern,
  studioReservedNamespaces,
} from './types.js'

export const rendererSurfaces = [
  'shell.background',
  'narrative.entry.inline',
  'narrative.timeline.tail',
  'agent.message.inline',
  'agent.session.tail',
  'composer.sheet',
  'shell.workspace-panel',
  'shell.focus-surface',
  'standalone.page',
] as const

export const rendererScopes = ['workspace', 'timeline', 'agent-session', 'node', 'message'] as const

export const clientActionSurfaces = ['composer.quick-actions', 'extension.workbench.actions'] as const

export const clientHostIcons = ['image', 'refresh', 'settings', 'sparkles'] as const

export const rendererSurfaceScopes: Record<(typeof rendererSurfaces)[number], readonly (typeof rendererScopes)[number][]> = {
  'shell.background': ['workspace'],
  'narrative.entry.inline': ['node'],
  'narrative.timeline.tail': ['timeline'],
  'agent.message.inline': ['message'],
  'agent.session.tail': ['agent-session'],
  'composer.sheet': ['workspace', 'timeline', 'agent-session'],
  'shell.workspace-panel': ['workspace'],
  'shell.focus-surface': ['workspace', 'timeline', 'agent-session'],
  'standalone.page': ['workspace', 'timeline', 'agent-session'],
}

export function parseExtensionManifest(value: unknown): ExtensionManifest {
  if (!isRecord(value)) throw new Error('Manifest must be an object')
  const manifest = value as Partial<ExtensionManifest>
  validateManifest(manifest)
  return manifest as ExtensionManifest
}

export function readManifest(directory: string): ExtensionManifest {
  const manifestPath = resolve(directory, 'manifest.json')
  if (!existsSync(manifestPath)) throw new Error(`Manifest not found: ${manifestPath}`)
  return parseExtensionManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))
}

export function validateManifest(manifest: Partial<ExtensionManifest>): void {
  if (manifest.manifestVersion !== 2) throw new Error('manifestVersion must be 2')
  if (!manifest.id) throw new Error('Manifest id is required')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(manifest.id)) throw new Error('Manifest id is invalid')
  if (studioReservedNamespaces.includes(manifest.id.split('.')[0] ?? '')) throw new Error(`Manifest id uses a reserved Studio namespace: ${manifest.id}`)
  if (!manifest.version) throw new Error('Manifest version is required')
  if (!manifest.displayName) throw new Error('Manifest displayName is required')
  if ('roles' in manifest) throw new Error('Manifest roles is obsolete; use tags')
  assertOptionalManifestText(manifest.description, 'description', 4_096)
  assertOptionalManifestText(manifest.author, 'author', 255)
  assertOptionalManifestUrl(manifest.homepage, 'homepage')
  assertOptionalManifestUrl(manifest.repository, 'repository')
  if (manifest.icon !== undefined) {
    assertOptionalManifestText(manifest.icon, 'icon', 1_024)
    if (isAbsolute(manifest.icon)) throw new Error('Manifest icon must be relative to the Package directory')
    if (!/\.(png|jpe?g|webp|gif)$/i.test(manifest.icon)) {
      throw new Error('Manifest icon must be PNG, JPEG, WebP, or GIF')
    }
  }
  if (manifest.tags !== undefined) {
    if (!Array.isArray(manifest.tags) || manifest.tags.length > 32) throw new Error('Manifest tags must be an array with at most 32 entries')
    const tags = new Set<string>()
    for (const tag of manifest.tags) {
      if (typeof tag !== 'string' || tag.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(tag)) {
        throw new Error(`Manifest tag is invalid: ${String(tag)}`)
      }
      if (tags.has(tag)) throw new Error(`Manifest tag must be unique: ${tag}`)
      tags.add(tag)
    }
  }
  if (!manifest.engines?.studio) throw new Error('engines.studio is required')
  const promptResources = new Map<string, ExtensionPromptResourceContribution>()
  for (const resource of manifest.contributes?.promptResources ?? []) {
    if (!resource.id || !extensionStorageTokenPattern.test(resource.id)) throw new Error(`Manifest Prompt Resource id is invalid: ${resource.id}`)
    if (promptResources.has(resource.id)) throw new Error(`Manifest Prompt Resource id must be unique: ${resource.id}`)
    assertPackageJsonSource(resource.source, `Prompt Resource ${resource.id}`)
    promptResources.set(resource.id, resource)
  }
  const agentTools = new Set<string>()
  for (const tool of manifest.contributes?.agentTools ?? []) {
    if (!tool.id.startsWith(`${manifest.id}/`) || !extensionStorageTokenPattern.test(tool.id.slice(manifest.id.length + 1))) {
      throw new Error(`Manifest Agent Tool must use package namespace: ${tool.id}`)
    }
    if (agentTools.has(tool.id)) throw new Error(`Manifest Agent Tool id must be unique: ${tool.id}`)
    assertPackageJsonSource(tool.source, `Agent Tool ${tool.id}`)
    agentTools.add(tool.id)
  }
  for (const resource of promptResources.values()) {
    if ((resource.settingMounts?.length || resource.toolMounts?.length) && resource.resourceKind !== 'preset') {
      throw new Error(`Manifest Prompt Resource mounts require a Preset: ${resource.id}`)
    }
    const settingMounts = new Set<string>()
    for (const mount of resource.settingMounts ?? []) {
      const setting = promptResources.get(mount.resourceId)
      if (!setting || setting.resourceKind !== 'setting') throw new Error(`Manifest Preset references an undeclared Setting: ${mount.resourceId}`)
      if (settingMounts.has(mount.resourceId)) throw new Error(`Manifest Preset Setting mount must be unique: ${mount.resourceId}`)
      if (mount.orderIndex !== undefined && (!Number.isInteger(mount.orderIndex) || mount.orderIndex < 0)) throw new Error(`Manifest Preset Setting order is invalid: ${mount.resourceId}`)
      settingMounts.add(mount.resourceId)
    }
    const toolMounts = new Set<string>()
    for (const mount of resource.toolMounts ?? []) {
      if (!agentTools.has(mount.toolId)) throw new Error(`Manifest Preset references an undeclared Agent Tool: ${mount.toolId}`)
      if (toolMounts.has(mount.toolId)) throw new Error(`Manifest Preset Tool mount must be unique: ${mount.toolId}`)
      if (mount.orderIndex !== undefined && (!Number.isInteger(mount.orderIndex) || mount.orderIndex < 0)) throw new Error(`Manifest Preset Tool order is invalid: ${mount.toolId}`)
      if (mount.defaultEnabled !== undefined && typeof mount.defaultEnabled !== 'boolean') throw new Error(`Manifest Preset Tool enabled flag is invalid: ${mount.toolId}`)
      toolMounts.add(mount.toolId)
    }
  }
  const moduleIds = new Set<string>()
  for (const moduleManifest of manifest.modules ?? []) {
    if (!moduleManifest.id || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(moduleManifest.id)) throw new Error('Manifest module id is invalid')
    if (moduleIds.has(moduleManifest.id)) throw new Error(`Manifest module id must be unique: ${moduleManifest.id}`)
    moduleIds.add(moduleManifest.id)
    if (moduleManifest.runtime !== 'server' && moduleManifest.runtime !== 'client') throw new Error(`Manifest module runtime is invalid: ${moduleManifest.id}`)
    if (!moduleManifest.entry) throw new Error(`Manifest module entry is required: ${moduleManifest.id}`)
    for (const event of moduleManifest.contributes?.events ?? []) {
      if (!event.name.startsWith(`${manifest.id}.`)) throw new Error(`Manifest event must use package namespace: ${event.name}`)
      if (!Number.isInteger(event.version) || event.version < 1) throw new Error(`Manifest event version must be positive: ${event.name}`)
      if (event.visibility !== 'public' && event.visibility !== 'protected') {
        throw new Error(`Manifest event visibility must be public or protected: ${event.name}`)
      }
    }
    for (const rpc of moduleManifest.contributes?.rpc ?? []) {
      if (!rpc.name.startsWith(`${manifest.id}.`)) throw new Error(`Manifest RPC must use package namespace: ${rpc.name}`)
    }
    const documentTypes = new Set<string>()
    for (const documentType of moduleManifest.contributes?.documentTypes ?? []) {
      if (!documentType.type.startsWith(`${manifest.id}.`)) throw new Error(`Manifest document type must use package namespace: ${documentType.type}`)
      if (documentTypes.has(documentType.type)) throw new Error(`Manifest document type must be unique within a module: ${documentType.type}`)
      documentTypes.add(documentType.type)
    }
    const aiProviderIds = new Set<string>()
    for (const provider of moduleManifest.contributes?.aiProviders ?? []) {
      if (!provider.id.startsWith(`${manifest.id}.`)) throw new Error(`Manifest AI provider must use package namespace: ${provider.id}`)
      if (aiProviderIds.has(provider.id)) throw new Error(`Manifest AI provider must be unique within a module: ${provider.id}`)
      aiProviderIds.add(provider.id)
    }
    const agentToolHandlerIds = new Set<string>()
    for (const handler of moduleManifest.contributes?.agentToolHandlers ?? []) {
      if (moduleManifest.runtime !== 'server') throw new Error(`Manifest Agent Tool Handler requires a server module: ${handler.toolId}`)
      if (!agentTools.has(handler.toolId)) throw new Error(`Manifest Agent Tool Handler references an undeclared Agent Tool: ${handler.toolId}`)
      if (agentToolHandlerIds.has(handler.toolId)) throw new Error(`Manifest Agent Tool Handler must be unique within a module: ${handler.toolId}`)
      agentToolHandlerIds.add(handler.toolId)
    }
    const rendererIds = new Set<string>()
    for (const renderer of moduleManifest.contributes?.renderers ?? []) {
      if (moduleManifest.runtime !== 'client') throw new Error(`Manifest Renderer requires a client module: ${renderer.id}`)
      if (!renderer.id || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(renderer.id)) throw new Error(`Manifest Renderer id is invalid: ${renderer.id}`)
      if (rendererIds.has(renderer.id)) throw new Error(`Manifest Renderer id must be unique within a module: ${renderer.id}`)
      rendererIds.add(renderer.id)
      assertOptionalManifestText(renderer.name, `Renderer name (${renderer.id})`, 255)
      if (!rendererSurfaces.includes(renderer.surface)) throw new Error(`Manifest Renderer surface is invalid: ${renderer.id}`)
      if (!rendererScopes.includes(renderer.instanceScope)) throw new Error(`Manifest Renderer instanceScope is invalid: ${renderer.id}`)
      if (!rendererSurfaceScopes[renderer.surface].includes(renderer.instanceScope)) {
        throw new Error(`Manifest Renderer scope does not match surface: ${renderer.id}`)
      }
      if (renderer.suggestedOrder !== undefined && (!Number.isInteger(renderer.suggestedOrder) || Math.abs(renderer.suggestedOrder) > 1_000_000)) {
        throw new Error(`Manifest Renderer suggestedOrder is invalid: ${renderer.id}`)
      }
      if (renderer.artifactType !== undefined) assertOptionalManifestText(renderer.artifactType, `Renderer artifactType (${renderer.id})`, 255)
      if (renderer.fallback !== undefined && renderer.fallback !== 'json' && renderer.fallback !== 'text' && renderer.fallback !== 'hidden') {
        throw new Error(`Manifest Renderer fallback is invalid: ${renderer.id}`)
      }
      if (renderer.adapter !== undefined && renderer.adapter !== 'direct' && renderer.adapter !== 'shadow' && renderer.adapter !== 'sandbox-iframe') {
        throw new Error(`Manifest Renderer adapter is invalid: ${renderer.id}`)
      }
    }
    const commandIds = new Set<string>()
    for (const command of moduleManifest.contributes?.commands ?? []) {
      if (moduleManifest.runtime !== 'client') throw new Error(`Manifest Client Command requires a client module: ${command.id}`)
      if (!command.id || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(command.id)) throw new Error(`Manifest Client Command id is invalid: ${command.id}`)
      if (commandIds.has(command.id)) throw new Error(`Manifest Client Command id must be unique within a module: ${command.id}`)
      commandIds.add(command.id)
      if (typeof command.title !== 'string') throw new Error(`Manifest Client Command title is required: ${command.id}`)
      assertOptionalManifestText(command.title, `Client Command title (${command.id})`, 255)
      if (command.icon !== undefined && !clientHostIcons.includes(command.icon)) {
        throw new Error(`Manifest Client Command icon is invalid: ${command.id}`)
      }
    }
    const actionKeys = new Set<string>()
    for (const action of moduleManifest.contributes?.actions ?? []) {
      if (moduleManifest.runtime !== 'client') throw new Error(`Manifest Client Action requires a client module: ${action.commandId}`)
      if (!commandIds.has(action.commandId)) throw new Error(`Manifest Client Action references an undeclared Command: ${action.commandId}`)
      if (!clientActionSurfaces.includes(action.surface)) throw new Error(`Manifest Client Action surface is invalid: ${action.commandId}`)
      if (action.group !== undefined) assertOptionalManifestText(action.group, `Client Action group (${action.commandId})`, 64)
      if (action.suggestedOrder !== undefined && (!Number.isInteger(action.suggestedOrder) || Math.abs(action.suggestedOrder) > 1_000_000)) {
        throw new Error(`Manifest Client Action suggestedOrder is invalid: ${action.commandId}`)
      }
      if (action.when !== undefined) {
        if (typeof action.when !== 'object' || action.when === null
          || Object.keys(action.when).some(key => key !== 'active')
          || (action.when.active !== undefined && action.when.active !== 'timeline' && action.when.active !== 'agent-session')) {
          throw new Error(`Manifest Client Action condition is invalid: ${action.commandId}`)
        }
      }
      const actionKey = `${action.commandId}@${action.surface}@${action.group ?? ''}`
      if (actionKeys.has(actionKey)) throw new Error(`Manifest Client Action placement must be unique within a module: ${actionKey}`)
      actionKeys.add(actionKey)
    }
    const eventCapabilities = moduleManifest.capabilities?.['events.subscribe']
    if (eventCapabilities !== undefined && (!Array.isArray(eventCapabilities) || !eventCapabilities.every(value => typeof value === 'string'))) {
      throw new Error(`Module capabilities.events.subscribe must be a string array: ${moduleManifest.id}`)
    }
    for (const capability of ['assets.publish', 'assets.read', 'ai.invoke'] as const) {
      const requested = moduleManifest.capabilities?.[capability]
      if (requested !== undefined && typeof requested !== 'boolean') {
        throw new Error(`Module capabilities.${capability} must be a boolean: ${moduleManifest.id}`)
      }
    }
  }
  for (const rule of manifest.contributes?.transformRules ?? []) {
    assertPackageJsonSource(rule.source, 'Transform Rule')
  }
}

export function assertPackageJsonSource(source: unknown, label: string): asserts source is string {
  if (typeof source !== 'string' || !source.trim() || source !== source.trim() || source.includes('\0') || isAbsolute(source) || !source.toLowerCase().endsWith('.json')) {
    throw new Error(`Manifest ${label} source must be a relative JSON file`)
  }
}

export function assertOptionalManifestText(value: unknown, field: string, maxLength: number): void {
  if (value === undefined) return
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maxLength || value.includes('\0')) {
    throw new Error(`Manifest ${field} is invalid`)
  }
}

export function assertOptionalManifestUrl(value: unknown, field: string): void {
  if (value === undefined) return
  assertOptionalManifestText(value, field, 2_048)
  let parsed: URL
  try {
    parsed = new URL(value as string)
  } catch {
    throw new Error(`Manifest ${field} must be an absolute HTTP(S) URL`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Manifest ${field} must be an absolute HTTP(S) URL`)
  }
}

export function serverModules(manifest: ExtensionManifest): Array<ExtensionModuleManifest & { runtime: 'server' }> {
  return (manifest.modules ?? []).filter((moduleManifest): moduleManifest is ExtensionModuleManifest & { runtime: 'server' } => (
    moduleManifest.runtime === 'server'
  ))
}

export function contributionCounts(manifest: ExtensionModuleManifest): { rpc: number; documentTypes: number; events: number; aiProviders: number; agentToolHandlers: number } {
  return {
    rpc: manifest.contributes?.rpc?.length ?? 0,
    documentTypes: manifest.contributes?.documentTypes?.length ?? 0,
    events: manifest.contributes?.events?.length ?? 0,
    aiProviders: manifest.contributes?.aiProviders?.length ?? 0,
    agentToolHandlers: manifest.contributes?.agentToolHandlers?.length ?? 0,
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
