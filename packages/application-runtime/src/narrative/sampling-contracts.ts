import type { NarrativeSampleRequest } from './sampling.js'
import type { TextTransformPhase } from '../transforms/history-text.js'

export type SampleNarrativeInput = NarrativeSampleRequest & {
  processing?: {
    phase: TextTransformPhase
    presetId?: string
    consumerAgentSessionId?: string
  }
}

