import {
  normalizeCardBundleArtifact,
  type CardBundleArtifact,
  type PromptResourceNode,
} from '@loom-studio/application-runtime'

type FileNode = {
  metadata: Omit<PromptResourceNode, 'body' | 'children'>
  body?: string
  children?: FileNode[]
}

type Card = CardBundleArtifact['card']
type CardFile = {
  config: Omit<Card, 'description' | 'opening' | 'settingLayer' | 'preset' | 'macros' | 'media'>
  description?: string
  macros?: string
  preset?: { system?: string; macros?: string }
  opening?: { text: string } | { entries?: Array<{ role?: 'user' | 'assistant'; content: string }> }
  settingLayer?: { entries?: Array<Record<string, unknown> & { content: string }> }
}

export type CardFilesIndex = {
  metadata: Pick<CardBundleArtifact, 'schemaVersion' | 'artifactId' | 'displayName' | 'description' | 'metadata'>
  card: string
  contextAssets: string[]
  externalContextAssetIds?: string[]
  state?: string
  stateTemplates?: string[]
  timelineStateBindings?: string
  textTransformRules?: string[]
  textExtractors?: string[]
}

// The same file map is consumed by ZIP and PNG. Paths never replace domain IDs.
export function projectCardFiles(artifact: CardBundleArtifact, files: Record<string, Uint8Array>): CardFilesIndex {
  const json = (path: string, value: unknown) => {
    files[path] = Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8')
    return path
  }
  const text = (path: string, value: string) => {
    files[path] = Buffer.from(value, 'utf8')
    return path
  }
  const list = (directory: string, values: unknown[]) =>
    values.map((value, index) => json(`${directory}/${fileStem(value, index)}.json`, value))
  const nodeBodies = new Map<string, { path: string; body: string }>()
  const node = (value: PromptResourceNode, directory: string, depth = 0): FileNode => {
    if (depth > 128) throw new Error('Card Prompt tree exceeds 128 levels')
    const { body, children, ...metadata } = value
    const container = value.kind === 'module' || value.kind === 'folder' || Boolean(children?.length)
    const bodyPath = container ? `${directory}/_content.md` : `${directory}.md`
    if (body !== undefined) nodeBodies.set(value.id, { path: bodyPath, body })
    return {
      metadata,
      ...(body !== undefined ? { body: text(bodyPath, body) } : {}),
      ...(children !== undefined ? { children: children.map((child, index) => node(child, `${directory}/${fileStem(child, index)}`, depth + 1)) } : {}),
    }
  }
  const contextAssets = artifact.contextAssets.map((value, index) => {
    const directory = `${artifact.externalContextAssetIds?.includes(value.id) ? 'external/' : ''}prompts/${fileStem(value, index)}`
    return json(`${directory}/index.json`, node(value, directory))
  })
  const { description, opening, settingLayer, preset, macros, media, ...config } = artifact.card
  const card: CardFile = { config }
  if (description !== undefined) card.description = text('card/description.md', description)
  if (macros !== undefined) card.macros = json('macros/card.json', macros)
  if (preset !== undefined) {
    card.preset = {
      ...(preset.system !== undefined ? { system: text('preset/system.md', preset.system) } : {}),
      ...(preset.macros !== undefined ? { macros: json('macros/preset.json', preset.macros) } : {}),
    }
  }
  if (opening !== undefined) {
    card.opening = typeof opening === 'string'
      ? { text: text('opening/0.md', opening) }
      : { ...(opening.entries !== undefined ? {
        entries: opening.entries.map(({ content, ...entry }, index) => ({
          ...entry, content: text(`opening/${index}.md`, content),
        })),
      } : {}) }
  }
  if (settingLayer !== undefined) {
    card.settingLayer = { ...(settingLayer.entries !== undefined ? {
      entries: settingLayer.entries.map(({ content, ...entry }, index) => {
        const projected = entry.id === undefined ? undefined : nodeBodies.get(entry.id)
        return {
          ...entry,
          content: projected?.body === content ? projected.path : text(`settings/${fileStem(entry, index)}.md`, content),
        }
      }),
    } : {}) }
  }
  const index: CardFilesIndex = {
    metadata: {
      schemaVersion: artifact.schemaVersion,
      artifactId: artifact.artifactId,
      displayName: artifact.displayName,
      ...(artifact.description !== undefined ? { description: artifact.description } : {}),
      ...(artifact.metadata !== undefined ? { metadata: artifact.metadata } : {}),
    },
    card: json('card.json', card),
    contextAssets,
    ...(artifact.externalContextAssetIds !== undefined ? { externalContextAssetIds: [...artifact.externalContextAssetIds] } : {}),
  }
  if (artifact.state !== undefined) {
    const { contribution, ...header } = artifact.state
    const { entityTypes, templates, entities, componentMounts, bindings, ...contributionHeader } = contribution
    index.state = json('state/index.json', {
      artifact: header,
      contribution: {
        ...contributionHeader,
        entityTypes: list('state/entity-types', entityTypes),
        templates: list('state/templates', templates),
        entities: list('state/entities', entities),
        componentMounts: list('state/component-mounts', componentMounts),
        bindings: list('state/bindings', bindings),
      },
    })
  }
  if (artifact.state === undefined) {
    if (artifact.stateTemplates !== undefined) index.stateTemplates = list('state/legacy-templates', artifact.stateTemplates)
    if (artifact.timelineStateBindings !== undefined) index.timelineStateBindings = json('state/legacy-bindings.json', artifact.timelineStateBindings)
  }
  if (artifact.textTransformRules !== undefined) index.textTransformRules = list('transforms/rules', artifact.textTransformRules)
  if (artifact.textExtractors !== undefined) index.textExtractors = list('transforms/extractors', artifact.textExtractors)
  return index
}

