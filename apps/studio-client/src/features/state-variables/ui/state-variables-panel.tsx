import { useEffect, useState } from 'react'
import { Code2, Database, FileCode, GitBranch, Globe, Plus, RefreshCw, Trash2, Wand2 } from 'lucide-react'
import type { Card, StateDefinition, StateDefinitionDraft, StateSnapshot, StateTarget } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import styles from './state-variables-panel.module.scss'
import { createSnapshotReplaceInput, parseCardStateConfig, toStateDefinitionDraft } from '../model/state-variable-editor.js'

type Props = {
  api: StudioApi['states']
  card?: Card
  timelineTarget?: Extract<StateTarget, { scope: 'timeline' }>
  refreshToken?: string
  onUpdateCardConfig(input: { stateDefinitionIds: string[]; timelineStateBindings: NonNullable<Card['timelineStateBindings']> }): Promise<void>
}

type SelectedTarget =
  | { kind: 'global' }
  | { kind: 'timeline' }
  | { kind: 'card' }
  | { kind: 'definition'; id: string }

export function StateVariablesPanel(props: Props) {
  const [global, setGlobal] = useState<StateSnapshot>()
  const [timeline, setTimeline] = useState<StateSnapshot>()
  const [definitions, setDefinitions] = useState<StateDefinition[]>([])
  const [selectedTarget, setSelectedTarget] = useState<SelectedTarget>({ kind: 'global' })
  const [definitionId, setDefinitionId] = useState('')
  const [definitionText, setDefinitionText] = useState('')
  const [globalText, setGlobalText] = useState('{}')
  const [timelineText, setTimelineText] = useState('{}')
  const [cardText, setCardText] = useState('{}')
  const [error, setError] = useState('')

  async function refresh() {
    try {
      const [globalResult, definitionResult, timelineResult] = await Promise.all([
        props.api.get({ scope: 'global' }),
        props.api.listDefinitions(),
        props.timelineTarget ? props.api.get(props.timelineTarget) : Promise.resolve(undefined),
      ])
      setGlobal(globalResult.snapshot)
      setGlobalText(JSON.stringify(globalResult.snapshot.value, null, 2))
      setDefinitions(definitionResult.definitions)
      setTimeline(timelineResult?.snapshot)
      setTimelineText(JSON.stringify(timelineResult?.snapshot.value ?? {}, null, 2))
      setCardText(JSON.stringify({
        stateDefinitionIds: props.card?.stateDefinitionIds ?? [],
        timelineStateBindings: props.card?.timelineStateBindings ?? [],
      }, null, 2))
      setError('')
    } catch (cause) {
      setError(readError(cause))
    }
  }

  useEffect(() => { void refresh() }, [props.card?.id, props.timelineTarget?.timelineId, props.timelineTarget?.branchId, props.refreshToken])

  function selectDefinition(id: string) {
    setDefinitionId(id)
    setSelectedTarget({ kind: 'definition', id })
    const definition = definitions.find(item => item.id === id)
    setDefinitionText(definition ? JSON.stringify(toStateDefinitionDraft(definition), null, 2) : '{\n  "name": "",\n  "kind": "object",\n  "initial": {},\n  "schema": {}\n}')
  }

  function startNewDefinition() {
    const newId = `state-def-${Date.now().toString(36)}`
    setDefinitionId(newId)
    setSelectedTarget({ kind: 'definition', id: newId })
    setDefinitionText('{\n  "name": "New State Definition",\n  "kind": "object",\n  "initial": {},\n  "schema": {}\n}')
  }

  async function saveSnapshot(snapshot: StateSnapshot | undefined, text: string) {
    if (!snapshot) return
    try {
      await props.api.apply(createSnapshotReplaceInput(snapshot, text))
      await refresh()
    } catch (cause) { setError(readError(cause)) }
  }

  async function saveDefinition() {
    try {
      const existing = definitions.find(item => item.id === definitionId)
      await props.api.upsertDefinition({
        definitionId,
        ...(existing ? { expectedVersion: existing.version } : {}),
        definition: JSON.parse(definitionText) as StateDefinitionDraft,
      })
      await refresh()
    } catch (cause) { setError(readError(cause)) }
  }

  async function saveCardConfig() {
    try {
      await props.onUpdateCardConfig(parseCardStateConfig(cardText))
      await refresh()
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
    <section className={styles.panel} data-loom-component="state-variables-panel">
      <header className={styles.intro}>
        <div>
          <h2>变量与 State</h2>
          <p>Revision 冲突不会静默覆盖，纯净 JSON 数据模型展示。</p>
        </div>
        <button className={styles.refreshButton} type="button" onClick={() => void refresh()}>
          <RefreshCw aria-hidden="true" size={14} />
          <span>刷新</span>
        </button>
      </header>

      {error ? <div className={styles.errorBanner}>{error}</div> : null}

      <div className={styles.workbench}>
        <nav aria-label="State Navigation" className={styles.masterNav}>
          <div className={styles.navGroup}>
            <header>状态作用域 (Scopes)</header>
            <button
              aria-current={selectedTarget.kind === 'global' ? 'page' : undefined}
              className={styles.navItem}
              type="button"
              onClick={() => setSelectedTarget({ kind: 'global' })}
            >
              <Globe aria-hidden="true" />
              <span className={styles.navItemBody}>
                <strong>Workspace Global State</strong>
                <small>{global?.revisionId ? `rev: ${global.revisionId.slice(0, 8)}` : '未初始化'}</small>
              </span>
            </button>
            <button
              aria-current={selectedTarget.kind === 'timeline' ? 'page' : undefined}
              className={styles.navItem}
              type="button"
              onClick={() => setSelectedTarget({ kind: 'timeline' })}
            >
              <GitBranch aria-hidden="true" />
              <span className={styles.navItemBody}>
                <strong>当前 Timeline / Branch State</strong>
                <small>
                  {props.timelineTarget
                    ? `timeline: ${props.timelineTarget.timelineId} · branch: ${props.timelineTarget.branchId}`
                    : '未绑定 Timeline'}
                </small>
              </span>
            </button>
            <button
              aria-current={selectedTarget.kind === 'card' ? 'page' : undefined}
              className={styles.navItem}
              type="button"
              onClick={() => setSelectedTarget({ kind: 'card' })}
            >
              <Database aria-hidden="true" />
              <span className={styles.navItemBody}>
                <strong>当前 Card Template / Binding</strong>
                <small>{props.card?.name ?? '未选择 Card'}</small>
              </span>
            </button>
          </div>

          <div className={styles.navGroup}>
            <header>
              <span>共享 State Definition</span>
              <button
                className={styles.navAddBtn}
                title="新建 State Definition"
                type="button"
                onClick={startNewDefinition}
              >
                <Plus aria-hidden="true" size={14} />
              </button>
            </header>
            {definitions.length === 0 ? (
              <button
                aria-current={selectedTarget.kind === 'definition' && definitionId ? 'page' : undefined}
                className={styles.navItem}
                type="button"
                onClick={startNewDefinition}
              >
                <Plus aria-hidden="true" />
                <span className={styles.navItemBody}>
                  <strong>新建 Definition</strong>
                  <small>点击创建新的共享定义</small>
                </span>
              </button>
            ) : (
              definitions.map(item => (
                <button
                  key={item.id}
                  aria-current={selectedTarget.kind === 'definition' && selectedTarget.id === item.id ? 'page' : undefined}
                  className={styles.navItem}
                  type="button"
                  onClick={() => selectDefinition(item.id)}
                >
                  <Code2 aria-hidden="true" />
                  <span className={styles.navItemBody}>
                    <strong>{item.label || item.id}</strong>
                    <small>{item.id} · {item.kind}</small>
                  </span>
                </button>
              ))
            )}
          </div>
        </nav>

        <div className={styles.detailPane}>
          {selectedTarget.kind === 'global' ? (
            <>
              <header className={styles.detailHeader}>
                <div className={styles.headerTitle}>
                  <Globe aria-hidden="true" size={16} />
                  <h3>Workspace Global State</h3>
                  <span className={styles.badge}>{global?.revisionId ?? '未初始化'}</span>
                </div>
                <div className={styles.headerActions}>
                  <button className={styles.secondaryButton} type="button" onClick={() => formatJson(globalText, setGlobalText)}>
                    <Wand2 aria-hidden="true" size={13} />
                    <span>格式化</span>
                  </button>
                  <button className={styles.primaryButton} type="button" onClick={() => void saveSnapshot(global, globalText)}>
                    <span>保存 Snapshot</span>
                  </button>
                </div>
              </header>
              <div className={styles.editorContainer}>
                <textarea
                  className={styles.rawJsonTextarea}
                  spellCheck={false}
                  value={globalText}
                  onChange={event => setGlobalText(event.target.value)}
                />
              </div>
            </>
          ) : selectedTarget.kind === 'timeline' ? (
            <>
              <header className={styles.detailHeader}>
                <div className={styles.headerTitle}>
                  <GitBranch aria-hidden="true" size={16} />
                  <h3>当前 Timeline / Branch State</h3>
                  <span className={styles.badge}>{timeline?.revisionId ?? '未初始化'}</span>
                </div>
                <div className={styles.headerActions}>
                  <button
                    className={styles.secondaryButton}
                    disabled={!timeline}
                    type="button"
                    onClick={() => formatJson(timelineText, setTimelineText)}
                  >
                    <Wand2 aria-hidden="true" size={13} />
                    <span>格式化</span>
                  </button>
                  <button
                    className={styles.primaryButton}
                    disabled={!timeline}
                    type="button"
                    onClick={() => void saveSnapshot(timeline, timelineText)}
                  >
                    <span>保存 Snapshot</span>
                  </button>
                </div>
              </header>
              <div className={styles.editorContainer}>
                {props.timelineTarget ? (
                  <div className={styles.scopeBanner}>
                    Timeline {props.timelineTarget.timelineId} · Branch {props.timelineTarget.branchId} · Card {props.card?.id ?? 'unknown'}
                  </div>
                ) : null}
                <textarea
                  className={styles.rawJsonTextarea}
                  disabled={!timeline}
                  spellCheck={false}
                  value={timelineText}
                  onChange={event => setTimelineText(event.target.value)}
                />
              </div>
            </>
          ) : selectedTarget.kind === 'card' ? (
            <>
              <header className={styles.detailHeader}>
                <div className={styles.headerTitle}>
                  <Database aria-hidden="true" size={16} />
                  <h3>当前 Card Template / Binding</h3>
                  <span className={styles.badge}>{props.card?.name ?? '未选择 Card'}</span>
                </div>
                <div className={styles.headerActions}>
                  <button
                    className={styles.secondaryButton}
                    disabled={!props.card}
                    type="button"
                    onClick={() => formatJson(cardText, setCardText)}
                  >
                    <Wand2 aria-hidden="true" size={13} />
                    <span>格式化</span>
                  </button>
                  <button
                    className={styles.primaryButton}
                    disabled={!props.card}
                    type="button"
                    onClick={() => void saveCardConfig()}
                  >
                    <span>保存 Card 配置</span>
                  </button>
                </div>
              </header>
              <div className={styles.editorContainer}>
                <textarea
                  className={styles.rawJsonTextarea}
                  disabled={!props.card}
                  spellCheck={false}
                  value={cardText}
                  onChange={event => setCardText(event.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              <header className={styles.detailHeader}>
                <div className={styles.headerTitle}>
                  <FileCode aria-hidden="true" size={16} />
                  <h3>共享 State Definition</h3>
                  <input
                    className={styles.definitionIdInput}
                    placeholder="Definition ID"
                    value={definitionId}
                    onChange={event => {
                      setDefinitionId(event.target.value)
                      setSelectedTarget({ kind: 'definition', id: event.target.value })
                    }}
                  />
                </div>
                <div className={styles.headerActions}>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={() => formatJson(definitionText, setDefinitionText)}
                  >
                    <Wand2 aria-hidden="true" size={13} />
                    <span>格式化</span>
                  </button>
                  {definitions.some(item => item.id === definitionId) ? (
                    <button
                      className={styles.dangerButton}
                      type="button"
                      onClick={() => void props.api.deleteDefinition({
                        definitionId,
                        expectedVersion: definitions.find(item => item.id === definitionId)?.version,
                      }).then(refresh).catch(cause => setError(readError(cause)))}
                    >
                      <Trash2 aria-hidden="true" size={13} />
                      <span>删除</span>
                    </button>
                  ) : null}
                  <button
                    className={styles.primaryButton}
                    disabled={!definitionId.trim() || !definitionText.trim()}
                    type="button"
                    onClick={() => void saveDefinition()}
                  >
                    <span>保存 Definition</span>
                  </button>
                </div>
              </header>
              <div className={styles.editorContainer}>
                <textarea
                  className={styles.rawJsonTextarea}
                  spellCheck={false}
                  value={definitionText}
                  onChange={event => setDefinitionText(event.target.value)}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function readError(value: unknown): string { return value instanceof Error ? value.message : String(value) }

