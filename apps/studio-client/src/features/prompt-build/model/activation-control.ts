import type { ClientJsonValue } from '@loom-studio/client-bridge'

export type ActivationMode = 'draft' | 'finalize'
export type ActivationTag = 'scene:combat' | 'style:cinematic'

export type ActivationControlState = {
  mode: ActivationMode
  tags: ActivationTag[]
}

export type ActivationTagOption = {
  color: string
  labelKey: 'composer.activation.tag.combat' | 'composer.activation.tag.cinematic'
  value: ActivationTag
}

export const activationModeOptions: ActivationMode[] = ['draft', 'finalize']

export const activationTagOptions: ActivationTagOption[] = [
  { value: 'scene:combat', labelKey: 'composer.activation.tag.combat', color: '#b45309' },
  { value: 'style:cinematic', labelKey: 'composer.activation.tag.cinematic', color: '#2563eb' },
]

export function createActivationFacts(state: ActivationControlState): { [key: string]: ClientJsonValue } {
  return {
    'agent.mode': state.mode,
    tags: state.tags,
  }
}

export function toggleActivationTag(tags: ActivationTag[], tag: ActivationTag): ActivationTag[] {
  return tags.includes(tag)
    ? tags.filter(item => item !== tag)
    : [...tags, tag]
}
