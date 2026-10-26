import { useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Dialog, Textarea } from '@loom-studio/ui'
import { Anchor, ArrowLeft, ArrowRight, ChevronRight, Copy, FileText, Folder, Layers, MessageSquare, Plus, Undo2 } from 'lucide-react'
import { MasterDetailWorkbench } from '../../../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import { flattenPresetLibraryNodes, selectedPresetLibraryNodes, type PresetLibraryConfiguration, type PresetLibraryOption, type PresetCopyRequest, type PresetLibraryItem, type PresetLibraryNode, type PresetLibraryResource, type PresetLibrarySource } from './preset-library-model.js'
import { PresetLibraryCatalog } from './preset-library-catalog.js'
import { PresetConfigurationDialog } from './preset-configuration-dialog.js'
import { PresetLibraryConfig } from './preset-library-config.js'
import styles from './preset-library-workbench.module.scss'

export type PresetLibraryWorkbenchProps = {
  presets: PresetLibraryItem[]
  sources: PresetLibrarySource[]
  resources: PresetLibraryResource[]
  models: PresetLibraryOption[]
  tools: PresetLibraryOption[]
  onConfigure(presetId: string, patch: Partial<PresetLibraryConfiguration>): void
  onCreate(): string
  onEdit(presetId: string, nodeId: string, body: string): void
  onToggleResource(presetId: string, resourceId: string): void
  onCopy(request: PresetCopyRequest): void
  canUndoCopy: boolean
  onUndoCopy(): void
}
const nodeKind = { message: 'Message', folder: '分组', entry: '文本条目', anchor: '文本锚点', sequence: '消息序列' }
function NodeIcon({ kind }: { kind: PresetLibraryNode['kind'] }) {
  const Icon = { message: MessageSquare, folder: Folder, entry: FileText, anchor: Anchor, sequence: Layers }[kind]
  return <Icon size={16} aria-hidden="true" />
}
function ArrangementTree({ nodes, selected, onSelect }: { nodes: PresetLibraryNode[]; selected: string; onSelect(id: string): void }) {
  return <ul className={styles.tree}>{nodes.map(node => <li key={node.id}>
    <button className={styles.treeRow} aria-current={selected === node.id ? 'true' : undefined} onClick={() => onSelect(node.id)}><NodeIcon kind={node.kind} /><span>{node.label}</span>{node.role && <small>{node.role}</small>}{node.kind === 'sequence' && <small>动态</small>}</button>
    {node.children?.length ? <ArrangementTree nodes={node.children} selected={selected} onSelect={onSelect} /> : null}
  </li>)}</ul>
}

