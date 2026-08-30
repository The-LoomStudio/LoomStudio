import { useEffect, useMemo, useState } from 'react'
import type {
  HistoryProjectionSnapshot,
  HistorySource,
  RendererDefinition,
  TextExtractor,
  TextExtractorDraft,
  TextTransformRule,
  TextTransformRuleDraft,
} from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import styles from './text-transform-panel.module.scss'
import { ArtifactSlotHost } from './artifact-slot-host.js'

type Props = {
  api: StudioApi['textTransforms']
  source?: HistorySource
}

export function TextTransformPanel(props: Props) {
  const [rules, setRules] = useState<TextTransformRule[]>([])
  const [extractors, setExtractors] = useState<TextExtractor[]>([])
  const [renderers, setRenderers] = useState<RendererDefinition[]>([])
  const [selectedRuleId, setSelectedRuleId] = useState('')
  const [selectedExtractorId, setSelectedExtractorId] = useState('')
  const [ruleText, setRuleText] = useState(defaultRuleText)
  const [extractorText, setExtractorText] = useState(defaultExtractorText)
  const [projection, setProjection] = useState<HistoryProjectionSnapshot>()
  const [extraction, setExtraction] = useState<unknown>()
  const [phase, setPhase] = useState<'classify' | 'prompt' | 'display'>('display')
  const [error, setError] = useState('')

  const finalOrder = useMemo(() => [...rules].sort((left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id)), [rules])

  async function refresh() {
    try {
      const [ruleResult, extractorResult, rendererResult] = await Promise.all([
        props.api.listRules(), props.api.listExtractors(), props.api.listRenderers(),
      ])
      setRules(ruleResult.rules)
      setExtractors(extractorResult.extractors)
      setRenderers(rendererResult.renderers)
      setError('')
    } catch (cause) { setError(readError(cause)) }
  }

  useEffect(() => { void refresh() }, [])

  function selectRule(id: string) {
    setSelectedRuleId(id)
    const selected = rules.find(rule => rule.id === id)
    setRuleText(selected ? JSON.stringify(toRuleDraft(selected), null, 2) : defaultRuleText)
  }

  function selectExtractor(id: string) {
    setSelectedExtractorId(id)
    const selected = extractors.find(extractor => extractor.id === id)
    setExtractorText(selected ? JSON.stringify(toExtractorDraft(selected), null, 2) : defaultExtractorText)
  }

  async function saveRule() {
    try {
      const existing = rules.find(rule => rule.id === selectedRuleId)
      await props.api.upsertRule({
        ruleId: selectedRuleId,
        ...(existing ? { expectedVersion: existing.version } : {}),
        rule: JSON.parse(ruleText) as TextTransformRuleDraft,
      })
      await refresh()
    } catch (cause) { setError(readError(cause)) }
  }

  async function saveExtractor() {
    try {
      const existing = extractors.find(extractor => extractor.id === selectedExtractorId)
      await props.api.upsertExtractor({
        extractorId: selectedExtractorId,
        ...(existing ? { expectedVersion: existing.version } : {}),
        extractor: JSON.parse(extractorText) as TextExtractorDraft,
      })
      await refresh()
    } catch (cause) { setError(readError(cause)) }
  }

  async function dryRun() {
    if (!props.source) return
    try {
      setProjection((await props.api.project({ source: props.source, phase })).snapshot)
      setError('')
    } catch (cause) { setError(readError(cause)) }
  }

  async function runExtractor() {
    if (!props.source || !selectedExtractorId) return
    try {
      const result = await props.api.extract({ source: props.source, phase, extractorId: selectedExtractorId })
      setProjection(result.snapshot)
      setExtraction(result.extraction)
      setError('')
    } catch (cause) { setError(readError(cause)) }
  }

  return <section className={styles.panel}>
    <header><div><h2>History Text Pipeline</h2><p>统一管理 Narrative / Agent Session 的规则、提取器和渲染器。</p></div><button type="button" onClick={() => void refresh()}>刷新</button></header>
    {error ? <p className={styles.error}>{error}</p> : null}
    <section className={styles.block}>
      <h3>最终 Rule 顺序</h3>
      <ol>{finalOrder.map(rule => <li key={rule.id}><code>{rule.orderIndex}</code> {rule.name} <small>{rule.owner.kind} · {rule.enabled ? 'enabled' : 'disabled'}</small></li>)}</ol>
    </section>
    <section className={styles.grid}>
      <Editor title="Replace / Classify Rule" selectedId={selectedRuleId} items={rules} text={ruleText} onSelect={selectRule} onId={setSelectedRuleId} onText={setRuleText} onSave={() => void saveRule()} onDelete={() => void props.api.deleteRule({ ruleId: selectedRuleId, expectedVersion: rules.find(rule => rule.id === selectedRuleId)?.version }).then(refresh).catch(cause => setError(readError(cause)))} />
      <Editor title="Text Extractor" selectedId={selectedExtractorId} items={extractors} text={extractorText} onSelect={selectExtractor} onId={setSelectedExtractorId} onText={setExtractorText} onSave={() => void saveExtractor()} onDelete={() => void props.api.deleteExtractor({ extractorId: selectedExtractorId, expectedVersion: extractors.find(item => item.id === selectedExtractorId)?.version }).then(refresh).catch(cause => setError(readError(cause)))} />
    </section>
    <section className={styles.block}>
      <h3>History Dry Run</h3>
      <div className={styles.actions}><select value={phase} onChange={event => setPhase(event.target.value as typeof phase)}><option value="classify">Classify</option><option value="prompt">Prompt</option><option value="display">Display</option></select><button disabled={!props.source} type="button" onClick={() => void dryRun()}>运行当前 History</button><button disabled={!props.source || !selectedExtractorId} type="button" onClick={() => void runExtractor()}>运行所选 Extractor</button></div>
      <pre>{projection ? JSON.stringify(projection, null, 2) : props.source ? '尚未运行' : '当前没有可用的 Narrative / Agent Session'}</pre>
      {extraction ? <ArtifactSlotHost surface="shell.workspace-panel" renderers={renderers} artifacts={[{ id: 'dry-run-extraction', artifactType: 'application/json', content: extraction as never }]} /> : null}
    </section>
    <section className={styles.block}><h3>Renderer Registry</h3>{renderers.map(renderer => <p key={renderer.id}><strong>{renderer.name}</strong> · {renderer.surface} · {renderer.instanceScope}</p>)}</section>
  </section>
}