export function restoreCardFiles(index: CardFilesIndex, files: Map<string, Uint8Array>): CardBundleArtifact {
  const text = (path: string): string => {
    validateBundlePath(path)
    const bytes = files.get(path)
    if (!bytes) throw new Error(`Loom Card package is missing ${path}`)
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }
  const json = <T>(path: string): T => JSON.parse(text(path)) as T
  const list = <T>(paths: string[]): T[] => {
    if (!Array.isArray(paths)) throw new Error('Expected a Card file reference list')
    return paths.map(path => json<T>(path))
  }
  const node = (file: FileNode, depth = 0): PromptResourceNode => {
    if (depth > 128) throw new Error('Card Prompt tree exceeds 128 levels')
    if (!file || typeof file !== 'object' || !file.metadata || typeof file.metadata !== 'object') {
      throw new Error('Invalid Prompt file index')
    }
    return {
      ...file.metadata,
      ...(file.body !== undefined ? { body: text(file.body) } : {}),
      ...(file.children !== undefined ? { children: file.children.map(child => node(child, depth + 1)) } : {}),
    }
  }
  const stored = json<CardFile>(index.card)
  const card: Card = {
    ...stored.config,
    ...(stored.description !== undefined ? { description: text(stored.description) } : {}),
    ...(stored.macros !== undefined ? { macros: json<Record<string, string>>(stored.macros) } : {}),
  }
  if (stored.preset !== undefined) {
    card.preset = {
      ...(stored.preset.system !== undefined ? { system: text(stored.preset.system) } : {}),
      ...(stored.preset.macros !== undefined ? { macros: json<Record<string, string>>(stored.preset.macros) } : {}),
    }
  }
  if (stored.opening !== undefined) {
    card.opening = 'text' in stored.opening ? text(stored.opening.text) : {
      ...(stored.opening.entries !== undefined ? {
        entries: stored.opening.entries.map(entry => ({ ...entry, content: text(entry.content) })),
      } : {}),
    }
  }
  if (stored.settingLayer !== undefined) {
    card.settingLayer = { ...(stored.settingLayer.entries !== undefined ? {
      entries: stored.settingLayer.entries.map(entry => ({ ...entry, content: text(entry.content) })),
    } : {}) }
  }
  const artifact: CardBundleArtifact = {
    ...index.metadata,
    card,
    contextAssets: list<FileNode>(index.contextAssets).map(value => node(value)),
    ...(index.externalContextAssetIds !== undefined ? { externalContextAssetIds: index.externalContextAssetIds } : {}),
  }
  if (index.state !== undefined) {
    type State = NonNullable<CardBundleArtifact['state']>
    type Contribution = State['contribution']
    const storedState = json<{
      artifact: Omit<State, 'contribution'>
      contribution: Omit<Contribution, 'entityTypes' | 'templates' | 'entities' | 'componentMounts' | 'bindings'>
        & Record<'entityTypes' | 'templates' | 'entities' | 'componentMounts' | 'bindings', string[]>
    }>(index.state)
    const refs = storedState.contribution
    artifact.state = {
      ...storedState.artifact,
      contribution: {
        ...refs,
        entityTypes: list(refs.entityTypes),
        templates: list(refs.templates),
        entities: list(refs.entities),
        componentMounts: list(refs.componentMounts),
        bindings: list(refs.bindings),
      },
    }
    artifact.stateTemplates = structuredClone(artifact.state.contribution.templates)
    artifact.timelineStateBindings = structuredClone(artifact.state.contribution.bindings)
  }
  if (index.stateTemplates !== undefined) artifact.stateTemplates = list(index.stateTemplates)
  if (index.timelineStateBindings !== undefined) artifact.timelineStateBindings = json(index.timelineStateBindings)
  if (index.textTransformRules !== undefined) artifact.textTransformRules = list(index.textTransformRules)
  if (index.textExtractors !== undefined) artifact.textExtractors = list(index.textExtractors)
  return normalizeCardBundleArtifact(artifact)
}

