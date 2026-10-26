import { useId, useState } from 'react'
import { Button, Dialog } from '@loom-studio/ui'
import { RotateCcw } from 'lucide-react'
import type { NarrativeSwipeView } from '../model/use-narrative-runtime.js'
import type { Translator } from '../../../shared/i18n/index.js'
import { SwipeControl } from '../../../shared/ui/swipe-control/swipe-control.js'
import { ConversationMessageAction } from '../../../shared/ui/conversation-message-chrome/conversation-message-chrome.js'
import styles from '../../cards/ui/opening-picker.module.scss'

export function NarrativeSwipePicker(props: {
  swipe: NarrativeSwipeView
  busy: boolean
  primarySessionId?: string
  onSelect(candidateId: string): void
  onGenerate(mode: 'swipe' | 'regenerate' | 'retry', allowSessionChange?: boolean): void
  t: Translator
}) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const groupId = useId()
  const { swipe, t } = props
  const candidates = swipe.candidates.filter(candidate => (!candidate.inputNodeId || candidate.inputNodeId === swipe.inputNodeId)
    && (candidate.status === 'completed' || candidate.status === 'failed'))
  const index = candidates.findIndex(candidate => candidate.id === swipe.selectedCandidateId)
  const latestCandidate = swipe.candidates.at(-1)
  const canRetry = index < 0 || latestCandidate?.status === 'failed' || latestCandidate?.status === 'discarded'
  const locked = props.busy || swipe.active || swipe.suspended
  const canSelect = !locked && swipe.canSelect
  const canGenerate = !locked && swipe.canGenerate && Boolean(props.primarySessionId)
  const generate = (mode: 'swipe' | 'regenerate' | 'retry') => {
    if (!canGenerate) return
    if (swipe.requiresRegeneration || swipe.sourceAgentSessionId !== props.primarySessionId) setConfirm(true)
    else props.onGenerate(mode)
  }
  return <>
    {candidates[index]?.status === 'failed' ? <span role="status">{t('swipe.noBody')}</span> : null}
    {swipe.reason ? <span role="status">{swipe.reason}</span> : null}
    <ConversationMessageAction disabled={!canGenerate} label={t(canRetry ? 'swipe.retry' : 'swipe.regenerate')}
      onClick={() => generate(canRetry ? 'retry' : 'regenerate')}><RotateCcw aria-hidden="true" /></ConversationMessageAction>
    {index >= 0 ? <SwipeControl index={index} count={candidates.length} disabled={!canSelect}
      previousLabel={t('swipe.previous')} nextLabel={t(index === candidates.length - 1 ? 'swipe.generate' : 'swipe.next')} chooseLabel={t('swipe.choose')}
      onGenerateNext={canGenerate ? () => generate('swipe') : undefined}
      onPrevious={() => props.onSelect(candidates[index - 1].id)}
      onNext={() => props.onSelect(candidates[index + 1].id)} onChoose={() => setOpen(true)} /> : null}
    <Dialog open={open} title={t('swipe.choose')} onClose={() => setOpen(false)}>
      <div className={styles.choices}>{candidates.map((candidate, i) => <label className={styles.option} key={candidate.id}>
        <input type="radio" name={groupId} checked={candidate.id === swipe.selectedCandidateId} disabled={!canSelect}
          onChange={() => { props.onSelect(candidate.id); setOpen(false) }} />
        <span>{i + 1}. {candidate.status === 'failed' ? t('swipe.noBody') : candidate.preview}</span>
      </label>)}</div>
    </Dialog>
    <Dialog open={confirm} title={t('swipe.regenerate')} onClose={() => setConfirm(false)}
      actions={<Button disabled={!canGenerate} onClick={() => { setConfirm(false); props.onGenerate('regenerate', true) }}>{t('swipe.regenerate')}</Button>}>
      <p>{t('swipe.sessionChanged')}</p>
    </Dialog>
  </>
}
