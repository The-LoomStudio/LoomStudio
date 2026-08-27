export type ActivationMode = 'draft' | 'finalize'
export type ActivationTag = 'scene:combat' | 'style:cinematic'

export type ActivationControlState = {
  mode: ActivationMode
  tags: ActivationTag[]
}

export type ActivationFacts = {
  'agent.mode': ActivationMode
  tags: ActivationTag[]
}

export function createActivationFacts(state: ActivationControlState): ActivationFacts {
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