export function PresetLibraryWorkbench(props: PresetLibraryWorkbenchProps) {
  const [configuredId, setConfiguredId] = useState<string>()
  const [presetId, setPresetId] = useState<string>()
  const [copying, setCopying] = useState(false)
  const [tab, setTab] = useState<'arrangement' | 'resources'>('arrangement')
  const [selectedId, setSelectedId] = useState('')
  const [mobilePane, setMobilePane] = useState<'master' | 'detail'>('master')
  const [resourceId, setResourceId] = useState<string>()
  const heading = useRef<HTMLHeadingElement>(null)
  const lastOpened = useRef<string | undefined>(undefined)
  const library = useRef<HTMLDivElement>(null)
  const preset = props.presets.find(item => item.id === presetId)
  const configured = props.presets.find(item => item.id === configuredId)
  const source = props.sources.find(item => item.id === preset?.sourceId)
  const resource = props.resources.find(item => item.id === resourceId)
  const selected = preset ? flattenPresetLibraryNodes(preset.nodes).find(node => node.id === selectedId) ?? preset.nodes[0] : undefined
  const openConfiguration = (id: string) => {
    setConfiguredId(id)
  }
  const openPreset = (id: string) => {
    setConfiguredId(undefined)
    lastOpened.current = id
    setPresetId(id); setCopying(false); setTab('arrangement'); setMobilePane('master')
    setSelectedId(props.presets.find(item => item.id === id)?.nodes[0]?.id ?? '')
  }
  useEffect(() => {
    if (!presetId && lastOpened.current) {
      const row = library.current?.querySelector<HTMLButtonElement>(`[data-preset-id="${CSS.escape(lastOpened.current)}"]`)
      if (row) { row.focus({ preventScroll: true }); return }
    }
    heading.current?.focus()
  }, [presetId, copying])
  const resourceRow = (item: PresetLibraryResource, adopt: boolean) => <div className={styles.resourceRow} key={item.id}>
    {adopt && preset && <Checkbox aria-label={`采用${item.name}`} checked={preset.resourceIds.includes(item.id)} onChange={() => props.onToggleResource(preset.id, item.id)} />}
    <button className={styles.resourceButton} onClick={() => setResourceId(item.id)}><span className={styles.badge}>{item.kind}</span><span><strong>{item.name}</strong><small>{item.description}</small></span><span className={styles.resourceMeta}>{adopt ? props.sources.find(s => s.id === item.sourceId)?.name : `${props.presets.filter(p => p.resourceIds.includes(item.id)).length} 个预设采用`}</span><ChevronRight size={14} /></button>
  </div>

  return <div className={styles.workbench} ref={library}>
    {preset && copying ? <PresetCopyWorkbench key={preset.id} {...props} target={preset} onBack={() => setCopying(false)} /> : preset ? <>
      <header className={styles.header}>
        <div className={styles.breadcrumb}><Button size="small" variant="ghost" onClick={() => setPresetId(undefined)}><ArrowLeft size={15} />预设库</Button><span>/</span><span>{source?.name}</span></div>
        <div className={styles.titleRow}><div><h1 ref={heading} tabIndex={-1}>{preset.name}</h1><p>{preset.description}</p></div><Button size="small" onClick={() => setCopying(true)} disabled={props.presets.length < 2}><Copy size={15} />从其他预设复制</Button></div>
        <div className={styles.detailTools}><nav aria-label="预设内容" className={styles.tabs}><Button size="small" variant="ghost" aria-pressed={tab === 'arrangement'} onClick={() => setTab('arrangement')}>消息编排</Button><Button size="small" variant="ghost" aria-pressed={tab === 'resources'} onClick={() => setTab('resources')}>采用资源 <span className={styles.count}>{preset.resourceIds.length}</span></Button></nav><label className={styles.switcher}>切换预设<select value={preset.id} onChange={event => openPreset(event.target.value)}>{props.sources.map(s => <optgroup key={s.id} label={s.name}>{props.presets.filter(p => p.sourceId === s.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}</select></label></div>
      </header>
      {tab === 'arrangement' ? <MasterDetailWorkbench className={styles.fill} navigationScope="local" defaultMasterWidth={310} mobilePane={mobilePane} onMobilePaneChange={setMobilePane} backLabel="消息编排" hasSelection={!!selected} master={<div className={styles.treePane}><div className={styles.sectionLabel}>发送顺序 <span>{preset.nodes.length} 个编排单元</span></div><ArrangementTree nodes={preset.nodes} selected={selected?.id ?? ''} onSelect={id => { setSelectedId(id); setMobilePane('detail') }} /><p className={styles.hint}>会话历史在构建时展开为多条消息，保留各自的身份与工具记录。</p></div>}>
        <article className={styles.editor}>{selected ? <><div className={styles.eyebrow}><NodeIcon kind={selected.kind} />{nodeKind[selected.kind]}{selected.role && <span className={styles.badge}>{selected.role}</span>}</div><h2>{selected.label}</h2>
          {selected.kind === 'entry' ? <><label className={styles.fieldLabel} htmlFor="preset-entry-body">内容</label><Textarea id="preset-entry-body" className={styles.bodyEditor} value={selected.body ?? ''} onChange={event => props.onEdit(preset.id, selected.id, event.target.value)} /><p className={styles.hint}>编辑即时保留在本次预览中。</p></> : selected.kind === 'sequence' ? <div className={styles.explanation}><Layers size={24} /><h3>由会话提供的消息序列</h3><p>运行时追加 user、assistant 和 tool 消息，每条消息保留自己的 role。它占据编排中的一个位置，不包装成单独的 Message。</p><div className={styles.sequence}><span>user</span><ArrowRight size={14} /><span>assistant / tools</span><ArrowRight size={14} /><span>…</span></div></div> : selected.kind === 'anchor' ? <p className={styles.hint}>构建时在这里注入对应资源的文本，沿用所属 Message 的 role。</p> : <><p className={styles.hint}>{selected.kind === 'message' ? '内部条目按顺序组成这条消息。' : '将经常一起调整或复制的内容放在同一组。'}</p><ArrangementTree nodes={selected.children ?? []} selected={selectedId} onSelect={setSelectedId} /></>}
        </> : <p className={styles.hint}>选择左侧的消息或条目开始查看。</p>}</article>
      </MasterDetailWorkbench> : <div className={styles.scroll}><div className={styles.contentWidth}><h2>这个预设采用的资源</h2><p className={styles.hint}>套件中的资源可以共享；是否用于这个预设，在这里单独选择。</p>{props.resources.filter(r => r.sourceId === preset.sourceId || preset.resourceIds.includes(r.id) || r.sourceId === 'personal').map(r => resourceRow(r, true))}</div></div>}
    </> : <PresetLibraryCatalog sources={props.sources} items={props.presets.map(item => ({
      id: item.id, sourceId: item.sourceId, name: item.name, description: item.description,
      modelLabel: props.models.find(model => model.id === item.modelId)?.name ?? '未指定模型',
      toolCount: item.toolIds.length, resourceCount: item.resourceIds.length,
    }))} onConfigure={openConfiguration} onOpen={openPreset}
      actions={<Button size="small" variant="ghost" onClick={() => openConfiguration(props.onCreate())}><Plus size={15} />新建预设</Button>}
      sourceContent={sourceId => <section className={styles.group}><div className={styles.groupHeading}><h3>来源提供的公共资源</h3></div>{props.resources.filter(r => r.sourceId === sourceId).map(r => resourceRow(r, false))}</section>} />}
    <PresetConfigurationDialog open={!!configured} onClose={() => setConfiguredId(undefined)}
      title={configured?.name ?? '预设配置'} source={props.sources.find(item => item.id === configured?.sourceId)?.name}>
      {configured && <PresetLibraryConfig key={configured.id} preset={configured} models={props.models} tools={props.tools} resources={props.resources} sources={props.sources}
        onConfigure={patch => props.onConfigure(configured.id, patch)} onToggleResource={id => props.onToggleResource(configured.id, id)} />}
    </PresetConfigurationDialog>
    <Dialog open={!!resource} onClose={() => setResourceId(undefined)} title={resource?.name ?? '资源'} description={resource && `${resource.kind} · ${props.sources.find(s => s.id === resource.sourceId)?.name}`}><div className={styles.resourceDetail}><p>{resource?.body}</p><h3>实际采用它的预设</h3>{props.presets.filter(p => p.resourceIds.includes(resourceId ?? '')).map(p => <button key={p.id} className={styles.treeRow} onClick={() => { setResourceId(undefined); openPreset(p.id); setTab('resources') }}><MessageSquare size={16} /><span>{p.name}</span><ChevronRight size={14} /></button>)}{!props.presets.some(p => p.resourceIds.includes(resourceId ?? '')) && <p className={styles.hint}>暂时没有预设采用。资源仍可由套件提供。</p>}</div></Dialog>
  </div>
}

function CopyTree({ nodes, ids, onToggle, inherited = false }: { nodes: PresetLibraryNode[]; ids: string[]; onToggle(id: string): void; inherited?: boolean }) {
  return <ul className={styles.copyTree}>{nodes.map(node => {
    const checked = inherited || ids.includes(node.id)
    const selectable = ['message', 'folder', 'entry'].includes(node.kind)
    return <li key={node.id}><div className={styles.copyRow}><Checkbox aria-label={`复制${node.label}`} checked={checked} disabled={inherited || !selectable} onChange={() => onToggle(node.id)} /><NodeIcon kind={node.kind} /><span>{node.label}</span><small>{node.role ?? (node.kind === 'sequence' ? '运行时展开' : '')}</small></div>{node.children?.length ? <details open><summary>包含 {node.children.length} 项</summary><CopyTree nodes={node.children} ids={ids} onToggle={onToggle} inherited={checked} /></details> : node.body ? <details><summary>查看内容</summary><p className={styles.snippet}>{node.body}</p></details> : null}</li>
  })}</ul>
}
function PresetCopyWorkbench(props: PresetLibraryWorkbenchProps & { target: PresetLibraryItem; onBack(): void }) {
  const [sourceId, setSourceId] = useState(props.presets.find(p => p.id !== props.target.id)?.id ?? '')
  const [ids, setIds] = useState<string[]>([])
  const [messageId, setMessageId] = useState('')
  const [includeResources, setIncludeResources] = useState(false)
  const [status, setStatus] = useState('')
  const [pane, setPane] = useState<'source' | 'target'>('source')
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  const source = props.presets.find(p => p.id === sourceId)!
  const selected = selectedPresetLibraryNodes(source.nodes, ids)
  const hasMessage = selected.some(n => n.kind === 'message')
  const destinationId = hasMessage ? '' : messageId
  const destination = props.target.nodes.find(n => n.id === destinationId)
  return <section className={styles.copyWorkbench} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); props.onBack() } }}>
    <header className={styles.header}><Button size="small" variant="ghost" onClick={props.onBack}><ArrowLeft size={15} />返回 {props.target.name}</Button><div className={styles.titleRow}><div><h1 ref={heading} tabIndex={-1}>从其他预设复制</h1><p>选择惯用的条目或整条消息，追加到当前预设。</p></div><span className={styles.badge}>保留来源内容</span></div></header>
    <div className={styles.mobileSwitch}><Button size="small" aria-pressed={pane === 'source'} onClick={() => setPane('source')}>1 · 选择内容</Button><Button size="small" aria-pressed={pane === 'target'} onClick={() => setPane('target')}>2 · 确定落点</Button></div>
    <div className={styles.copyColumns} data-pane={pane}><div className={styles.copyColumn} data-column="source"><header className={styles.columnHeader}><span className={styles.eyebrow}>01 · 来源预设</span><select aria-label="来源预设" value={sourceId} onChange={event => { setSourceId(event.target.value); setIds([]); setIncludeResources(false); setStatus('') }}>{props.sources.map(s => <optgroup key={s.id} label={s.name}>{props.presets.filter(p => p.sourceId === s.id && p.id !== props.target.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}</select><small>{props.sources.find(s => s.id === source.sourceId)?.name}</small></header><div className={styles.columnScroll}><CopyTree nodes={source.nodes} ids={ids} onToggle={id => { setIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); setStatus('') }} /><div className={styles.referenceOption}><Checkbox checked={includeResources} disabled={!source.resourceIds.length} onChange={event => setIncludeResources(event.target.checked)} label={`同时沿用来源预设采用的资源（${source.resourceIds.length} 项）`} /><p className={styles.hint}>{source.resourceIds.map(id => props.resources.find(r => r.id === id)?.name).join(' · ') || '来源预设没有采用额外资源。'}</p><p className={styles.hint}>沿用资源引用，公共内容仍由原来源提供。</p></div></div></div>
      <div className={styles.copyColumn} data-column="target"><header className={styles.columnHeader}><span className={styles.eyebrow}>02 · 复制到</span><strong>{props.target.name}</strong><small>{props.sources.find(s => s.id === props.target.sourceId)?.name} · {props.target.nodes.length} 个编排单元</small></header><div className={styles.columnScroll}><fieldset className={styles.destinations}><legend>追加位置</legend><label className={styles.destination} data-selected={!destinationId}><input type="radio" name="copy-destination" checked={!destinationId} onChange={() => setMessageId('')} /><span><strong>作为独立消息插入</strong><small>放在会话历史之前；文本或分组会包装为 System 消息。</small></span></label>{props.target.nodes.filter(n => n.kind === 'message').map(n => <label key={n.id} className={styles.destination} data-selected={destinationId === n.id}><input type="radio" name="copy-destination" checked={destinationId === n.id} disabled={hasMessage} onChange={() => setMessageId(n.id)} /><span><strong>{n.label} <small>{n.role}</small></strong><small>追加到内部末尾 · 当前 {n.children?.length ?? 0} 项</small></span></label>)}</fieldset>{hasMessage && <p className={styles.hint}>选择了完整 Message，复制后保留其 role，独立放入编排。</p>}<div className={styles.copySummary}><h3>本次追加</h3>{selected.length ? <><p className={styles.hint}>落点：{destination ? `${destination.label} / 末尾` : '会话历史之前'}</p>{selected.map(n => <div key={n.id} className={styles.summaryRow}><Plus size={14} /><NodeIcon kind={n.kind} /><span>{n.label}</span><small>{n.role ?? nodeKind[n.kind]}</small></div>)}{includeResources && <p className={styles.hint}>同时采用 {source.resourceIds.length} 项来源资源，已有引用不会重复追加。</p>}</> : <p className={styles.hint}>从左侧选择内容，这里会显示追加结果。</p>}</div></div></div></div>
    <footer className={styles.copyFooter}><div className={styles.copyStatus} role="status" aria-live="polite">{status || `已选 ${selected.length} 项${selected.length ? ` → ${destination?.label ?? '独立消息'}` : ' · 可按条目、分组或整条消息选择'}`}</div><div className={styles.actions}>{props.canUndoCopy && <Button size="small" variant="ghost" onClick={() => { props.onUndoCopy(); setStatus('已撤销上次复制。') }}><Undo2 size={14} />撤销</Button>}{status && <Button size="small" variant="secondary" onClick={props.onBack}>查看编排</Button>}<Button size="small" disabled={!selected.length} onClick={() => { props.onCopy({ sourceId, targetId: props.target.id, nodeIds: ids, messageId: destinationId || undefined, includeResources }); setStatus(`已复制 ${selected.length} 项到「${props.target.name}」。`); setIds([]) }}><Copy size={15} />复制到此预设</Button></div></footer>
  </section>
}
