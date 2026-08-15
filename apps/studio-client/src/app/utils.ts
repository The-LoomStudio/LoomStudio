import type { Translator } from '../shared/i18n/index.js'
import type { NarrativeBranch, NarrativeTimeline } from '../entities/index.js'

function shortId(id: string): string {
  return id.slice(0, 13)
}

export function readComposerHint(input: { timeline?: NarrativeTimeline; branch?: NarrativeBranch; busy: boolean; input: string }, t: Translator): string {
  if (input.busy) return t('composer.hint.busy')
  if (!input.timeline) return t('composer.hint.noSession')
  if (!input.branch) return t('composer.hint.noBranch')
  if (input.input.trim().length === 0) return t('composer.hint.emptyInput')
  return input.branch.headNodeId
    ? t('composer.hint.afterHead', { branchId: shortId(input.branch.id), headId: shortId(input.branch.headNodeId) })
    : t('composer.hint.emptyBranch', { branchId: shortId(input.branch.id) })
}

export function readEmptyTimelineText(input: { timeline?: NarrativeTimeline; branch?: NarrativeBranch }, t: Translator): string {
  if (!input.timeline) return t('timeline.empty.noSession')
  if (!input.branch) return t('timeline.empty.noBranch')
  return t('timeline.empty.ready')
}
