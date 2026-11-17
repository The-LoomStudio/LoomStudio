import { Activity, Cpu, Layers, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Button, Tabs } from '@loom-studio/ui'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import { formatNumber, type Translator } from '../../../shared/i18n/index.js'
import type { PromptBuildStep } from '../../prompt-build/model/build-prompt-build-steps.js'
import { useRunLedgers } from '../model/use-run-ledgers.js'
import { formatLatencyMs } from '../model/run-ledger-view.js'
import { ObservationRawData } from './observation-dialog.js'
import styles from './run-troubleshooting-ledgers.module.scss'

type LedgerFilter = 'all' | 'prompt' | 'calls' | 'diagnostics'

export type RunTroubleshootingLedgersProps = {
  api: StudioApi
  endpoint: string
  runId?: string
  buildId?: string
  tokenEstimate?: { estimatedTokens: number }
  promptBuildSteps?: PromptBuildStep[]
  promptBuildTrace?: unknown
  promptMessages?: unknown
  t: Translator
}

function statusTone(status?: string): 'success' | 'info' | 'danger' | 'warning' | 'neutral' {
  if (status === 'completed' || status === 'ok' || status === 'info') return 'success'
  if (status === 'running') return 'info'
  if (status === 'failed' || status === 'error') return 'danger'
  if (status === 'aborted' || status === 'suspended' || status === 'warning' || status === 'warn') return 'warning'
  return 'neutral'
}

