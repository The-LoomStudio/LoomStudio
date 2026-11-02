import { forwardRef } from 'react'
import { PanelRight, PanelRightClose } from 'lucide-react'
import type { AgentSession } from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import styles from './studio-page.module.scss'

export type StageAgentCapsuleProps = {
  open: boolean
  session?: AgentSession
  sessionsCount?: number
  t: Translator
  onToggle(): void
}

export const StageAgentCapsule = forwardRef<HTMLButtonElement, StageAgentCapsuleProps>(function StageAgentCapsule(props, ref) {
  const sessionTitle = props.session?.title?.trim() || props.t('sessions.untitledAgentSession')
  const count = props.sessionsCount ?? 0

  const toggleTitle = props.open ? props.t('agent.hide') : props.t('agent.open')

  return (
    <button
      ref={ref}
      aria-expanded={props.open}
      aria-label={`${props.open ? '关闭' : '打开'} Agent 面板`}
      className={[
        styles.stageAgentCapsule,
        props.open ? styles.stageAgentCapsuleOpen : '',
      ].filter(Boolean).join(' ')}
      title={toggleTitle}
      type="button"
      onClick={props.onToggle}
    >
      <span className={styles.stageAgentCapsuleBody}>
        <span className={styles.stageAgentTitle}>{sessionTitle}</span>

        {count > 0 ? (
          <span className={styles.stageAgentBadge}>{count}</span>
        ) : null}
      </span>

      <span className={styles.stageAgentCapsuleTrailing}>
        {props.open ? (
          <PanelRightClose aria-hidden="true" className={styles.stageAgentToggleIcon} />
        ) : (
          <PanelRight aria-hidden="true" className={styles.stageAgentToggleIcon} />
        )}
      </span>
    </button>
  )
})
