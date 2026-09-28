import { RefreshCw, Undo2 } from 'lucide-react'
import { IconButton } from '@loom-studio/ui'
import type { RunRecovery } from '../model/use-narrative-runtime.js'
import type { Translator } from '../../../shared/i18n/index.js'
import styles from './run-recovery-controls.module.scss'

export type RunRecoveryControlsProps = {
  runRecovery?: RunRecovery
  runRecoveryBusy: boolean
  canRestoreRunInput: boolean
  reconnectAgentRun(): Promise<void>
  restoreRunInput(): void
  t: Translator
}

export function RunRecoveryControls(props: RunRecoveryControlsProps) {
  const recovery = props.runRecovery
  if (!recovery) return null
  const disconnected = recovery.status === 'disconnected'
  const reconnectLabel = props.t(disconnected ? 'runRecovery.reconnect' : 'runRecovery.refresh')

  return (
    <div className={styles.controls} aria-busy={props.runRecoveryBusy}>
      <div className={styles.message} role="status">
        <span>{props.t(`runRecovery.${recovery.status}`)}</span>
        {recovery.error ? <span>{recovery.error}</span> : null}
        {recovery.refreshFailed ? <span>{props.t('runRecovery.refreshFailed')}</span> : null}
      </div>
      {disconnected || recovery.refreshFailed ? (
        <IconButton
          aria-label={reconnectLabel}
          title={reconnectLabel}
          disabled={props.runRecoveryBusy}
          onClick={() => { void props.reconnectAgentRun().catch(() => { /* Failure is reported by the runtime. */ }) }}
        >
          <RefreshCw aria-hidden="true" />
        </IconButton>
      ) : null}
      {!disconnected && recovery.input !== undefined ? (
        <IconButton
          aria-label={props.t('runRecovery.restoreInput')}
          title={props.t(props.canRestoreRunInput ? 'runRecovery.restoreInput' : 'runRecovery.keepDraft')}
          disabled={props.runRecoveryBusy || !props.canRestoreRunInput}
          onClick={props.restoreRunInput}
        >
          <Undo2 aria-hidden="true" />
        </IconButton>
      ) : null}
    </div>
  )
}