export function RunTroubleshootingLedgers(props: RunTroubleshootingLedgersProps) {
  const [view, setView] = useState<LedgerFilter>('all')
  const ledgers = useRunLedgers({
    api: props.api,
    endpoint: props.endpoint,
    runId: props.runId,
    buildId: props.buildId,
    fallback: {
      tokenEstimate: props.tokenEstimate,
      promptBuildSteps: props.promptBuildSteps,
      promptBuildTrace: props.promptBuildTrace,
      promptMessages: props.promptMessages,
    },
  })

  const totalInputTokens = ledgers.modelCalls.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0)
  const totalOutputTokens = ledgers.modelCalls.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0)
  const totalCallLatencyMs = ledgers.modelCalls.reduce((sum, call) => sum + (call.durationMs ?? 0), 0)
  const errorCount = ledgers.diagnosticLogLedger.filter(item => item.severity === 'error').length
  const warningCount = ledgers.diagnosticLogLedger.filter(item => item.severity === 'warning').length

  const selectOptions = [...ledgers.availableRecords]
  if (props.runId && !selectOptions.some(item => item.id === props.runId)) {
    selectOptions.unshift({
      id: props.runId,
      kind: 'run',
      title: 'Current Run',
      status: 'completed',
      capturedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      availability: 'recorded',
    })
  }

  return (
    <section className={styles.root} data-loom-component="inspector-3-ledgers">
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h2>Run Troubleshooting Ledgers</h2>
          <small>Prompt projection, model calls, and correlated diagnostics / logs</small>
        </div>
        <div className={styles.controls}>
          <select
            className={styles.runSelect}
            aria-label="Inspect run"
            value={ledgers.activeRecordId ?? ''}
            onChange={event => ledgers.selectRecord(event.target.value || undefined)}
          >
            {selectOptions.length === 0 ? (
              <option value="">No recorded runs yet</option>
            ) : selectOptions.map(record => (
              <option key={record.id} value={record.id}>
                [{record.kind}] {record.title} ({record.status}) · {new Date(record.capturedAt).toLocaleTimeString()}
              </option>
            ))}
          </select>
          <Button size="small" onClick={() => { void ledgers.refreshAll() }}>
            <RefreshCw size={13} aria-hidden="true" />
            {props.t('logs.refresh')}
          </Button>
        </div>
      </div>

      <Tabs
        ariaLabel="Troubleshooting ledger view"
        size="compact"
        activeId={view}
        onChange={value => setView(value)}
        items={[
          { id: 'all', label: 'All (3-Ledger)' },
          { id: 'prompt', label: 'Prompt Projection' },
          { id: 'calls', label: `Model Calls (${ledgers.modelCalls.length})` },
          { id: 'diagnostics', label: `Diagnostics & Logs (${ledgers.diagnosticLogLedger.length})` },
        ]}
      />

      {(ledgers.resolvedRunId || ledgers.correlationId || ledgers.resolvedBuildId) && (
        <div className={styles.identityBar}>
          {ledgers.resolvedRunId && (
            <span className={styles.identityChip}>
              <span>runId:</span>
              <code>{ledgers.resolvedRunId}</code>
            </span>
          )}
          {ledgers.correlationId && (
            <span className={styles.identityChip}>
              <span>correlationId:</span>
              <code>{ledgers.correlationId}</code>
            </span>
          )}
          {ledgers.resolvedBuildId && (
            <span className={styles.identityChip}>
              <span>buildId:</span>
              <code>{ledgers.resolvedBuildId}</code>
            </span>
          )}
          {ledgers.activeSummary && (
            <span className={styles.badge} data-tone={statusTone(ledgers.activeSummary.status)}>
              {ledgers.activeSummary.status} · {formatLatencyMs(ledgers.activeSummary.durationMs)}
            </span>
          )}
        </div>
      )}

      <div className={styles.ledgerGrid} data-layout={view === 'all' ? 'unified' : 'focused'}>
        {(view === 'all' || view === 'prompt') && (
          <article className={styles.ledger} data-ledger="prompt">
            <header className={styles.ledgerHeader}>
              <h3><Layers size={14} aria-hidden="true" />Prompt Projection</h3>
              <span className={styles.ledgerCount}>
                {ledgers.promptLedger.sections.length} sections
              </span>
            </header>

            <div className={styles.metricsRow}>
              <div className={styles.metric}>
                <small>Active / Skip</small>
                <strong>{ledgers.promptLedger.activeSectionCount} / {ledgers.promptLedger.inactiveSectionCount}</strong>
              </div>
              <div className={styles.metric}>
                <small>Est. Tokens</small>
                <strong>{ledgers.promptLedger.estimatedTokens !== undefined ? formatNumber(ledgers.promptLedger.estimatedTokens) : '—'}</strong>
              </div>
              <div className={styles.metric}>
                <small>Messages</small>
                <strong>{ledgers.promptLedger.messageCount}</strong>
              </div>
              <div className={styles.metric}>
                <small>Fragments</small>
                <strong>
                  {ledgers.promptLedger.finalFragmentCount ?? ledgers.promptLedger.fragmentCount ?? '—'}
                  {ledgers.promptLedger.initialFragmentCount !== undefined ? ` / ${ledgers.promptLedger.initialFragmentCount}` : ''}
                </strong>
              </div>
            </div>

            {ledgers.loading.build && ledgers.promptLedger.source !== 'build' ? (
              <p className={styles.empty}>{props.t('observation.loading')}</p>
            ) : ledgers.errors.build ? (
              <p className={styles.errorBox}>{props.t('observation.buildError')}</p>
            ) : ledgers.promptLedger.sections.length > 0 ? (
              <div className={styles.itemList}>
                {ledgers.promptLedger.sections.map(section => (
                  <div className={styles.card} key={section.id} data-inactive={!section.active || undefined}>
                    <div className={styles.cardTop}>
                      <strong>{section.title}</strong>
                      <span className={styles.badge} data-tone={section.active ? 'success' : 'neutral'}>
                        {section.active ? 'active' : 'inactive'}
                      </span>
                    </div>
                    <div className={styles.cardMeta}>
                      {section.path && <span className={styles.mono}>{section.path}</span>}
                      {section.activationKind && <span>{section.activationKind}</span>}
                      <span>{section.fragmentCount} frags</span>
                      <span>~{formatNumber(section.estimatedTokens)} tok</span>
                    </div>
                    <p className={styles.messageText}>{section.reason}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.empty}>
                {ledgers.promptLedger.source === 'preview'
                  ? 'Showing live preview metrics; run a turn to capture full ObservationBuild sections.'
                  : 'No ObservationBuild projection recorded for this selection.'}
              </p>
            )}

            {ledgers.promptLedger.buildEntry && (
              <ObservationRawData
                title="ObservationBuild Trace"
                value={{
                  buildId: ledgers.promptLedger.buildId,
                  status: ledgers.promptLedger.status,
                  trace: ledgers.promptLedger.buildEntry.build?.promptBuildTrace,
                  toolTrace: ledgers.promptLedger.buildEntry.build?.toolPromptBuildTrace,
                  macroInspection: ledgers.promptLedger.buildEntry.build?.macroInspection,
                }}
                t={props.t}
              />
            )}
          </article>
        )}

        {(view === 'all' || view === 'calls') && (
          <article className={styles.ledger} data-ledger="calls">
            <header className={styles.ledgerHeader}>
              <h3><Cpu size={14} aria-hidden="true" />Model Calls</h3>
              <span className={styles.ledgerCount}>{ledgers.modelCalls.length} calls</span>
            </header>

            <div className={styles.metricsRow}>
              <div className={styles.metric}>
                <small>Calls</small>
                <strong>{ledgers.modelCalls.length}</strong>
              </div>
              <div className={styles.metric}>
                <small>Latency</small>
                <strong>{ledgers.modelCalls.length > 0 ? formatLatencyMs(totalCallLatencyMs) : '—'}</strong>
              </div>
              <div className={styles.metric}>
                <small>In / Out Tok</small>
                <strong>{formatNumber(totalInputTokens)} / {formatNumber(totalOutputTokens)}</strong>
              </div>
            </div>

            {ledgers.loading.calls && ledgers.modelCalls.length === 0 ? (
              <p className={styles.empty}>{props.t('observation.loading')}</p>
            ) : ledgers.errors.calls ? (
              <p className={styles.errorBox}>{props.t('observation.readError')}</p>
            ) : ledgers.modelCalls.length > 0 ? (
              <div className={styles.itemList}>
                {ledgers.modelCalls.map(call => (
                  <div className={styles.card} key={call.id}>
                    <div className={styles.cardTop}>
                      <strong>{call.step !== undefined ? `#${call.step} · ` : ''}{call.model ?? call.title}</strong>
                      <span className={styles.badge} data-tone={statusTone(call.status)}>
                        {call.status}
                      </span>
                    </div>
                    <div className={styles.cardMeta}>
                      <span>{call.provider ?? call.capability ?? 'provider'}</span>
                      <span>finish: {call.finishReason ?? call.phase ?? '—'}</span>
                      <span>{formatLatencyMs(call.durationMs)}</span>
                      {call.firstOutputMs !== undefined && <span>TTFT: {formatLatencyMs(call.firstOutputMs)}</span>}
                    </div>
                    <div className={styles.cardMeta}>
                      <span>in: {call.inputTokens !== undefined ? formatNumber(call.inputTokens) : '—'}</span>
                      <span>out: {call.outputTokens !== undefined ? formatNumber(call.outputTokens) : '—'}</span>
                      {call.estimatedTokens !== undefined && <span>est: {formatNumber(call.estimatedTokens)}</span>}
                      {call.toolCount > 0 && <span>tools: {call.toolCount}</span>}
                    </div>
                    {call.diagnostic && <p className={styles.errorBox}>{call.diagnostic}</p>}
                    <ObservationRawData
                      title="Call JSON"
                      value={call.raw}
                      t={props.t}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.empty}>No correlated model calls recorded for this run.</p>
            )}
          </article>
        )}

        {(view === 'all' || view === 'diagnostics') && (
          <article className={styles.ledger} data-ledger="diagnostics">
            <header className={styles.ledgerHeader}>
              <h3><Activity size={14} aria-hidden="true" />Diagnostics & Logs</h3>
              <span className={styles.ledgerCount}>{ledgers.diagnosticLogLedger.length} entries</span>
            </header>

            <div className={styles.metricsRow}>
              <div className={styles.metric}>
                <small>Errors</small>
                <strong>{errorCount}</strong>
              </div>
              <div className={styles.metric}>
                <small>Warnings</small>
                <strong>{warningCount}</strong>
              </div>
              <div className={styles.metric}>
                <small>Total</small>
                <strong>{ledgers.diagnosticLogLedger.length}</strong>
              </div>
            </div>

            {ledgers.loading.logs && ledgers.diagnosticLogLedger.length === 0 ? (
              <p className={styles.empty}>{props.t('observation.loading')}</p>
            ) : ledgers.errors.logs ? (
              <p className={styles.errorBox}>{props.t('observation.readError')}</p>
            ) : ledgers.diagnosticLogLedger.length > 0 ? (
              <div className={styles.itemList}>
                {ledgers.diagnosticLogLedger.map(item => (
                  <div className={styles.card} key={item.id}>
                    <div className={styles.cardTop}>
                      <strong>{item.code ?? item.source}</strong>
                      <span className={styles.badge} data-tone={statusTone(item.severity)}>
                        {item.kind} · {item.severity}
                      </span>
                    </div>
                    <div className={styles.cardMeta}>
                      <span>{item.source}</span>
                      {item.timestamp && <time>{new Date(item.timestamp).toLocaleTimeString()}</time>}
                    </div>
                    <p className={styles.messageText}>{item.message}</p>
                    <ObservationRawData
                      title="Entry JSON"
                      value={item.raw}
                      t={props.t}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.empty}>No correlated diagnostics or logs for this run.</p>
            )}
          </article>
        )}
      </div>
    </section>
  )
}
