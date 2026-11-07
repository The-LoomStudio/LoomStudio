import { extensionToolMountSchema } from '@loom-studio/shared'
import { rendererSurfaces, rendererInstanceScopes as rendererScopes, sharedStyleParameterDefinitions } from '@loom-studio/extension-sdk'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type {
  ExtensionManifest,
  ExtensionModuleManifest,
  ExtensionPromptResourceContribution,
  ExtensionSettingContribution,
  ExtensionTextExtractorContribution,
  ExtensionTextTransformRuleContribution,
} from '@loom-studio/extension-sdk'
import {
  extensionStorageTokenPattern,
  studioReservedNamespaces,
} from './types.js'
import { isRecord } from '@loom-studio/shared'

const clientActionSurfaces = ['composer.quick-actions', 'extension.workbench.actions', 'stage.header.actions'] as const

const clientHostIcons = ['image', 'refresh', 'settings', 'sparkles'] as const

const rendererSurfaceScopes: Record<(typeof rendererSurfaces)[number], readonly (typeof rendererScopes)[number][]> = {
  'shell.background': ['workspace'],
  'narrative.entry.inline': ['node'],
  'narrative.timeline.tail': ['timeline'],
  'memory.panel': ['timeline'],
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

/**
 * Validates extension package manifest against schema version 2.
 * Invariant: Enforces strict identifier patterns, reserved namespace protection, relative icon boundaries, and bounded tag sets.
 */
function validateManifest(manifest: Partial<ExtensionManifest>): void {
  if (manifest.manifestVersion !== 2) throw new Error('manifestVersion must be 2')
  if (!manifest.id) throw new Error('Manifest id is required')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(manifest.id)) throw new Error('Manifest id is invalid')
  if (studioReservedNamespaces.includes(manifest.id.split('.')[0] ?? '')) throw new Error(`Manifest id uses a reserved Studio namespace: ${manifest.id}`)
  if (!manifest.version) throw new Error('Manifest version is required')
  if (manifest.participation !== undefined && manifest.participation !== 'timeline') {
    throw new Error('Manifest participation must be timeline when declared')
  }
  if (!manifest.displayName) throw new Error('Manifest displayName is required')
  const publicUrl = (value: unknown): void => {
    if (typeof value !== 'string') throw new Error('Distribution URL must be a string')
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Distribution URL must be HTTPS without credentials or fragment')
  }
  if (manifest.distribution !== undefined) {
    const distribution = manifest.distribution
    if (!isRecord(distribution)) throw new Error('Manifest distribution must be an object')
    if (distribution.kind === 'git' || distribution.kind === 'url') {
      publicUrl(distribution.url)
      if (distribution.kind === 'git' && distribution.ref !== undefined && (typeof distribution.ref !== 'string' || !distribution.ref.trim())) throw new Error('Distribution ref must be non-empty')
    } else if (distribution.kind === 'release') {
      publicUrl(distribution.repository)
      if (distribution.provider !== 'github' || typeof distribution.asset !== 'string' || !distribution.asset.trim()) throw new Error('Release distribution requires github and an asset name')
    } else throw new Error('Unsupported distribution kind')
  }
  if (manifest.update !== undefined) {
    if (!isRecord(manifest.update)) throw new Error('Manifest update must be an object')
    publicUrl(manifest.update.manifestUrl)
  }
  if (manifest.dependencies !== undefined) {
    if (!Array.isArray(manifest.dependencies) || manifest.dependencies.length > 100) throw new Error('Manifest dependencies must be a bounded array')
    const ids = new Set<string>()
    for (const dependency of manifest.dependencies) {
      if (!isRecord(dependency) || typeof dependency.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(dependency.id)
        || dependency.id === manifest.id || ids.has(dependency.id)) throw new Error('Manifest dependency id is invalid or duplicated')
      ids.add(dependency.id)
      if (dependency.target !== undefined && dependency.target !== 'global' && dependency.target !== 'card') throw new Error('Manifest dependency target must be global or card')
      if (typeof dependency.version !== 'string' || !dependency.version.trim()) throw new Error('Manifest dependency version is required')
      if (dependency.source !== undefined) {
        const source = dependency.source
        if (!isRecord(source) || !['git', 'zip'].includes(String(source.kind)) || typeof source.url !== 'string') throw new Error('Manifest dependency source is invalid')
        const url = new URL(source.url)
        if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Manifest dependency source must be public HTTPS without credentials')
        if (source.kind === 'git' && source.ref !== undefined && (typeof source.ref !== 'string' || !source.ref.trim() || source.ref.startsWith('-'))) throw new Error('Manifest dependency Git ref is invalid')
      }
    }
  }
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
  const characters = manifest.contributes?.characters
  if (characters !== undefined) {
    if (!Array.isArray(characters) || characters.length > 100) throw new Error('Character catalog must be a bounded array')
    const ids = new Set<string>()
    for (const character of characters) {
      if (!isRecord(character) || typeof character.id !== 'string' || !extensionStorageTokenPattern.test(character.id) || ids.has(character.id)) throw new Error('Invalid or duplicate Character catalog id')
      ids.add(character.id)
      if (typeof character.name !== 'string' || !character.name.trim()) throw new Error('Character name is required')
      assertOptionalManifestText(character.description, 'Character description', 4096)
      for (const path of [character.source, ...(character.preview === undefined ? [] : [character.preview])]) {
        if (typeof path !== 'string' || !path.trim() || isAbsolute(path) || path.includes('\\') || path.includes('\0') || path.split('/').includes('..')) throw new Error('Character files must use safe relative package paths')
      }
      if (!character.source.endsWith('.zip')) throw new Error('Character source must be a Card Bundle ZIP')
    }
  }
  const promptResources = new Map<string, ExtensionPromptResourceContribution>()
  for (const resource of manifest.contributes?.promptResources ?? []) {
    if (!resource.id || !extensionStorageTokenPattern.test(resource.id)) throw new Error(`Manifest Prompt Resource id is invalid: ${resource.id}`)
    if (promptResources.has(resource.id)) throw new Error(`Manifest Prompt Resource id must be unique: ${resource.id}`)
    assertPackageJsonSource(resource.source, `Prompt Resource ${resource.id}`)
    promptResources.set(resource.id, resource)
  }
  validateTextResourceContributions(manifest.contributes?.transformRules, 'Text Transform Rule')
  validateTextResourceContributions(manifest.contributes?.textExtractors, 'Text Extractor')
  validateSettingContributions(manifest.contributes?.settings)
  validateStyleContributions(manifest)
  validateBackgroundContributions(manifest)
  const scripts = new Set<string>()
  for (const script of manifest.contributes?.loomScripts ?? []) {
    if (!script.id || !extensionStorageTokenPattern.test(script.id) || scripts.has(script.id)) throw new Error(`Manifest Loom Script id is invalid or duplicated: ${script.id}`)
    if (typeof script.source !== 'string' || !script.source.trim() || script.source !== script.source.trim()
      || script.source.includes('\0') || isAbsolute(script.source) || (!script.source.endsWith('.loom.js') && !script.source.endsWith('.md'))) {
      throw new Error(`Manifest Loom Script source must be a relative .loom.js or .md file: ${script.id}`)
    }
    if (script.orderIndex !== undefined && !Number.isSafeInteger(script.orderIndex) || script.groupOrder !== undefined && !Number.isSafeInteger(script.groupOrder)) throw new Error(`Invalid Script ordering: ${script.id}`)
    scripts.add(script.id)
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
    if ((resource.loreMounts?.length || resource.toolMounts?.length || resource.scriptMounts?.length) && resource.resourceKind !== 'preset') {
      throw new Error(`Manifest Prompt Resource mounts require a Preset: ${resource.id}`)
    }
    const mountedScripts = new Set<string>()
    for (const mount of resource.scriptMounts ?? []) {
      if (!scripts.has(mount.scriptId) || mountedScripts.has(mount.scriptId)) throw new Error(`Manifest Preset Script mount is unresolved or duplicated: ${mount.scriptId}`)
      if (mount.orderIndex !== undefined && (!Number.isInteger(mount.orderIndex) || mount.orderIndex < 0)) throw new Error(`Manifest Preset Script order is invalid: ${mount.scriptId}`)
      mountedScripts.add(mount.scriptId)
    }
    const loreMounts = new Set<string>()
    for (const mount of resource.loreMounts ?? []) {
      const reference = mount.reference ?? { kind: 'package' as const, contributionId: mount.resourceId }
      if (!isRecord(reference) || (mount.reference !== undefined && mount.resourceId !== undefined)) {
        throw new Error('Manifest Preset Lore reference is invalid')
      }
      let referenceKey: string
      if (reference.kind === 'package') {
        if (typeof reference.contributionId !== 'string') throw new Error('Manifest Preset Lore reference is invalid')
        const setting = promptResources.get(reference.contributionId)
        if (!setting || setting.resourceKind !== 'lore') throw new Error(`Manifest Preset references an undeclared Lore: ${reference.contributionId}`)
        referenceKey = JSON.stringify(['package', reference.contributionId])
      } else if (reference.kind === 'external') {
        if (typeof reference.resourceId !== 'string' || !reference.resourceId.trim()) {
          throw new Error('Manifest external Lore resource ID is invalid')
        }
        const source = reference.origin
        if (source !== undefined && (!isRecord(source)
          || typeof source.packageId !== 'string' || !source.packageId.trim()
          || typeof source.contributionId !== 'string' || !source.contributionId.trim()
          || (source.target !== 'global' && source.target !== 'card'))) {
          throw new Error('Manifest external Lore origin is invalid')
        }
        referenceKey = JSON.stringify(['external', reference.resourceId, source?.packageId, source?.contributionId, source?.target])
      } else {
        throw new Error('Manifest Preset Lore reference is invalid')
      }
      if (loreMounts.has(referenceKey)) throw new Error('Manifest Preset Lore mount must be unique')
      if (mount.orderIndex !== undefined && (!Number.isInteger(mount.orderIndex) || mount.orderIndex < 0)) throw new Error(`Manifest Preset Lore order is invalid: ${mount.resourceId}`)
      loreMounts.add(referenceKey)
    }
    const toolMounts = new Set<string>()
    for (const mount of resource.toolMounts ?? []) {
      const parsed = extensionToolMountSchema.parse(mount)
      const reference = parsed.reference ?? { kind: 'package' as const, contributionId: parsed.toolId! }
      if (reference.kind === 'package' && !agentTools.has(reference.contributionId)) throw new Error(`Manifest Preset references an undeclared Agent Tool: ${reference.contributionId}`)
      if (reference.kind === 'external' && !manifest.dependencies?.some(dependency => dependency.id === reference.packageId)) throw new Error(`External Agent Tool requires a declared dependency: ${reference.packageId}`)
      const key = JSON.stringify(reference)
      if (toolMounts.has(key)) throw new Error(`Manifest Preset Tool mount must be unique: ${key}`)
      toolMounts.add(key)
    }
  }
  const moduleIds = new Set<string>()
  for (const moduleManifest of manifest.modules ?? []) {
    if (!moduleManifest.id || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(moduleManifest.id)) throw new Error('Manifest module id is invalid')
    if (moduleIds.has(moduleManifest.id)) throw new Error(`Manifest module id must be unique: ${moduleManifest.id}`)
    moduleIds.add(moduleManifest.id)
    if (moduleManifest.runtime !== 'server' && moduleManifest.runtime !== 'client' && moduleManifest.runtime !== 'client-worker') throw new Error(`Manifest module runtime is invalid: ${moduleManifest.id}`)
    if (moduleManifest.runtime === 'client-worker' && Object.values(moduleManifest.contributes ?? {}).some(items => Array.isArray(items) && items.length)) {
      throw new Error(`Worker modules use runtime host APIs and cannot declare DOM or server contributions: ${moduleManifest.id}`)
    }
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
    for (const capability of ['assets.publish', 'assets.read', 'ai.invoke', 'macros.provide', 'prompt.process', 'narrative.context.provide', 'narrative.read', 'agent.tasks', 'vfs.provide', 'resources.provide', 'state.contribute', 'state.read', 'state.write', 'state.processContent', 'ui.notify'] as const) {
      const requested = moduleManifest.capabilities?.[capability]
      if (requested !== undefined && typeof requested !== 'boolean') {
        throw new Error(`Module capabilities.${capability} must be a boolean: ${moduleManifest.id}`)
      }
    }
  }
}

