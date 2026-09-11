import { useMemo, useState } from 'react'
import { PipelineWorkbenchView, type PipelineWorkbenchGroup } from '../../features/text-transforms/ui/pipeline-workbench-view.js'
import styles from './component-preview-app.module.scss'

const ownerGroups: PipelineWorkbenchGroup[] = [
  {
    id: 'rules',
    label: 'Rules',
    items: [
      { id: 'rule-status', kind: 'rule', label: '捕获角色状态块', description: 'mark · display', owner: 'Card · 魔法学院', order: 10, status: 'active' },
      { id: 'rule-reasoning', kind: 'rule', label: '提升自定义思维链', description: 'promote-reasoning · classify', owner: 'Preset · Narrative Agent', order: 20, status: 'active' },
    ],
  },
  {
    id: 'extractors',
    label: 'Extractors',
    items: [
      { id: 'extractor-status', kind: 'extractor', label: '角色状态 Artifact', description: 'latest-valid · character/status', owner: 'Card · 魔法学院', status: 'active' },
    ],
  },
  {
    id: 'scripts',
    label: 'Scripts',
    items: [
      { id: 'script-presentation', kind: 'script', label: 'alice-presentation.loom.js', description: '2 renderer contributions', owner: 'Card · 魔法学院', status: 'disabled' },
    ],
  },
]

const effectiveGroups: PipelineWorkbenchGroup[] = [
  {
    id: 'pipeline',
    label: 'Effective Order',
    items: [
      { id: 'rule-status', kind: 'rule', label: '捕获角色状态块', description: 'mark · display', owner: 'Card snapshot · v8', order: 1, status: 'active' },
      { id: 'rule-cleanup', kind: 'rule', label: '清理控制标签', description: 'replace · display', owner: 'Extension · example.echo', order: 2, status: 'active' },
      { id: 'rule-reasoning', kind: 'rule', label: '提升自定义思维链', description: 'promote-reasoning · classify', owner: 'Preset · Narrative Agent', order: 3, status: 'conflict' },
    ],
  },
  {
    id: 'consumers',
    label: 'Consumers',
    items: [
      { id: 'extractor-status', kind: 'extractor', label: '角色状态 Artifact', description: 'character/status', owner: 'Card snapshot · v8', status: 'active' },
      { id: 'renderer-status', kind: 'renderer', label: '状态面板', description: 'narrative.entry.inline', owner: 'alice-presentation · v3', status: 'active' },
      { id: 'renderer-summary', kind: 'renderer', label: '状态摘要', description: 'narrative.timeline.tail', owner: 'alice-presentation · v3', status: 'degraded' },
    ],
  },
]

export function ComponentPreviewApp() {
  const [mode, setMode] = useState<'owner' | 'effective'>('effective')
  const groups = mode === 'owner' ? ownerGroups : effectiveGroups
  const [selectedId, setSelectedId] = useState(groups[0]?.items[0]?.id)
  const [search, setSearch] = useState('')
  const [mobilePane, setMobilePane] = useState<'master' | 'detail'>('master')
  const item = useMemo(() => groups.flatMap(group => group.items).find(candidate => candidate.id === selectedId) ?? groups[0]?.items[0], [groups, selectedId])

  function changeMode(next: 'owner' | 'effective') {
    setMode(next)
    setSelectedId((next === 'owner' ? ownerGroups : effectiveGroups)[0]?.items[0]?.id)
    setMobilePane('master')
  }

  return (
    <main className={styles.page}>
      <header className={styles.toolbar}>
        <strong>Text Pipeline</strong>
        <nav aria-label="Preview mode">
          <button aria-current={mode === 'owner' ? 'page' : undefined} type="button" onClick={() => changeMode('owner')}>Owner</button>
          <button aria-current={mode === 'effective' ? 'page' : undefined} type="button" onClick={() => changeMode('effective')}>Effective</button>
        </nav>
      </header>
      <section className={styles.workbench}>
        <PipelineWorkbenchView
          ariaLabel="Text Pipeline entries"
          backLabel="返回目录"
          detail={<DefinitionDetail item={item} />}
          emptyLabel="没有匹配条目"
          groups={groups}
          mobilePane={mobilePane}
          preview={<PipelinePreview item={item} />}
          searchPlaceholder="搜索名称、来源或能力"
          searchValue={search}
          selectedId={item?.id}
          onMobilePaneChange={setMobilePane}
          onSearchChange={setSearch}
          onSelect={setSelectedId}
        />
      </section>
    </main>
  )
}

function DefinitionDetail(props: { item?: PipelineWorkbenchGroup['items'][number] }) {
  if (!props.item) return <div className={styles.empty}>选择一个条目</div>
  return <div className={styles.definition}>
    <header><div><small>{props.item.kind} · {props.item.owner}</small><h1>{props.item.label}</h1><p>{props.item.description}</p></div><span data-status={props.item.status}>{props.item.status}</span></header>
    <div className={styles.fields}>
      <label><span>ID</span><input value={props.item.id} readOnly /></label>
      <label><span>Owner</span><input value={props.item.owner} readOnly /></label>
      <label className={styles.longField}><span>Definition</span><textarea defaultValue={'matcher:\n  kind: regex\n  pattern: "<CharacterStatus>([\\s\\S]*?)</CharacterStatus>"\neffect:\n  kind: mark'} /></label>
    </div>
  </div>
}

function PipelinePreview(props: { item?: PipelineWorkbenchGroup['items'][number] }) {
  return <div className={styles.trace}>
    <header><div><small>Dry Run</small><h2>Assembly Preview</h2></div><span>3 steps · 1 match</span></header>
    <ol>
      <li><strong>Canonical</strong><code>……&lt;CharacterStatus&gt;Alice HP: 18&lt;/CharacterStatus&gt;</code></li>
      <li><strong>{props.item?.label ?? 'Selected rule'}</strong><code>match: 42..91 · display: 42..91</code></li>
      <li><strong>Renderer</strong><code>status-panel · narrative.entry.inline</code></li>
    </ol>
  </div>
}

