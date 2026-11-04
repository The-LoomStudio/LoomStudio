import { Tabs } from '@loom-studio/ui'
import type { Translator } from '../../../shared/i18n/index.js'
import type { ObservationSource } from '../model/observation-view.js'
import { sourceTokenParts, sumTokenParts, type TokenPart } from '../model/observation-token-view.js'
import styles from './observability-workbench.module.scss'

const colors = ['var(--loom-color-accent)', 'var(--loom-color-success)', 'var(--loom-color-info)', 'var(--loom-color-warning)', 'var(--loom-color-danger)', 'var(--loom-color-text-muted)']

export function ObservationSourceTokens({ sources, counts, pending, error, dimension, filter, onDimensionChange, onFilterChange, t }: { sources: ObservationSource[]; counts: Map<string, number | undefined>; pending: boolean; error?: string; dimension: 'activation' | 'anchors'; filter?: string; onDimensionChange(value: 'activation' | 'anchors'): void; onFilterChange(value?: string): void; t: Translator }) {
  const parts = sourceTokenParts({ sources })
  const total = sumTokenParts(parts, counts)
  const format = (value: number | undefined) => value === undefined ? t('observation.tokenUnknown') : `≈ ${value.toLocaleString()}`
  function groupKey(part: TokenPart) {
    if (dimension === 'anchors') return part.anchor ?? 'unassigned'
    return ['keyword', 'condition', 'all'].includes(part.activation ?? '') ? 'conditional' : part.activation ?? 'unassigned'
  }
  function label(key: string) {
    if (key === 'unassigned') return t('observation.tokens.unassigned')
    if (dimension === 'anchors') return sources.find(source => source.id === key || source.anchorIds?.includes(key))?.anchorIds?.find(id => id.startsWith('@')) ?? key
    if (key === 'always' || key === 'conditional' || key === 'manual') return t(`observation.tokens.${key}`)
    return key
  }
  const grouped = new Map<string, TokenPart[]>()
  parts.forEach(part => { const key = groupKey(part); grouped.set(key, [...(grouped.get(key) ?? []), part]) })
  const groups = [...grouped].map(([key, items]) => ({ key, items, count: sumTokenParts(items, counts) })).sort((a, b) => (b.count ?? -1) - (a.count ?? -1))
  return <section className={styles.tokenOverview} aria-label={t('observation.sourceTokenOverview')}>
    <strong>{t('observation.sourceTokenOverview')}{parts.length > 0 && <> · {format(total)} tokens</>}</strong>
    <p className={styles.hint}>{t('observation.sourceTokenNote')}</p>
    <Tabs size="compact" ariaLabel={t('observation.tokenDimension')} activeId={dimension} onChange={onDimensionChange} items={(['anchors', 'activation'] as const).map(id => ({ id, label: t(`observation.tokens.${id}`) }))} />
    {error ? <p role="status">{t('observation.tokenFailed')} {error}</p> : pending && <small role="status">{t('observation.tokenCounting')}</small>}
    {groups.length ? <>
      <div className={styles.tokenBar} aria-label={t('observation.sourceTokenOverview')}>
        {total !== undefined && total > 0 && groups.map((group, index) => group.count! > 0 && <button type="button" key={group.key} aria-pressed={filter === group.key} onClick={() => onFilterChange(filter === group.key ? undefined : group.key)} style={{ flex: group.count, background: colors[index % colors.length] }} title={`${label(group.key)} · ${format(group.count)} tokens · ${(group.count! / total * 100).toFixed(1)}%`} aria-label={`${label(group.key)} · ${format(group.count)} tokens`} />)}
      </div>
      <div className={styles.tokenLegend}>{groups.map((group, index) => <button type="button" key={group.key} aria-pressed={filter === group.key} onClick={() => onFilterChange(filter === group.key ? undefined : group.key)}><span className={styles.tokenDot} style={{ background: colors[index % colors.length] }} /><span>{label(group.key)}</span><strong>{format(group.count)}</strong><small>{total && group.count !== undefined ? `${(group.count / total * 100).toFixed(1)}%` : '—'}</small></button>)}</div>
    </> : <p className={styles.hint}>{t('observation.tokenSourcesMissing')}</p>}
  </section>
}