function validateBackgroundContributions(manifest: Partial<ExtensionManifest>): void {
  const backgrounds = manifest.contributes?.backgrounds
  if (backgrounds === undefined) return
  if (!Array.isArray(backgrounds)) throw new Error('Manifest backgrounds must be an array')
  if (backgrounds.length && manifest.participation === 'timeline') throw new Error('Timeline packages cannot contribute static backgrounds')
  const ids = new Set<string>()
  for (const background of backgrounds) {
    if (!isRecord(background) || typeof background.id !== 'string'
      || !extensionStorageTokenPattern.test(background.id) || ids.has(background.id)) {
      throw new Error('Manifest background id is invalid or duplicated')
    }
    ids.add(background.id)
    if (typeof background.name !== 'string' || typeof background.description !== 'string') throw new Error('Manifest background name and description are required')
    assertOptionalManifestText(background.name, 'background name', 255)
    assertOptionalManifestText(background.description, 'background description', 2_048)
    const image = background.image
    if (typeof image !== 'string' || image !== image.trim() || isAbsolute(image)
      // eslint-disable-next-line no-control-regex -- Control characters are intentionally rejected or encoded in paths and CSS values.
      || /[\\:%?#\x00-\x1f]/.test(image) || !/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(image)
      || image.replace(/^\.\//, '').split('/').some(part => part === '..' || part === '.' || part === '')) {
      throw new Error('Manifest background image must be a package-relative image file without traversal, query or hash')
    }
  }
}

function validateStyleContributions(manifest: Partial<ExtensionManifest>): void {
  const ids = new Set<string>()
  for (const kind of ['themes', 'styles'] as const) {
    const contributions = manifest.contributes?.[kind]
    if (contributions === undefined) continue
    if (!Array.isArray(contributions)) throw new Error(`Manifest ${kind} must be an array`)
    if (contributions.length && manifest.participation === 'timeline') throw new Error('Timeline packages cannot contribute global styles')
    for (const contribution of contributions) {
      if (!isRecord(contribution) || typeof contribution.id !== 'string' || !extensionStorageTokenPattern.test(contribution.id) || ids.has(contribution.id)) {
        throw new Error('Manifest style id is invalid or duplicated')
      }
      ids.add(contribution.id)
      if (typeof contribution.label !== 'string') throw new Error('Manifest style label is required')
      assertOptionalManifestText(contribution.label, 'style label', 255)
      assertOptionalManifestText(contribution.description, 'style description', 2_048)
      const css = contribution.css
      if (typeof css !== 'string' || css !== css.trim() || !css.endsWith('.css') || isAbsolute(css)
        // eslint-disable-next-line no-control-regex -- Control characters are intentionally rejected or encoded in paths and CSS values.
        || /[\\:%?#\x00-\x1f]/.test(css) || css.split('/').some(part => part === '..' || part === '')) {
        throw new Error('Manifest style css must be a package-relative CSS file without traversal, query or hash')
      }
      if (contribution.moduleId !== undefined && (typeof contribution.moduleId !== 'string'
        || !manifest.modules?.some(module => module.id === contribution.moduleId && module.runtime === 'client'))) {
        throw new Error('Manifest style moduleId must reference a client module')
      }
      if (contribution.supportsCssOnly !== undefined && (typeof contribution.supportsCssOnly !== 'boolean' || contribution.moduleId === undefined)) {
        throw new Error('Manifest style supportsCssOnly requires moduleId and a boolean value')
      }
      if (contribution.nativeMotion !== undefined && contribution.nativeMotion !== 'retain' && contribution.nativeMotion !== 'disable') {
        throw new Error('Manifest style nativeMotion is invalid')
      }
      if (contribution.previewColors !== undefined && (!Array.isArray(contribution.previewColors)
        || contribution.previewColors.length !== 3
        || !contribution.previewColors.every(color => typeof color === 'string' && color.length <= 128 && /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab)\([\d.,%+\-/\s]+\))$/i.test(color)))) {
        throw new Error('Manifest style previewColors must contain three literal CSS colors')
      }
      if (contribution.parameters === undefined) continue
      if (!Array.isArray(contribution.parameters)) throw new Error('Manifest style parameters must be an array')
      const parameterIds = new Set<string>()
      const variables = new Set<string>()
      for (const parameter of contribution.parameters) {
        if (!isRecord(parameter) || typeof parameter.id !== 'string' || !extensionStorageTokenPattern.test(parameter.id) || parameterIds.has(parameter.id)) {
          throw new Error('Manifest style parameter id is invalid or duplicated')
        }
        parameterIds.add(parameter.id)
        if (typeof parameter.label !== 'string') throw new Error('Manifest style parameter label is required')
        assertOptionalManifestText(parameter.label, 'style parameter label', 255)
        const variable = parameter.variable
        if (typeof variable !== 'string' || !/^--(?:loom|extension)-[A-Za-z0-9_-]+$/.test(variable)
          || /^--loom-.*(?:anchor|viewport|keyboard|scroll|drag|virtual)/i.test(variable) || variables.has(variable)) {
          throw new Error('Manifest style parameter variable is invalid, internal or duplicated')
        }
        variables.add(variable)
        const shared = sharedStyleParameterDefinitions[variable]
        if (shared && (parameter.type !== 'number' || (parameter.unit ?? '') !== shared.unit
          || typeof parameter.min !== 'number' || parameter.min < shared.min
          || typeof parameter.max !== 'number' || parameter.max > shared.max)) {
          throw new Error(`Manifest shared style parameter must use the host numeric unit and range: ${variable}`)
        }
        if (parameter.type === 'number') {
          if (typeof parameter.default !== 'number' || !Number.isFinite(parameter.default)
            || typeof parameter.min !== 'number' || !Number.isFinite(parameter.min)
            || typeof parameter.max !== 'number' || !Number.isFinite(parameter.max)
            || parameter.min > parameter.max || parameter.default < parameter.min || parameter.default > parameter.max
            || (parameter.step !== undefined && (typeof parameter.step !== 'number' || !Number.isFinite(parameter.step) || parameter.step <= 0))
            || (parameter.unit !== undefined && (typeof parameter.unit !== 'string' || !['', 'px', '%', 'rem', 'ms'].includes(parameter.unit)))) {
            throw new Error('Manifest style number parameter range, default, step or unit is invalid')
          }
        } else if (parameter.type === 'color') {
          assertStyleCssValue(parameter.default)
        } else if (parameter.type === 'select') {
          if (!Array.isArray(parameter.options) || !parameter.options.length) throw new Error('Manifest style select parameter requires options')
          const values = new Set<string>()
          for (const option of parameter.options) {
            if (!isRecord(option) || typeof option.label !== 'string') throw new Error('Manifest style option label is required')
            assertOptionalManifestText(option.label, 'style option label', 255)
            assertStyleCssValue(option.value)
            if (values.has(option.value)) throw new Error('Manifest style option value is duplicated')
            values.add(option.value)
          }
          if (typeof parameter.default !== 'string' || !values.has(parameter.default)) throw new Error('Manifest style default must reference an option')
        } else if (parameter.type === 'boolean') {
          if (typeof parameter.default !== 'boolean') throw new Error('Manifest style boolean default is invalid')
          assertStyleCssValue(parameter.trueValue)
          assertStyleCssValue(parameter.falseValue)
        } else {
          throw new Error('Manifest style parameter type is invalid')
        }
      }
    }
  }
}

function assertStyleCssValue(value: unknown): asserts value is string {
  // eslint-disable-next-line no-control-regex -- Control characters are intentionally rejected or encoded in paths and CSS values.
  if (typeof value !== 'string' || !value.trim() || value.length > 1_024 || /[;{}@\\\x00-\x1f]/.test(value)) {
    throw new Error('Manifest style parameter CSS value is invalid')
  }
}

function validateSettingContributions(settings: ExtensionSettingContribution[] | undefined): void {
  const ids = new Set<string>()
  for (const setting of settings ?? []) {
    const settingId = setting.id
    if (!setting.id || !extensionStorageTokenPattern.test(setting.id)) throw new Error(`Manifest Setting id is invalid: ${setting.id}`)
    if (ids.has(setting.id)) throw new Error(`Manifest Setting id must be unique: ${setting.id}`)
    ids.add(setting.id)
    if (typeof setting.label !== 'string') throw new Error(`Manifest Setting label is required: ${setting.id}`)
    assertOptionalManifestText(setting.label, `Setting label (${setting.id})`, 255)
    assertOptionalManifestText(setting.description, `Setting description (${setting.id})`, 2_048)
    assertOptionalManifestText(setting.group, `Setting group (${setting.id})`, 255)
    if (setting.suggestedOrder !== undefined && (!Number.isInteger(setting.suggestedOrder) || Math.abs(setting.suggestedOrder) > 1_000_000)) {
      throw new Error(`Manifest Setting suggestedOrder is invalid: ${setting.id}`)
    }
    if (setting.scope !== undefined && !['global', 'card', 'timeline', 'agent-session'].includes(setting.scope)) {
      throw new Error(`Manifest Setting scope is invalid: ${setting.id}`)
    }
    if (setting.readOnly !== undefined && typeof setting.readOnly !== 'boolean') throw new Error(`Manifest Setting readOnly flag is invalid: ${setting.id}`)
    if (setting.type === 'boolean') {
      if (typeof setting.default !== 'boolean') throw new Error(`Manifest Setting default must be boolean: ${settingId}`)
      continue
    }
    if (setting.type === 'text' || setting.type === 'multiline') {
      if (typeof setting.default !== 'string') throw new Error(`Manifest Setting default must be string: ${settingId}`)
      if (setting.placeholder !== undefined) assertOptionalManifestText(setting.placeholder, `Setting placeholder (${setting.id})`, 1_024)
      if (setting.required !== undefined && typeof setting.required !== 'boolean') throw new Error(`Manifest Setting required flag is invalid: ${setting.id}`)
      assertOptionalNonNegativeInteger(setting.minLength, `Manifest Setting minLength is invalid: ${setting.id}`)
      assertOptionalNonNegativeInteger(setting.maxLength, `Manifest Setting maxLength is invalid: ${setting.id}`)
      if (setting.minLength !== undefined && setting.maxLength !== undefined && setting.minLength > setting.maxLength) {
        throw new Error(`Manifest Setting length range is invalid: ${setting.id}`)
      }
      if (setting.default.length < (setting.minLength ?? 0) || (setting.maxLength !== undefined && setting.default.length > setting.maxLength)) {
        throw new Error(`Manifest Setting default length is invalid: ${setting.id}`)
      }
      if (setting.required && !setting.default.trim()) throw new Error(`Manifest Setting default is required: ${setting.id}`)
      continue
    }
    if (setting.type === 'number' || setting.type === 'range') {
      if (!Number.isFinite(setting.default)) throw new Error(`Manifest Setting default must be finite: ${setting.id}`)
      for (const [name, value] of [['min', setting.min], ['max', setting.max], ['step', setting.step]] as const) {
        if (value !== undefined && !Number.isFinite(value)) throw new Error(`Manifest Setting ${name} is invalid: ${setting.id}`)
      }
      if (setting.min !== undefined && setting.max !== undefined && setting.min > setting.max) throw new Error(`Manifest Setting number range is invalid: ${setting.id}`)
      if (setting.step !== undefined && setting.step <= 0) throw new Error(`Manifest Setting step is invalid: ${setting.id}`)
      if (setting.default < (setting.min ?? -Infinity) || setting.default > (setting.max ?? Infinity)) throw new Error(`Manifest Setting default range is invalid: ${setting.id}`)
      if (setting.type === 'range' && (setting.min === undefined || setting.max === undefined)) throw new Error(`Manifest range Setting requires min and max: ${setting.id}`)
      continue
    }
    if (setting.type === 'select') {
      if (typeof setting.default !== 'string') throw new Error(`Manifest Setting default must be string: ${settingId}`)
      if (!Array.isArray(setting.options) || setting.options.length === 0) throw new Error(`Manifest select Setting requires options: ${setting.id}`)
      const values = new Set<string>()
      for (const option of setting.options) {
        if (typeof option?.value !== 'string' || typeof option.label !== 'string') throw new Error(`Manifest Setting option is invalid: ${setting.id}`)
        assertOptionalManifestText(option.value, `Setting option value (${setting.id})`, 255)
        assertOptionalManifestText(option.label, `Setting option label (${setting.id})`, 255)
        if (values.has(option.value)) throw new Error(`Manifest Setting option value must be unique: ${setting.id}`)
        values.add(option.value)
      }
      if (!values.has(setting.default)) throw new Error(`Manifest Setting default must reference an option: ${setting.id}`)
      continue
    }
    throw new Error(`Manifest Setting type is invalid: ${(setting as { id?: string }).id ?? 'unknown'}`)
  }
}

function assertOptionalNonNegativeInteger(value: number | undefined, message: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) throw new Error(message)
}

