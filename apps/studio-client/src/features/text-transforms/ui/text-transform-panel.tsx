import { useEffect, useMemo, useState } from 'react'
import { Filter, Layers, Play, Plus, RefreshCw, Scissors, Sparkles, Trash2, Wand2 } from 'lucide-react'
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

type SelectedTarget =
  | { kind: 'rule'; id: string }
  | { kind: 'extractor'; id: string }
  | { kind: 'dry-run' }
  | { kind: 'renderers' }

export function TextTransformPanel(props: Props) {
  const [rules, setRules] = useState<TextTransformRule[]>([])
  const [extractors, setExtractors] = useState<TextExtractor[]>([])
  const [renderers, setRenderers] = useState<RendererDefinition[]>([])
  const [selectedTarget, setSelectedTarget] = useState<SelectedTarget>({ kind: 'dry-run' })
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
      if (ruleResult.rules.length > 0 && selectedTarget.kind === 'dry-run') {
        const firstRule = ruleResult.rules[0]
        setSelectedRuleId(firstRule.id)
        setRuleText(JSON.stringify(toRuleDraft(firstRule), null, 2))
        setSelectedTarget({ kind: 'rule', id: firstRule.id })
      }
      setError('')
    } catch (cause) { setError(readError(cause)) }
  }

  useEffect(() => { void refresh() }, [])

  function selectRule(id: string) {
    setSelectedRuleId(id)
    setSelectedTarget({ kind: 'rule', id })
    const selected = rules.find(rule => rule.id === id)
    setRuleText(selected ? JSON.stringify(toRuleDraft(selected), null, 2) : defaultRuleText)
  }

  function startNewRule() {
    const newId = `rule-${Date.now().toString(36)}`
    setSelectedRuleId(newId)
    setSelectedTarget({ kind: 'rule', id: newId })
    setRuleText(defaultRuleText)
  }

  function selectExtractor(id: string) {
    setSelectedExtractorId(id)
    setSelectedTarget({ kind: 'extractor', id })
    const selected = extractors.find(extractor => extractor.id === id)
    setExtractorText(selected ? JSON.stringify(toExtractorDraft(selected), null, 2) : defaultExtractorText)
  }

  function startNewExtractor() {
    const newId = `extractor-${Date.now().toString(36)}`
    setSelectedExtractorId(newId)
    setSelectedTarget({ kind: 'extractor', id: newId })
    setExtractorText(defaultExtractorText)
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

  function formatJson(text: string, setter: (val: string) => void) {
    try {
      const parsed = JSON.parse(text)
      setter(JSON.stringify(parsed, null, 2))
      setError('')
    } catch (cause) {
      setError(`JSON 语法错误: ${readError(cause)}`)
    }
  }

  return (
    <section className={styles.panel} data-loom-component="text-transform-panel">
      <header className={styles.intro}>
        <div>
          <h2>History Text Pipeline</h2>
          <p>统一管理 Narrative / Agent Session 的正则替换、提取器与渲染器。</p>
        </div>
        <button className={styles.refreshButton} type="button" onClick={() => void refresh()}>
          <RefreshCw aria-hidden="true" size={14} />
          <span>刷新</span>
        </button>
      </header>

      {error ? <div className={styles.errorBanner}>{error}</div> : null}

      <div className={styles.workbench}>
        <nav aria-label="Pipeline Navigation" className={styles.masterNav}>
          <div className={styles.navGroup}>
            <header>
              <span>Replace / Classify Rules</span>
              <button className={styles.navAddBtn} title="新建 Rule" type="button" onClick={startNewRule}>
                <Plus aria-hidden="true" size={14} />
              </button>
            </header>
            {finalOrder.map(rule => (
              <button
                key={rule.id}
                aria-current={selectedTarget.kind === 'rule' && selectedTarget.id === rule.id ? 'page' : undefined}
                className={styles.navItem}
                type="button"
                onClick={() => selectRule(rule.id)}
              >
                <Scissors aria-hidden="true" />
                <span className={styles.navItemBody}>
                  <strong>{rule.name}</strong>
                  <small>{rule.owner.kind} · {rule.enabled ? '启用' : '禁用'}</small>
                </span>
                <span className={styles.orderBadge}>{rule.orderIndex}</span>
              </button>
            ))}
            {rules.length === 0 ? (
              <button
                aria-current={selectedTarget.kind === 'rule' ? 'page' : undefined}
                className={styles.navItem}
                type="button"
                onClick={startNewRule}
              >
                <Plus aria-hidden="true" />
                <span className={styles.navItemBody}>
                  <strong>新建 Rule</strong>
                  <small>点击创建新的替换/分类规则</small>
                </span>
              </button>
            ) : null}
          </div>

          <div className={styles.navGroup}>
            <header>
              <span>Text Extractors</span>
              <button className={styles.navAddBtn} title="新建 Extractor" type="button" onClick={startNewExtractor}>
                <Plus aria-hidden="true" size={14} />
              </button>
            </header>
            {extractors.map(extractor => (
              <button
                key={extractor.id}
                aria-current={selectedTarget.kind === 'extractor' && selectedTarget.id === extractor.id ? 'page' : undefined}
                className={styles.navItem}
                type="button"
                onClick={() => selectExtractor(extractor.id)}
              >
                <Filter aria-hidden="true" />
                <span className={styles.navItemBody}>
                  <strong>{extractor.name}</strong>
                  <small>{extractor.strategy} · {extractor.parser}</small>
                </span>
              </button>
            ))}
            {extractors.length === 0 ? (
              <button
                aria-current={selectedTarget.kind === 'extractor' ? 'page' : undefined}
                className={styles.navItem}
                type="button"
                onClick={startNewExtractor}
              >
                <Plus aria-hidden="true" />
                <span className={styles.navItemBody}>
                  <strong>新建 Extractor</strong>
                  <small>点击创建新的文本提取器</small>
                </span>
              </button>
            ) : null}
          </div>

          <div className={styles.navGroup}>
            <header>调试与扩展</header>
            <button
              aria-current={selectedTarget.kind === 'dry-run' ? 'page' : undefined}
              className={styles.navItem}
              type="button"
              onClick={() => setSelectedTarget({ kind: 'dry-run' })}
            >
              <Sparkles aria-hidden="true" />
              <span className={styles.navItemBody}>
                <strong>History Dry Run</strong>
                <small>实时试运行与提取槽位调试</small>
              </span>
            </button>
            <button
              aria-current={selectedTarget.kind === 'renderers' ? 'page' : undefined}
              className={styles.navItem}
              type="button"
              onClick={() => setSelectedTarget({ kind: 'renderers' })}
            >
              <Layers aria-hidden="true" />
              <span className={styles.navItemBody}>
                <strong>Renderer Registry</strong>
                <small>{renderers.length} 个渲染器贡献</small>
              </span>
            </button>
          </div>
        </nav>

        <div className={styles.detailPane}>
          {selectedTarget.kind === 'rule' ? (
            <>
              <header className={styles.detailHeader}>
                <div className={styles.headerTitle}>
                  <Scissors aria-hidden="true" size={16} />
                  <h3>Replace / Classify Rule</h3>
                  <input
                    className={styles.inlineInput}
                    placeholder="Document ID"
                    value={selectedRuleId}
                    onChange={event => {
                      setSelectedRuleId(event.target.value)
                      setSelectedTarget({ kind: 'rule', id: event.target.value })
                    }}
                  />
                </div>
                <div className={styles.headerActions}>
                  <button className={styles.secondaryButton} type="button" onClick={() => formatJson(ruleText, setRuleText)}>
                    <Wand2 aria-hidden="true" size={13} />
                    <span>格式化</span>
                  </button>
                  {rules.some(item => item.id === selectedRuleId) ? (
                    <button
                      className={styles.dangerButton}
                      type="button"
                      onClick={() => void props.api.deleteRule({
                        ruleId: selectedRuleId,
                        expectedVersion: rules.find(rule => rule.id === selectedRuleId)?.version,
                      }).then(refresh).catch(cause => setError(readError(cause)))}
                    >
                      <Trash2 aria-hidden="true" size={13} />
                      <span>删除</span>
                    </button>
                  ) : null}
                  <button
                    className={styles.primaryButton}
                    disabled={!selectedRuleId.trim()}
                    type="button"
                    onClick={() => void saveRule()}
                  >
                    <span>保存 Rule</span>
                  </button>
                </div>
              </header>
              <div className={styles.editorContainer}>
                <textarea
                  className={styles.rawJsonTextarea}
                  spellCheck={false}
                  value={ruleText}
                  onChange={event => setRuleText(event.target.value)}
                />
              </div>
            </>
          ) : selectedTarget.kind === 'extractor' ? (
            <>
              <header className={styles.detailHeader}>
                <div className={styles.headerTitle}>
                  <Filter aria-hidden="true" size={16} />
                  <h3>Text Extractor</h3>
                  <input
                    className={styles.inlineInput}
                    placeholder="Document ID"
                    value={selectedExtractorId}
                    onChange={event => {
                      setSelectedExtractorId(event.target.value)
                      setSelectedTarget({ kind: 'extractor', id: event.target.value })
                    }}
                  />
                </div>
                <div className={styles.headerActions}>
                  <button className={styles.secondaryButton} type="button" onClick={() => formatJson(extractorText, setExtractorText)}>
                    <Wand2 aria-hidden="true" size={13} />
                    <span>格式化</span>
                  </button>
                  {extractors.some(item => item.id === selectedExtractorId) ? (
                    <button
                      className={styles.dangerButton}
                      type="button"
                      onClick={() => void props.api.deleteExtractor({
                        extractorId: selectedExtractorId,
                        expectedVersion: extractors.find(item => item.id === selectedExtractorId)?.version,
                      }).then(refresh).catch(cause => setError(readError(cause)))}
                    >
                      <Trash2 aria-hidden="true" size={13} />
                      <span>删除</span>
                    </button>
                  ) : null}
                  <button
                    className={styles.primaryButton}
                    disabled={!selectedExtractorId.trim()}
                    type="button"
                    onClick={() => void saveExtractor()}
                  >
                    <span>保存 Extractor</span>
                  </button>
                </div>
              </header>
              <div className={styles.editorContainer}>
                <textarea
                  className={styles.rawJsonTextarea}
                  spellCheck={false}
                  value={extractorText}
                  onChange={event => setExtractorText(event.target.value)}
                />
              </div>
            </>
          ) : selectedTarget.kind === 'dry-run' ? (
            <>
              <header className={styles.detailHeader}>
                <div className={styles.headerTitle}>
                  <Sparkles aria-hidden="true" size={16} />
                  <h3>History Dry Run</h3>
                  <select
                    className={styles.inlineInput}
                    value={phase}
                    onChange={event => setPhase(event.target.value as typeof phase)}
                  >
                    <option value="classify">Phase: Classify</option>
                    <option value="prompt">Phase: Prompt</option>
                    <option value="display">Phase: Display</option>
                  </select>
                </div>
                <div className={styles.headerActions}>
                  <button
                    className={styles.secondaryButton}
                    disabled={!props.source}
                    type="button"
                    onClick={() => void dryRun()}
                  >
                    <Play aria-hidden="true" size={13} />
                    <span>运行当前 History</span>
                  </button>
                  <button
                    className={styles.primaryButton}
                    disabled={!props.source || !selectedExtractorId}
                    type="button"
                    onClick={() => void runExtractor()}
                  >
                    <Filter aria-hidden="true" size={13} />
                    <span>运行所选 Extractor</span>
                  </button>
                </div>
              </header>
              <div className={styles.editorContainer}>
                <pre className={styles.dryRunOutput}>
                  {projection
                    ? JSON.stringify(projection, null, 2)
                    : props.source
                      ? '尚未运行，点击右上角“运行当前 History”触发'
                      : '当前没有活跃的 Narrative Timeline 或 Agent Session'}
                </pre>
                {extraction ? (
                  <ArtifactSlotHost
                    artifacts={[{ id: 'dry-run-extraction', artifactType: 'application/json', content: extraction as never }]}
                    renderers={renderers}
                    surface="shell.workspace-panel"
                  />
                ) : null}
              </div>
            </>
          ) : (
            <>
              <header className={styles.detailHeader}>
                <div className={styles.headerTitle}>
                  <Layers aria-hidden="true" size={16} />
                  <h3>Renderer Registry</h3>
                </div>
              </header>
              <div className={styles.editorContainer}>
                {renderers.length === 0 ? (
                  <p style={{ color: 'var(--loom-color-text-subtle)', fontSize: '13px' }}>暂无已注册渲染器</p>
                ) : (
                  <div className={styles.rendererGrid}>
                    {renderers.map(renderer => (
                      <div key={renderer.id} className={styles.rendererCard}>
                        <strong>{renderer.name}</strong>
                        <small>Surface: {renderer.surface}</small>
                        <small>Scope: {renderer.instanceScope}</small>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
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

