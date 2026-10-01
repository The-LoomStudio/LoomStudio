import type { ContextAssetNode } from '../../../entities/index.js'
import { useResourceTokenCounts } from '../model/use-resource-token-counts.js'
import type { Translator } from '../../../shared/i18n/index.js'
import styles from './resource-token-summary.module.scss'
import { useTokenDisplaySettings } from '../../../shared/tokenizer/settings.js'
import { Calculator } from 'lucide-react'
import type { ResourceTokenSnapshot } from '../model/use-resource-token-snapshot.js'
import type { aggregateTokenCounts } from '../model/resource-token-counts.js'
import { useTokenCounts } from '../../../shared/tokenizer/use-token-counts.js'
import { applyTokenMultiplier } from '@loom-studio/tokenizer/contracts'

export function ResourceTokenSummary(props: { roots: ContextAssetNode[]; scope: string; t: Translator; incomplete?: boolean }) {
  const multiplier = useTokenDisplaySettings(state => state.multiplier)
  const result = useResourceTokenCounts(props.roots, props.scope, multiplier)
  const summary = result.summary ?? result.previousSummary
  return <TokenSummary t={props.t} summary={summary} pending={result.pending} error={result.error}
    multiplier={multiplier} incomplete={props.incomplete} />
}

export function TokenSummary(props: {
  t: Translator
  summary?: ReturnType<typeof aggregateTokenCounts>
  pending?: boolean
  error?: string
  multiplier?: number
  incomplete?: boolean
  textTokens?: number
}) {
  const { summary } = props
  return <span className={styles.summary}
    title={`o200k_base × ${props.multiplier ?? 1} · gpt-tokenizer 4.0.0 · ${props.t('tokens.rawBasis')}`}>
    <span>Tokens {props.error ? <span role="alert">{props.error}</span>
      : props.textTokens !== undefined ? `${props.textTokens.toLocaleString()}${props.pending ? ` · ${props.t('tokens.pending')}` : ''}`
      : summary ? `${summary.enabled.toLocaleString()} · ${props.t('tokens.resident')} ${summary.resident.toLocaleString()} · ${props.t('tokens.nonresident')} ${summary.nonresident.toLocaleString()}${props.pending ? ` · ${props.t('tokens.pending')}` : ''}`
        : props.t('tokens.pending')}{props.incomplete ? ` · ${props.t('tokens.incomplete')}` : ''}</span>
  </span>
}

export function TextTokenSummary(props: { text: string; scope: string; t: Translator }) {
  const multiplier = useTokenDisplaySettings(state => state.multiplier)
  const result = useTokenCounts([props.text], props.scope)
  return <TokenSummary t={props.t} multiplier={multiplier} pending={result.pending} error={result.error}
    textTokens={result.counts ? applyTokenMultiplier(result.counts[0]!, multiplier).estimatedTokens : undefined} />
}

export function TokenSnapshotControl(props: { snapshot: ResourceTokenSnapshot; t: Translator; incomplete?: boolean; disabled?: boolean }) {
  return <button type="button" aria-label={props.t('tokens.refresh')} title={props.t('tokens.refresh')}
      disabled={props.disabled || props.snapshot.pending} onClick={props.snapshot.refresh}>
      <Calculator aria-hidden="true" size={16} />
    </button>
}

export function TokenSnapshotSummary(props: { snapshot: ResourceTokenSnapshot; t: Translator; incomplete?: boolean }) {
  return props.snapshot.summary || props.snapshot.pending || props.snapshot.error
    ? <TokenSummary t={props.t} {...props.snapshot} incomplete={props.incomplete} /> : null
}