function validateTextResourceContributions(
  contributions: ExtensionTextTransformRuleContribution[] | ExtensionTextExtractorContribution[] | undefined,
  label: string,
): void {
  const ids = new Set<string>()
  for (const contribution of contributions ?? []) {
    if (!contribution.id || !extensionStorageTokenPattern.test(contribution.id)) {
      throw new Error(`Manifest ${label} id is invalid: ${contribution.id}`)
    }
    if (ids.has(contribution.id)) throw new Error(`Manifest ${label} id must be unique: ${contribution.id}`)
    assertPackageJsonSource(contribution.source, `${label} ${contribution.id}`)
    ids.add(contribution.id)
  }
}

function assertPackageJsonSource(source: unknown, label: string): asserts source is string {
  if (typeof source !== 'string' || !source.trim() || source !== source.trim() || source.includes('\0') || isAbsolute(source) || !source.toLowerCase().endsWith('.json')) {
    throw new Error(`Manifest ${label} source must be a relative JSON file`)
  }
}

function assertOptionalManifestText(value: unknown, field: string, maxLength: number): void {
  if (value === undefined) return
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maxLength || value.includes('\0')) {
    throw new Error(`Manifest ${field} is invalid`)
  }
}

function assertOptionalManifestUrl(value: unknown, field: string): void {
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

/**
 * Aggregates declared contribution counts across extension capabilities.
 * Used by activation diagnostics to verify actual runtime registrations against static contracts.
 */
export function contributionCounts(manifest: ExtensionModuleManifest): { rpc: number; documentTypes: number; events: number; aiProviders: number; agentToolHandlers: number } {
  return {
    rpc: manifest.contributes?.rpc?.length ?? 0,
    documentTypes: manifest.contributes?.documentTypes?.length ?? 0,
    events: manifest.contributes?.events?.length ?? 0,
    aiProviders: manifest.contributes?.aiProviders?.length ?? 0,
    agentToolHandlers: manifest.contributes?.agentToolHandlers?.length ?? 0,
  }
}
