import { useState } from 'react'
import type { Translator } from '../../../shared/i18n/index.js'
import { MarkdownCodeBlock } from '../../../shared/ui/markdown-content/markdown-code-block.js'
import styles from './observability-workbench.module.scss'
import markdownStyles from '../../../shared/ui/markdown-content/markdown-content.module.scss'
import { ObservationDialogButton } from './observation-dialog.js'

export function evidenceObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

export function ToolArguments({ value, t }: { value: unknown; t: Translator }) {
  const parsed = parseArguments(value)
  const fields = evidenceObject(parsed)
  if (typeof fields?.rawInput === 'string') return <EvidenceValue value={fields.rawInput} field={fields.toolId === 'official/codeact' ? 'code' : undefined} t={t} />
  const args = fields && 'arguments' in fields ? parseArguments(fields.arguments) : parsed
  return <EvidenceValue value={args} t={t} />
}

export function EvidenceValue({ value, t, field }: { value: unknown; t: Translator; field?: string }) {
  if (typeof value === 'string') {
    if (field === 'code') return <div className={`${markdownStyles.content} ${styles.codeReader}`}><MarkdownCodeBlock code={value} language="javascript" labels={{ copy: t('observation.copy'), copied: t('observation.copied'), copyFailed: t('observation.copyFailed'), enableWrap: t('markdown.code.enableWrap'), disableWrap: t('markdown.code.disableWrap') }} /></div>
    return <ReadableText text={value} t={t} />
  }
  if (value === undefined) return <p className={styles.hint}>{t('observation.missing')}</p>
  if (value === null || typeof value !== 'object') return <span>{String(value)}</span>
  const fields = Object.entries(value)
  if (!fields.length) return <span className={styles.hint}>{Array.isArray(value) ? '[]' : '{}'}</span>
  return <dl className={styles.evidenceFields}>{fields.map(([key, item]) => <div key={key}>
    <dt>{Array.isArray(value) ? Number(key) + 1 : key}</dt><dd>{item !== null && typeof item === 'object' ? <NestedValue value={item} t={t} /> : <EvidenceValue value={item} field={key} t={t} />}</dd>
  </div>)}</dl>
}

function NestedValue({ value, t }: { value: object; t: Translator }) {
  const [open, setOpen] = useState(false)
  return <details className={styles.nestedValue} onToggle={event => setOpen(event.currentTarget.open)}><summary>{t('observation.dataItems', { count: Object.keys(value).length })}</summary>{open && <EvidenceValue value={value} t={t} />}</details>
}

export function ReadableText({ text, t, defaultExpanded = false }: { text: string; t: Translator; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const long = text.length > 1400 || text.split('\n').length > 18
  return <div><div className={`${styles.readableText} ${long && !expanded ? styles.clamped : ''}`}>{text}</div>{long && <button type="button" className={styles.textButton} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{t(expanded ? 'observation.collapseText' : 'observation.expandText')}</button>}</div>
}

export function ToolResult({ value, t }: { value: unknown; t: Translator }) {
  const result = evidenceObject(value)
  if (!result) return <EvidenceValue value={value} t={t} />
  const blocks = Array.isArray(result.content) ? result.content : undefined
  return <div className={styles.toolResult}>
    {result.error !== undefined && <div className={styles.toolError}><EvidenceValue value={result.error} t={t} /></div>}
    {blocks ? blocks.map((block, index) => {
      const item = evidenceObject(block)
      if (item?.type === 'text' && typeof item.text === 'string') return <ResultContent key={index} value={parseArguments(item.text)} t={t} />
      return <EvidenceValue key={index} value={block} t={t} />
    }) : result.error === undefined ? <ResultContent value={value} t={t} /> : null}
  </div>
}

function ResultContent({ value, t }: { value: unknown; t: Translator }) {
  const result = evidenceObject(value)
  if (!result || typeof result.text !== 'string') return <EvidenceValue value={value} t={t} />
  const { text, ...remaining } = result
  const nodes = Array.isArray(result.nodes) ? result.nodes : undefined
  // Only the recorded NarrativeSampleResult shape gives these fields a known identity role.
  const narrative = typeof result.timelineId === 'string' && typeof result.branchId === 'string' && nodes !== undefined && typeof result.complete === 'boolean'
  const identityFields = ['timelineId', 'branchId', 'readHeadNodeId', 'throughNodeId', 'afterNodeId']
  const identity = narrative ? Object.fromEntries(Object.entries(remaining).filter(([key]) => identityFields.includes(key))) : {}
  const fields = narrative ? Object.fromEntries(Object.entries(remaining).filter(([key]) => !identityFields.includes(key) && key !== 'nodes' && key !== 'complete')) : remaining
  return <div className={styles.toolResult}>
    <ReadableText text={text} t={t} />
    {!!Object.keys(fields).length && <EvidenceValue value={fields} t={t} />}
    {narrative && <div className={styles.resultDetails}>
      <small>{t(result.complete ? 'observation.readComplete' : 'observation.readPartial')}</small>
      <ObservationDialogButton title={t('observation.resultNodes', { count: nodes.length })} t={t}>{() => <ol className={styles.resultNodes}>{nodes.map((node, index) => <li key={index}><ResultContent value={node} t={t} /></li>)}</ol>}</ObservationDialogButton>
      <ObservationDialogButton title={t('observation.resultLocation')} t={t}>{() => <EvidenceValue value={identity} t={t} />}</ObservationDialogButton>
    </div>}
  </div>
}
