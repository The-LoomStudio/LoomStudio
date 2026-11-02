import { InfoDialog } from '../../../shared/ui/info-dialog/info-dialog.js'
import { CircleAlert, CircleX, RefreshCw, Undo2 } from 'lucide-react'
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
  abandonAgentRun?(): Promise<void>
  t: Translator
}

export function RunRecoveryControls(props: RunRecoveryControlsProps) {
  const recovery = props.runRecovery
  if (!recovery) return null
  const displayStatus = recovery.status === 'suspended' && recovery.error ? 'failed' : recovery.status
  const disconnected = recovery.status === 'disconnected'
  const reconnectLabel = props.t(disconnected ? 'runRecovery.reconnect' : 'runRecovery.refresh')

  return (
    <div className={styles.controls} data-status={displayStatus} aria-busy={props.runRecoveryBusy}>
      <CircleAlert className={styles.statusIcon} aria-hidden="true" />
      <div className={styles.message} role={recovery.error ? 'alert' : 'status'}>
        <span>{props.t(`runRecovery.${displayStatus}`)}</span>
        {recovery.refreshFailed ? <span>{props.t('runRecovery.refreshFailed')}</span> : null}
      </div>
      <div className={styles.actions}>
      {recovery.error ? <InfoDialog title="查看错误详情"><p>{recovery.error}</p></InfoDialog> : null}
      {disconnected || recovery.refreshFailed ? (
        <IconButton size="small"
          aria-label={reconnectLabel}
          title={reconnectLabel}
          disabled={props.runRecoveryBusy}
          onClick={() => { void props.reconnectAgentRun().catch(() => { /* Failure is reported by the runtime. */ }) }}
        >
          <RefreshCw aria-hidden="true" />
        </IconButton>
      ) : null}
      {recovery.status === 'suspended' && props.abandonAgentRun ? (
        <IconButton size="small" aria-label={props.t('runRecovery.abandon')} title={props.t('runRecovery.abandon')}
          disabled={props.runRecoveryBusy} onClick={() => { void props.abandonAgentRun?.() }}>
          <CircleX aria-hidden="true" />
        </IconButton>
      ) : null}
      {!disconnected && recovery.input !== undefined ? (
        <IconButton size="small"
          aria-label={props.t('runRecovery.restoreInput')}
          title={props.t(props.canRestoreRunInput ? 'runRecovery.restoreInput' : 'runRecovery.keepDraft')}
          disabled={props.runRecoveryBusy || !props.canRestoreRunInput}
          onClick={props.restoreRunInput}
        >
          <Undo2 aria-hidden="true" />
        </IconButton>
      ) : null}
      </div>
    </div>
  )
}
