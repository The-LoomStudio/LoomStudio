import { randomUUID } from 'node:crypto'
import type { CardBundleArtifact, PromptResourceNode } from '@loom-studio/application-runtime'
import type {
  CardConversionResult,
  SillyTavernCard,
  SillyTavernCardV2,
  SillyTavernCardV2Data,
} from '../types.js'
import { extractPngImageBytes, extractStCardFromPng, isPngFile } from '../parser/png-reader.js'
import { convertSillyTavernLorebook } from './lorebook.js'

export function convertSillyTavernCard(
  source: Uint8Array | SillyTavernCard,
  rawJsonString?: string,
): CardConversionResult {
  let card: SillyTavernCard
  let avatarBytes: Uint8Array | undefined
  let sourceFormat: 'st.card.v2' | 'st.card.v3'
  let rawJson = rawJsonString

  if (source instanceof Uint8Array || Buffer.isBuffer(source)) {
    if (isPngFile(source)) {
      const extracted = extractStCardFromPng(source)
      if (!extracted) {
        throw new Error('PNG does not contain a SillyTavern character chunk (ccv3 or chara)')
      }
      card = extracted.card
      sourceFormat = extracted.format
      rawJson = extracted.rawJson
      avatarBytes = extractPngImageBytes(source)
    } else {
      const text = Buffer.from(source).toString('utf8')
      card = JSON.parse(text) as SillyTavernCard
      rawJson = text
      sourceFormat = card.spec === 'chara_card_v3' ? 'st.card.v3' : 'st.card.v2'
    }
  } else {
    card = source
    sourceFormat = card.spec === 'chara_card_v3' ? 'st.card.v3' : 'st.card.v2'
    if (!rawJson) {
      rawJson = JSON.stringify(card)
    }
  }

  const data: SillyTavernCardV2Data = card.data ?? (card as SillyTavernCardV2Data)
  const name = data.name?.trim() || 'SillyTavern Character'
  const systemPrompt = data.system_prompt?.trim() || ''
  const firstMes = data.first_mes?.trim() || ''

  const fullDescription = [
    data.description?.trim(),
    data.personality?.trim() ? `[Character Personality]\n${data.personality.trim()}` : '',
    data.scenario?.trim() ? `[Scenario]\n${data.scenario.trim()}` : '',
  ].filter(Boolean).join('\n\n')

  const contextAssets: PromptResourceNode[] = []
  const settingLayerEntries: NonNullable<CardBundleArtifact['card']['settingLayer']>['entries'] = []

  // 1. Process embedded character_book as a standalone Setting PromptResource in contextAssets AND card.settingLayer
  const book = data.character_book ?? (card as SillyTavernCardV2).character_book
  if (book && book.entries && (Array.isArray(book.entries) ? book.entries.length > 0 : Object.keys(book.entries).length > 0)) {
    const bookName = book.name?.trim() || `${name} 世界书`
    const lorebookConversion = convertSillyTavernLorebook(book, bookName)
    if (lorebookConversion.artifact.rootNode) {
      contextAssets.push(lorebookConversion.artifact.rootNode)

      for (const child of lorebookConversion.artifact.rootNode.children ?? []) {
        if (child.kind === 'entry' && typeof child.body === 'string') {
          settingLayerEntries.push({
            id: child.id,
            title: child.label,
            content: child.body,
            enabled: child.enabled !== false,
            activation: child.capabilities?.activation,
            tags: child.capabilities?.activation?.kind === 'keyword'
              ? child.capabilities.activation.keywords
              : (child.label ? [child.label] : []),
          })
        }
      }
    }
  }

  // 2. Process post-history instructions and extensions depth_prompt into contextAssets
  const postSessionEntries: PromptResourceNode[] = []
  const postHistory = data.post_history_instructions?.trim()
  if (postHistory) {
    postSessionEntries.push({
      id: `st-post-history-${randomUUID().slice(0, 8)}`,
      label: 'Post-History Instructions',
      kind: 'entry',
      category: 'preset',
      enabled: true,
      body: postHistory,
      capabilities: {
        targetAnchorId: '@chat.session.post',
        activation: { kind: 'always' },
      },
    })
  }

  const depthExtension = (data.extensions as Record<string, unknown> | undefined)?.depth_prompt as {
    prompt?: string
    depth?: number
    role?: string
  } | undefined

  if (depthExtension && typeof depthExtension.prompt === 'string' && depthExtension.prompt.trim()) {
    postSessionEntries.push({
      id: `st-depth-prompt-${randomUUID().slice(0, 8)}`,
      label: 'Depth Prompt Extension',
      kind: 'entry',
      category: 'preset',
      enabled: true,
      body: depthExtension.prompt.trim(),
      capabilities: {
        targetAnchorId: '@chat.session.post',
        localDepth: typeof depthExtension.depth === 'number' ? depthExtension.depth : 0,
        activation: { kind: 'always' },
      },
    })
  }

  if (postSessionEntries.length > 0) {
    contextAssets.push({
      id: `st-post-session-module-${randomUUID().slice(0, 8)}`,
      label: 'SillyTavern Post-Session & Depth Prompts',
      kind: 'module',
      category: 'preset',
      enabled: true,
      capabilities: {
        targetAnchorId: '@chat.session.post',
      },
      children: postSessionEntries,
    })
  }

  // 5. Build portable payload storing the original untouched ST card
  const artifactId = `card-st-${randomUUID()}`
  const extensionPayloads = [
    {
      id: 'sillytavern-source-card',
      packageId: 'sillytavern.importer',
      fileName: 'sillytavern_card.json',
      format: 'sillytavern.character+json',
      mediaType: 'application/json',
      content: rawJson || JSON.stringify(card),
    },
  ]

  const metadata: NonNullable<CardBundleArtifact['metadata']> = {
    importer: 'sillytavern.importer',
    originalFormat: sourceFormat,
    importedAt: new Date().toISOString(),
  }
  if (data.creator) metadata.stCreator = data.creator
  if (data.character_version) metadata.stVersion = data.character_version
  if (data.tags && Array.isArray(data.tags)) metadata.stTags = data.tags

  const artifact: CardBundleArtifact = {
    schemaVersion: 2,
    artifactId,
    displayName: name,
    description: fullDescription || undefined,
    card: {
      name,
      userName: undefined,
      description: fullDescription || undefined,
      preset: systemPrompt ? { system: systemPrompt } : undefined,
      opening: firstMes ? { entries: [{ role: 'assistant', content: firstMes }] } : undefined,
      settingLayer: { entries: settingLayerEntries },
    },
    contextAssets,
    extensionPayloads,
    metadata,
  }

  return {
    artifact,
    avatarBytes,
    sourceFormat,
  }
}
