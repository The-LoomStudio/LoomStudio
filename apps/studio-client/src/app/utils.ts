import type { Translator } from '../shared/i18n/index.js'
import type { NarrativeBranch, NarrativeTimeline } from '../entities/index.js'

export function readEmptyTimelineText(input: { timeline?: NarrativeTimeline; branch?: NarrativeBranch }, t: Translator): string {
  if (!input.timeline) return t('timeline.empty.noSession')
  if (!input.branch) return t('timeline.empty.noBranch')
  return t('timeline.empty.ready')
}