function Editor(props: { title: string; selectedId: string; items: Array<{ id: string; name: string }>; text: string; onSelect(id: string): void; onId(id: string): void; onText(text: string): void; onSave(): void; onDelete(): void }) {
  return <section className={styles.block}><h3>{props.title}</h3><select value={props.selectedId} onChange={event => props.onSelect(event.target.value)}><option value="">新建或选择</option>{props.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input placeholder="Document ID" value={props.selectedId} onChange={event => props.onId(event.target.value)} /><textarea rows={18} spellCheck={false} value={props.text} onChange={event => props.onText(event.target.value)} /><div className={styles.actions}><button disabled={!props.selectedId} type="button" onClick={props.onSave}>保存</button><button disabled={!props.items.some(item => item.id === props.selectedId)} type="button" onClick={props.onDelete}>删除</button></div></section>
}

function toRuleDraft(rule: TextTransformRule): TextTransformRuleDraft {
  const draft = { ...rule } as Record<string, unknown>
  delete draft.id
  delete draft.version
  delete draft.createdAt
  delete draft.updatedAt
  return draft as TextTransformRuleDraft
}
function toExtractorDraft(extractor: TextExtractor): TextExtractorDraft {
  const draft = { ...extractor } as Record<string, unknown>
  delete draft.id
  delete draft.version
  delete draft.createdAt
  delete draft.updatedAt
  return draft as TextExtractorDraft
}
function readError(value: unknown): string { return value instanceof Error ? value.message : String(value) }

const defaultRuleText = JSON.stringify({ name: 'Hide marker', owner: { kind: 'workspace' }, enabled: true, orderIndex: 0, matcher: { kind: 'regex', pattern: '<marker>[\\s\\S]*?</marker>', flags: 'g' }, effect: { kind: 'replace', replacement: '' }, targets: ['narrative', 'agent-session'], phases: ['prompt', 'display'] }, null, 2)
const defaultExtractorText = JSON.stringify({ name: 'World State', owner: { kind: 'workspace' }, enabled: true, orderIndex: 0, targets: ['narrative', 'agent-session'], matcher: { kind: 'regex', pattern: '<WorldState>([\\s\\S]*?)</WorldState>', flags: 'g', contentGroup: 1 }, strategy: 'latest-valid', parser: 'key-value-lines' }, null, 2)
