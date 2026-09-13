import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type { CardBundleArtifact, PromptResourceArtifact } from '@loom-studio/application-runtime'

export type SillyTavernCardV2Data = {
  name?: string
  description?: string
  personality?: string
  scenario?: string
  first_mes?: string
  mes_example?: string
  creator_notes?: string
  system_prompt?: string
  post_history_instructions?: string
  alternate_greetings?: string[]
  character_book?: SillyTavernLorebookData
  tags?: string[]
  creator?: string
  character_version?: string
  extensions?: Record<string, JsonValue>
}

export type SillyTavernCardV2 = SillyTavernCardV2Data & {
  spec?: 'chara_card_v2'
  spec_version?: '2.0'
  data?: SillyTavernCardV2Data
}

export type SillyTavernCardV3 = {
  spec: 'chara_card_v3'
  spec_version: '3.0'
  data: SillyTavernCardV2Data & {
    assets?: Array<{
      type: string
      uri: string
      name: string
      ext: string
    }>
    nickname?: string
    creator_notes_multilingual?: Record<string, string>
    source?: string[]
    group_only_greetings?: string[]
  }
}

export type SillyTavernCard = SillyTavernCardV2 | SillyTavernCardV3

export type SillyTavernLorebookEntry = {
  id?: number | string
  uid?: number | string
  displayIndex?: number
  key?: string[] | string
  keys?: string[] | string
  keysecondary?: string[] | string
  secondary_keys?: string[] | string
  comment?: string
  content?: string
  constant?: boolean
  selective?: boolean
  insertion_order?: number
  order?: number
  position?: 'before_char' | 'after_char' | 'at_depth' | number | string
  depth?: number
  disable?: boolean
  enabled?: boolean
  prevent_recursion?: boolean
  caseSensitive?: boolean | null
  case_sensitive?: boolean | null
  keysearch_case?: boolean | null
  extensions?: Record<string, JsonValue>
}

export type SillyTavernLorebookData = {
  name?: string
  description?: string
  scan_depth?: number
  token_budget?: number
  recursive_scanning?: boolean
  entries?: Record<string, SillyTavernLorebookEntry> | SillyTavernLorebookEntry[]
  extensions?: Record<string, JsonValue>
}

export type SillyTavernPresetPrompt = {
  identifier?: string
  name?: string
  role?: 'system' | 'user' | 'assistant'
  content?: string
  system_prompt?: boolean
  marker?: boolean
  injection_position?: number | string
  injection_depth?: number
  order?: number
  enabled?: boolean
  forbid_external_insert?: boolean
}

export type SillyTavernPresetOrderItem = {
  identifier: string
  enabled?: boolean
}

export type SillyTavernPresetOrderGroup = {
  character_id?: number | string
  order: SillyTavernPresetOrderItem[]
}

export type SillyTavernPresetData = {
  prompts?: SillyTavernPresetPrompt[]
  prompt_order?: SillyTavernPresetOrderGroup[]
  temperature?: number
  frequency_penalty?: number
  presence_penalty?: number
  top_p?: number
  top_k?: number
  max_tokens?: number
  extensions?: Record<string, JsonValue>
  [key: string]: unknown
}

export type SniffFormat =
  | 'st.card.png'
  | 'st.card.json'
  | 'st.lorebook.json'
  | 'st.preset.json'
  | 'unknown'

export type SniffResult = {
  detected: boolean
  format: SniffFormat
  summary?: string
  details?: JsonObject
}

export type CardConversionResult = {
  artifact: CardBundleArtifact
  avatarBytes?: Uint8Array
  sourceFormat: 'st.card.v2' | 'st.card.v3'
}

export type LorebookConversionResult = {
  artifact: PromptResourceArtifact
}

export type PresetConversionResult = {
  artifact: PromptResourceArtifact
}
