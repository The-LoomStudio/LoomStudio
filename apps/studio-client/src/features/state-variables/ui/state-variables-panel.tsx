import { useEffect, useState } from 'react'
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

export function StateVariablesPanel(props: Props) {
  const [global, setGlobal] = useState<StateSnapshot>()
  const [timeline, setTimeline] = useState<StateSnapshot>()
  const [definitions, setDefinitions] = useState<StateDefinition[]>([])
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
    const definition = definitions.find(item => item.id === id)
    setDefinitionText(definition ? JSON.stringify(toStateDefinitionDraft(definition), null, 2) : '')
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

  return (
    <section className={styles.panel}>
      <header><div><h2>变量与 State</h2><p>Revision 冲突不会静默覆盖。</p></div><button type="button" onClick={() => void refresh()}>刷新</button></header>
      {error ? <p className={styles.error}>{error}</p> : null}
      <StateEditor label="Workspace Global State" revisionId={global?.revisionId} text={globalText} onChange={setGlobalText} onSave={() => void saveSnapshot(global, globalText)} />
      <StateEditor label="当前 Timeline / Branch State" revisionId={timeline?.revisionId} text={timelineText} disabled={!timeline} onChange={setTimelineText} onSave={() => void saveSnapshot(timeline, timelineText)} />
      {props.timelineTarget ? <p className={styles.scope}>Timeline {props.timelineTarget.timelineId} · Branch {props.timelineTarget.branchId} · Card {props.card?.id ?? 'unknown'}</p> : null}
      <section className={styles.block}>
        <h3>共享 State Definition</h3>
        <select value={definitionId} onChange={event => selectDefinition(event.target.value)}>
          <option value="">新建或选择 Definition</option>
          {definitions.map(item => <option key={item.id} value={item.id}>{item.id} · {item.kind}</option>)}
        </select>
        <input placeholder="Definition ID" value={definitionId} onChange={event => setDefinitionId(event.target.value)} />
        <textarea rows={12} spellCheck={false} value={definitionText} onChange={event => setDefinitionText(event.target.value)} />
        <div className={styles.actions}>
          <button disabled={!definitionId || !definitionText} type="button" onClick={() => void saveDefinition()}>保存 Definition</button>
          <button disabled={!definitions.some(item => item.id === definitionId)} type="button" onClick={() => void props.api.deleteDefinition({ definitionId, expectedVersion: definitions.find(item => item.id === definitionId)?.version }).then(refresh).catch(cause => setError(readError(cause)))}>删除</button>
        </div>
      </section>
      <section className={styles.block}>
        <h3>当前 Card Template / Binding</h3>
        <p>{props.card?.name ?? '未选择 Card'}</p>
        <textarea disabled={!props.card} rows={10} spellCheck={false} value={cardText} onChange={event => setCardText(event.target.value)} />
        <button disabled={!props.card} type="button" onClick={() => void saveCardConfig()}>保存 Card 配置</button>
      </section>
    </section>
  )
}

function StateEditor(props: { label: string; revisionId?: string; text: string; disabled?: boolean; onChange(value: string): void; onSave(): void }) {
  return <section className={styles.block}><h3>{props.label}</h3><code>{props.revisionId ?? '未初始化'}</code><textarea disabled={props.disabled} rows={10} spellCheck={false} value={props.text} onChange={event => props.onChange(event.target.value)} /><button disabled={props.disabled} type="button" onClick={props.onSave}>保存 Snapshot</button></section>
}

function readError(value: unknown): string { return value instanceof Error ? value.message : String(value) }