// Load only indexed files; author projects may also contain unrelated build trees.
export async function loadCardResourceFiles(index: CardFilesIndex, load: (path: string) => Promise<Uint8Array>): Promise<void> {
  const json = async <T>(path: string): Promise<T> =>
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await load(path))) as T
  const list = async (paths: string[] | undefined) => {
    if (paths === undefined) return
    if (!Array.isArray(paths)) throw new Error('Expected a Card file reference list')
    for (const path of paths) await load(path)
  }
  const node = async (value: FileNode, depth = 0): Promise<void> => {
    if (depth > 128) throw new Error('Card Prompt tree exceeds 128 levels')
    if (value.body !== undefined) await load(value.body)
    if (value.children !== undefined) {
      for (const child of value.children) await node(child, depth + 1)
    }
  }
  const card = await json<CardFile>(index.card)
  if (card.description !== undefined) await load(card.description)
  if (card.macros !== undefined) await load(card.macros)
  if (card.preset?.system !== undefined) await load(card.preset.system)
  if (card.preset?.macros !== undefined) await load(card.preset.macros)
  if (card.opening !== undefined) {
    if ('text' in card.opening) await load(card.opening.text)
    else for (const entry of card.opening.entries ?? []) await load(entry.content)
  }
  for (const entry of card.settingLayer?.entries ?? []) await load(entry.content)
  if (!Array.isArray(index.contextAssets)) throw new Error('Expected a Card file reference list')
  for (const path of index.contextAssets) await node(await json<FileNode>(path))
  if (index.state !== undefined) {
    const state = await json<{ contribution: Record<string, string[]> }>(index.state)
    for (const key of ['entityTypes', 'templates', 'entities', 'componentMounts', 'bindings']) {
      await list(state.contribution[key])
    }
  }
  await list(index.stateTemplates)
  if (index.timelineStateBindings !== undefined) await load(index.timelineStateBindings)
  await list(index.textTransformRules)
  await list(index.textExtractors)
}

export function validateBundlePath(path: string): void {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.includes('\0')
    || path.includes(':') || path.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(`Unsafe ZIP entry path: ${String(path)}`)
  }
}

function fileStem(value: unknown, index: number): string {
  const item = value as { label?: unknown; name?: unknown; title?: unknown; id?: unknown; entityId?: unknown } | null
  const name = item?.label ?? item?.name ?? item?.title ?? item?.id ?? item?.entityId
  const label = typeof name === 'string'
    ? Array.from(name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')).slice(0, 64).join('').replace(/[. ]+$/g, '')
    : ''
  return `${index}${label ? `-${label}` : ''}`
}
