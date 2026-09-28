import { useState } from 'react'
import { Anchor, ArrowDown, ArrowUp, ArrowUpRight, Blocks, BookOpen, Bot, Braces, Code, File, Folder, FolderOpen, Globe, Library, Link, LockKeyhole, PanelLeft, Regex, SlidersHorizontal, Unlink, Users, Wrench, X } from 'lucide-react'
import { Button, IconButton, SearchField } from '@loom-studio/ui'
import { MasterDetailWorkbench } from '../../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import { FileTree, type FileTreeNode } from '../../../shared/ui/file-tree/file-tree.js'
import { PanelTabs } from '../../../shared/ui/panel-tabs/panel-tabs.js'
import { LongTextEditor } from '../../../shared/ui/long-text-editor/long-text-editor.js'
import { MarkdownContent } from '../../../shared/ui/markdown-content/markdown-content.js'
import { AgentPresetDetail, type RegistryAgentPreset } from './agent-preset-detail.js'
import styles from './resource-registry-workbench.module.scss'

const categories = [
  { id: 'agents', label: 'Agent 预设', Icon: Bot },
  { id: 'settings', label: 'Settings / 文本', Icon: BookOpen },
  { id: 'transforms', label: '正则 / 提取规则', Icon: Regex },
  { id: 'macros', label: '宏配置', Icon: Braces },
  { id: 'scripts', label: '脚本', Icon: Code },
  { id: 'state', label: 'State 定义', Icon: SlidersHorizontal },
] as const

export type RegistryResourcePreview = {
  id: string
  category: typeof categories[number]['id'] | 'attachments'
  name: string
  owner: string
  provenance: string
  globalDefault: boolean
  current: boolean
  usage: string[]
  body: string
  autoInject?: boolean
  readOnly?: boolean
  entries?: Array<{ id: string; name: string; body: string }>
}

export function ResourceRegistryWorkbench(props: {
  resources: RegistryResourcePreview[]
  previewPackages: Array<{ id: string; fileName: string; owner: string; resources: RegistryResourcePreview[] }>
  ownerKinds: Record<string, 'package' | 'extension' | 'workspace' | 'platform'>
  agentPresets: Record<string, RegistryAgentPreset>
  models: string[]
  contextLabel: string
  currentOwner: string
  initialResourceId?: string
}) {
  const [category, setCategory] = useState<typeof categories[number]['id']>(
    props.resources.find(resource => resource.id === props.initialResourceId)?.category === 'agents' ? 'agents' : 'settings',
  )
  const [view, setView] = useState<'type' | 'packages' | 'extensions'>('type')
  const [scope, setScope] = useState('current')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(props.initialResourceId ?? '')
  const [mobilePane, setMobilePane] = useState<'master' | 'detail'>('master')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [expandedIds, setExpandedIds] = useState<string[]>(() => [
    ...new Set(props.resources.map(resource => `owner:${resource.owner}`)),
    ...props.resources.filter(resource => resource.entries?.length).map(resource => resource.id),
    ...Object.keys(props.agentPresets).flatMap(id => [id, `${id}:prompt`]),
    ...[...new Set(props.resources.map(resource => resource.owner))].flatMap(owner =>
      [...categories.map(item => item.id), 'attachments'].map(id => `type:${owner}:${id}`)),
  ])
  const [orders, setOrders] = useState<Record<string, string[]>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [agentDrafts, setAgentDrafts] = useState<Record<string, RegistryAgentPreset>>({})
  const agentPresets = { ...props.agentPresets, ...agentDrafts }
  const agentItems = Object.entries(agentPresets).flatMap(([agentId, preset]) => [
    { id: `${agentId}:prompt`, name: '提示词编排', agentId, section: 'prompt' as const },
    ...preset.prompts.map(prompt => ({ ...prompt, agentId, section: 'entry' as const })),
    { id: `${agentId}:tools`, name: '工具', agentId, section: 'tools' as const },
    { id: `${agentId}:model`, name: '模型槽', agentId, section: 'model' as const },
  ])
  const [referenceIds, setReferenceIds] = useState<string[]>([])
  const [globalOverrides, setGlobalOverrides] = useState<Record<string, boolean>>({})
  const [packageChooserOpen, setPackageChooserOpen] = useState(false)
  const [openedPackageIds, setOpenedPackageIds] = useState<string[]>([])
  const openedPackages = props.previewPackages.filter(item => openedPackageIds.includes(item.id))
  const resources = [
    ...props.resources,
    ...props.previewPackages.flatMap(item => item.resources.filter(resource =>
      openedPackageIds.includes(item.id) || referenceIds.includes(resource.id) || globalOverrides[resource.id])),
  ].map(resource => {
    const globalDefault = globalOverrides[resource.id] ?? resource.globalDefault
    const referenced = referenceIds.includes(resource.id)
    return {
      ...resource,
      globalDefault,
      current: resource.current || globalDefault || referenced,
      usage: [
        ...resource.usage.filter(value => value !== '全局默认'),
        ...(referenced ? [props.currentOwner] : []),
        ...(globalDefault ? ['全局默认'] : []),
      ],
    }
  })
  const categoryResources = resources.filter(resource => {
    if (view === 'type') return resource.category === category
    if (view === 'extensions') return props.ownerKinds[resource.owner] === 'extension'
    return props.ownerKinds[resource.owner] === 'package' || props.ownerKinds[resource.owner] === 'workspace'
  })
  const search = query.toLowerCase()
  const rows = categoryResources.filter(resource =>
    (view !== 'type' || scope === 'all' || (scope === 'global' ? resource.globalDefault : resource.current))
    && [resource.name, resource.owner, ...(resource.entries ?? []).map(entry => entry.name),
      ...agentItems.filter(item => item.agentId === resource.id).map(item => item.name)].join(' ').toLowerCase().includes(search),
  )
  const selected = rows.flatMap(resource => [
    resource,
    ...(resource.entries ?? []).map(entry => ({ ...resource, ...entry })),
    ...agentItems.filter(item => item.agentId === resource.id).map(item => ({ ...resource, ...item })),
  ]).find(resource => resource.id === selectedId) ?? rows[0]
  const selectedAgentItem = agentItems.find(item => item.id === selected?.id)
  const selectedRoot = rows.find(resource => resource.id === selected?.id
    || resource.id === selectedAgentItem?.agentId || resource.entries?.some(entry => entry.id === selected?.id))
  const selectedPreset = selectedRoot?.category === 'agents' ? agentPresets[selectedRoot.id] : undefined
  const selectedPrompt = selectedPreset?.prompts.find(prompt => prompt.id === selected?.id)
  const referenced = selectedRoot ? referenceIds.includes(selectedRoot.id) : false
  const canReference = selectedRoot?.category === 'settings' && selectedRoot.owner !== props.currentOwner
  const activeCategory = categories.find(item => item.id === category)!
  const title = view === 'packages' ? '角色 / 资源包' : view === 'extensions' ? '扩展' : activeCategory.label
  const orderScope = view === 'type' ? category : view
  const SelectedIcon = selected?.category === 'attachments' ? File : categories.find(item => item.id === selected?.category)?.Icon ?? BookOpen
  const externalOwners = new Set(props.previewPackages.map(item => item.owner))

  function showOwner(owner: string, resourceId = '') {
    setView(props.ownerKinds[owner] === 'extension' ? 'extensions' : 'packages')
    setQuery('')
    setSelectedId(resourceId)
    setMobilePane('master')
    setSidebarOpen(false)
    setExpandedIds(previous => [...new Set([
      ...previous, `owner:${owner}`,
      ...[...categories.map(item => item.id), 'attachments'].map(id => `type:${owner}:${id}`),
      ...resources.filter(resource => resource.owner === owner && resource.entries).map(resource => resource.id),
      ...resources.filter(resource => resource.owner === owner && agentPresets[resource.id]).flatMap(resource => [resource.id, `${resource.id}:prompt`]),
    ])])
  }

  function openPackage(id: string) {
    const item = props.previewPackages.find(item => item.id === id)!
    setOpenedPackageIds(previous => previous.includes(id) ? previous : [...previous, id])
    setExpandedIds(previous => [...new Set([
      ...previous, `owner:${item.owner}`,
      ...item.resources.filter(resource => resource.entries).map(resource => resource.id),
    ])])
    showOwner(item.owner, item.resources[0]?.id)
    setPackageChooserOpen(false)
  }

  function closePackage(id: string) {
    const item = props.previewPackages.find(item => item.id === id)!
    setOpenedPackageIds(previous => previous.filter(candidate => candidate !== id))
    if (selectedRoot?.owner === item.owner) {
      setSelectedId('')
    }
  }

  function ordered(nodes: FileTreeNode[], parentId: string): FileTreeNode[] {
    const saved = orders[`${orderScope}:${parentId}`]
    if (!saved) return nodes
    const ids = [...saved, ...nodes.map(node => node.id).filter(id => !saved.includes(id))]
    return [...nodes].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
  }

  function resourceNode(resource: RegistryResourcePreview): FileTreeNode {
    const preset = agentPresets[resource.id]
    if (preset) return {
      id: resource.id, label: resource.name, kind: 'folder',
      children: [
        { id: `${resource.id}:prompt`, label: '提示词编排', kind: 'folder',
          children: preset.prompts.map(prompt => ({ id: prompt.id, label: prompt.name, kind: 'entry' })) },
        { id: `${resource.id}:tools`, label: '工具', kind: 'entry' },
        { id: `${resource.id}:model`, label: '模型槽', kind: 'entry' },
      ],
    }
    return {
      id: resource.id,
      label: resource.name,
      kind: resource.entries ? 'folder' : 'entry',
      ...(resource.entries ? { children: ordered(resource.entries.map(entry => ({
        id: entry.id, label: entry.name, kind: 'entry',
      })), resource.id) } : {}),
    }
  }

  const ownerNodes = [...new Set(rows.map(resource => resource.owner))].map(owner => {
    const owned = rows.filter(resource => resource.owner === owner)
    const children = view === 'type'
      ? owned.map(resourceNode)
      : [...new Set(owned.map(resource => resource.category))].map(kind => ({
        id: `type:${owner}:${kind}`,
        label: kind === 'attachments' ? '附件' : categories.find(item => item.id === kind)!.label,
        kind: 'folder',
        children: ordered(owned.filter(resource => resource.category === kind).map(resourceNode), `type:${owner}:${kind}`),
      }))
    return { id: `owner:${owner}`, label: owner, kind: 'folder', children: ordered(children, `owner:${owner}`) }
  })
  const internalNodes = ordered(ownerNodes.filter(node => !externalOwners.has(node.label)), 'internal')
  const externalNodes = ordered(ownerNodes.filter(node => externalOwners.has(node.label)), 'external')
  const nodes: FileTreeNode[] = [
    ...internalNodes,
    ...(externalNodes.length ? [{ id: 'external', label: '外部预览', isSection: true, children: externalNodes }] : []),
  ]
  const groups = collectTreeGroups(nodes)

  function moveSibling(node: FileTreeNode, offset: number) {
    const group = groups.find(group => group.children?.some(child => child.id === node.id))
    if (!group?.children) return
    const ids = group.children.map(child => child.id)
    const from = ids.indexOf(node.id)
    const to = from + offset
    if (to < 0 || to >= ids.length) return
    ids.splice(from, 1)
    ids.splice(to, 0, node.id)
    const agentItem = agentItems.find(item => item.id === node.id && item.section === 'entry')
    if (agentItem) {
      const preset = agentPresets[agentItem.agentId]!
      setAgentDrafts(previous => ({ ...previous, [agentItem.agentId]: {
        ...preset, prompts: ids.map(id => preset.prompts.find(prompt => prompt.id === id)!),
      } }))
      return
    }
    setOrders(previous => ({ ...previous, [`${orderScope}:${group.id}`]: ids }))
  }

  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <IconButton className={styles.sidebarToggle} aria-label="切换资源分类" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}>
          <PanelLeft size={16} />
        </IconButton>
        <Library size={18} aria-hidden="true" />
        <strong>资源库</strong><span>/</span><span>{title}</span>
        <small>UI 草稿</small>
      </header>
      <div className={styles.playContext} aria-label="当前游玩上下文">
        <span>当前游玩</span><strong>{props.contextLabel}</strong>
        <span>{resources.filter(resource => resource.current).length} 项当前可用</span>
      </div>
      <div className={styles.workspace}>
        <nav className={styles.sidebar} data-open={sidebarOpen} aria-label="工作台导航">
          <h2>资源类型</h2>
          <FileTree
            ariaLabel="资源类型"
            nodes={categories.map(item => ({ id: item.id, label: item.label, kind: 'folder' }))}
            selectedId={view === 'type' ? category : undefined}
            expandedIds={[]}
            onExpandedIdsChange={() => {}}
            onSelect={node => {
              const next = categories.find(item => item.id === node.id)!
              setCategory(next.id)
              setView('type')
              setScope('all')
              setQuery('')
              setSelectedId('')
              setMobilePane('master')
              setSidebarOpen(false)
            }}
            renderIcon={node => {
              const Icon = categories.find(item => item.id === node.id)!.Icon
              return <Icon size={16} />
            }}
            getDisclosureLabel={(node, expanded) => `${expanded ? '收起' : '展开'}${node.label}`}
            getDragLabel={node => `移动${node.label}`}
            moreActionsLabel="更多操作"
          />
          <h2 className={styles.ownerHeading}>包与扩展</h2>
          <FileTree
            ariaLabel="包与扩展"
            nodes={[
              { id: 'packages', label: '角色 / 资源包', kind: 'folder' },
              { id: 'extensions', label: '扩展', kind: 'folder' },
            ]}
            selectedId={view === 'type' ? undefined : view}
            expandedIds={[]}
            onExpandedIdsChange={() => {}}
            onSelect={node => {
              setView(node.id === 'extensions' ? 'extensions' : 'packages')
              setQuery('')
              setSelectedId('')
              setMobilePane('master')
              setSidebarOpen(false)
            }}
            renderIcon={node => node.id === 'extensions' ? <Blocks size={16} /> : <Users size={16} />}
            getDisclosureLabel={(node, expanded) => `${expanded ? '收起' : '展开'}${node.label}`}
            getDragLabel={node => `移动${node.label}`}
            moreActionsLabel="更多操作"
          />
          <section className={styles.externalSidebar} aria-label="外部预览">
            <h2>外部预览</h2>
            <Button className={styles.openPackage} aria-expanded={packageChooserOpen} onClick={() => setPackageChooserOpen(!packageChooserOpen)}>
              <FolderOpen size={16} aria-hidden="true" />打开资源包
            </Button>
            {packageChooserOpen && <div className={styles.packageChooser}>
              <h2>示例资源包</h2>
              {props.previewPackages.map(item => <Button key={item.id} onClick={() => openPackage(item.id)}>
                <File size={16} aria-hidden="true" /><span>{item.fileName}</span>
              </Button>)}
            </div>}
            {openedPackages.length > 0 && <FileTree
              ariaLabel="已打开的资源包"
              nodes={openedPackages.map(item => ({ id: item.id, label: item.owner, meta: '外部包 · 只读预览', kind: 'folder' }))}
              selectedId={view !== 'type' ? openedPackages.find(item => item.owner === selectedRoot?.owner)?.id : undefined}
              expandedIds={[]}
              onExpandedIdsChange={() => {}}
              onSelect={node => openPackage(node.id)}
              renderIcon={() => <FolderOpen size={16} />}
              renderTrailing={node => <IconButton aria-label={`关闭${node.label}预览`} size="small" onClick={() => closePackage(node.id)}><X size={14} /></IconButton>}
              getDisclosureLabel={(node, expanded) => `${expanded ? '收起' : '展开'}${node.label}`}
              getDragLabel={node => `移动${node.label}`}
              moreActionsLabel="更多操作"
            />}
          </section>
        </nav>
        <div className={styles.content}>
          <MasterDetailWorkbench
            defaultMasterWidth={320}
            masterMinWidth={230}
            mobilePane={mobilePane}
            onMobilePaneChange={setMobilePane}
            master={
              <div className={styles.master}>
                <div className={styles.filters}>
                  <SearchField aria-label="搜索资源" placeholder="搜索名称或归属" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} clearLabel="清除搜索" />
                  {view === 'type' && <PanelTabs
                    ariaLabel="资源使用范围"
                    size="compact"
                    activeId={scope}
                    onChange={value => {
                      setScope(value)
                      setQuery('')
                      setMobilePane('master')
                    }}
                    items={[
                      { id: 'current', label: '当前使用' },
                      { id: 'all', label: '全部资源' },
                      { id: 'global', label: '全局默认' },
                    ]}
                  />}
                </div>
                {view === 'type' && scope === 'current' && <p className={styles.context}>{props.contextLabel}</p>}
                <div className={styles.listHeading}>
                  <span>{title} · {rows.length} 项</span>
                </div>
                <div className={styles.list}>
                  <FileTree
                    ariaLabel="资源目录"
                    nodes={nodes}
                    selectedId={selected?.id}
                    expandedIds={query ? [...expandedIds, ...groups.map(group => group.id)] : expandedIds}
                    onExpandedIdsChange={setExpandedIds}
                    onSelect={node => {
                      if (node.id.startsWith('owner:') || node.id.startsWith('type:')) {
                        setExpandedIds(previous => previous.includes(node.id) ? previous.filter(id => id !== node.id) : [...previous, node.id])
                      } else {
                        setSelectedId(node.id)
                        setMobilePane('detail')
                      }
                    }}
                    renderIcon={(node, expanded) => {
                      if (node.children) return expanded ? <FolderOpen size={16} /> : <Folder size={16} />
                      const item = agentItems.find(item => item.id === node.id)
                      if (item?.section === 'tools') return <Wrench size={16} />
                      if (item?.section === 'model') return <SlidersHorizontal size={16} />
                      if (item?.section === 'entry' && item.kind === 'anchor') return <Anchor size={16} />
                      const resource = rows.find(resource => resource.id === node.id)
                      const Icon = resource?.category === 'attachments' ? File : categories.find(item => item.id === resource?.category)?.Icon ?? BookOpen
                      return <Icon size={16} />
                    }}
                    getActions={node => {
                      const siblings = groups.find(group => group.children?.some(child => child.id === node.id))?.children ?? []
                      const index = siblings.findIndex(child => child.id === node.id)
                      const agentItem = agentItems.find(item => item.id === node.id)
                      const readOnly = rows.some(resource => resource.readOnly && (node.id === resource.id || resource.id === agentItem?.agentId || resource.entries?.some(entry => entry.id === node.id)))
                      const filtered = (view === 'type' && scope !== 'all') || Boolean(query) || readOnly
                      return [
                        { id: 'up', label: '上移', icon: <ArrowUp size={16} />, disabled: filtered || index <= 0, onSelect: () => moveSibling(node, -1) },
                        { id: 'down', label: '下移', icon: <ArrowDown size={16} />, disabled: filtered || index < 0 || index === siblings.length - 1, onSelect: () => moveSibling(node, 1) },
                      ]
                    }}
                    hasActions={node => rows.some(resource => resource.id === node.id || resource.entries?.some(entry => entry.id === node.id))
                      || agentItems.some(item => item.id === node.id && item.section === 'entry')}
                    getDisclosureLabel={(node, expanded) => `${expanded ? '收起' : '展开'}${node.label}`}
                    getDragLabel={node => `移动${node.label}`}
                    moreActionsLabel="目录操作"
                  />
                  {!rows.length && <p className={styles.empty}>没有匹配的资源</p>}
                </div>
              </div>
            }
          >
            {selected ? <article className={styles.detail}>
              <header className={styles.detailHeader}>
                <SelectedIcon size={20} aria-hidden="true" /><h1>{selected.name}</h1>
                {view === 'type' && props.ownerKinds[selected.owner] !== 'platform' ? <Button size="small" onClick={() => showOwner(selected.owner, selected.id)}>
                  <FolderOpen size={15} aria-hidden="true" />查看所属包
                </Button> : view !== 'type' && selected.category !== 'attachments' ? <Button size="small" onClick={() => {
                  setCategory(selected.category as typeof categories[number]['id'])
                  setView('type')
                  setScope('all')
                  setQuery('')
                  setSelectedId(selected.id)
                  setExpandedIds(previous => [...new Set([...previous, `owner:${selected.owner}`, selectedRoot!.id, `${selectedRoot!.id}:prompt`])])
                }}>
                  <ArrowUpRight size={15} aria-hidden="true" />按类型查看
                </Button> : null}
              </header>
              <dl className={styles.metadata}>
                <dt>类型</dt><dd>{selected.category === 'attachments' ? '附件 / Markdown' : categories.find(item => item.id === selected.category)?.label}</dd>
                <dt>归属</dt><dd>{selected.owner}</dd>
                {selectedAgentItem && <><dt>Agent 预设</dt><dd>{selectedRoot?.name}</dd></>}
                <dt>来源</dt><dd>{selected.provenance}</dd>
                {selected.autoInject !== undefined && <><dt>自动注入</dt><dd>{selected.autoInject ? '开启' : '关闭'}</dd></>}
                <dt>使用位置</dt><dd>{selected.usage.length ? selected.usage.join('、') : '尚未挂载'}</dd>
                <dt>当前上下文</dt><dd>{selected.current ? '已纳入' : '未纳入'} · {props.contextLabel}</dd>
              </dl>
              {canReference && selectedRoot && <section className={styles.bindingActions} aria-label="资源使用操作">
                <div className={styles.documentHeader}>
                  <strong>{selectedRoot.name}</strong>
                  <span role="status">{referenced ? `已引用到${props.currentOwner}` : selectedRoot.globalDefault ? '已设为全局默认' : '仅浏览 · 未引用到当前角色'}</span>
                </div>
                <div className={styles.actionButtons}>
                  <Button onClick={() => setReferenceIds(previous => referenced
                    ? previous.filter(id => id !== selectedRoot.id)
                    : [...previous, selectedRoot.id])}>
                    {referenced ? <Unlink size={15} aria-hidden="true" /> : <Link size={15} aria-hidden="true" />}
                    {referenced ? '撤销当前角色引用' : `引用到${props.currentOwner}`}
                  </Button>
                  <Button onClick={() => setGlobalOverrides(previous => ({ ...previous, [selectedRoot.id]: !selectedRoot.globalDefault }))}>
                    <Globe size={15} aria-hidden="true" />
                    {selectedRoot.globalDefault ? '取消全局默认' : '设为全局默认'}
                  </Button>
                </div>
              </section>}
              <section className={styles.body}>
                {selectedPreset && selectedPrompt ? selectedPrompt.kind === 'anchor' ? <pre>{selectedPrompt.body}</pre> : <SettingDocument
                  key={selected.id}
                  label="提示词正文"
                  value={selectedPrompt.body}
                  readOnly={selected.readOnly}
                  onChange={body => setAgentDrafts(previous => ({ ...previous, [selectedRoot!.id]: {
                    ...selectedPreset, prompts: selectedPreset.prompts.map(prompt => prompt.id === selectedPrompt.id ? { ...prompt, body } : prompt),
                  } }))}
                /> : selectedPreset ? <AgentPresetDetail
                  name={selectedRoot!.name}
                  preset={selectedPreset}
                  section={selectedAgentItem?.section === 'entry' ? 'prompt' : selectedAgentItem?.section ?? 'overview'}
                  models={props.models}
                  readOnly={selected.readOnly}
                  onChange={preset => setAgentDrafts(previous => ({ ...previous, [selectedRoot!.id]: preset }))}
                  onSelectPrompt={id => {
                    setSelectedId(id)
                    setExpandedIds(previous => [...new Set([...previous, selectedRoot!.id, `${selectedRoot!.id}:prompt`])])
                    setMobilePane('detail')
                  }}
                /> : selected.category === 'attachments' || (selected.readOnly && selected.category === 'settings') ? <>
                  <div className={styles.documentHeader}><h2>{selected.category === 'settings' ? 'Setting 正文' : '文档'}</h2><span><LockKeyhole size={14} aria-hidden="true" />{selected.readOnly ? '其他作品 · 只读预览' : '随包发布 · 只读'}</span></div>
                  <MarkdownContent value={selected.body} codeBlockLabels={{
                    copy: '复制代码', copied: '已复制代码', copyFailed: '复制失败', enableWrap: '开启换行', disableWrap: '关闭换行',
                  }} />
                </> : selected.category === 'settings' ? <SettingDocument
                  key={selected.id}
                  value={drafts[selected.id] ?? selected.body}
                  onChange={value => setDrafts(previous => ({ ...previous, [selected.id]: value }))}
                /> : <>
                  <div className={styles.documentHeader}>
                    <h2>内容</h2>
                    {selected.readOnly && <span><LockKeyhole size={14} aria-hidden="true" />其他作品 · 只读预览</span>}
                  </div>
                  <pre>{selected.body}</pre>
                </>}
              </section>
            </article> : <div className={styles.empty}>暂无可查看的资源</div>}
          </MasterDetailWorkbench>
        </div>
      </div>
    </main>
  )
}

function collectTreeGroups(nodes: FileTreeNode[], id = 'root'): Array<{ id: string; children: FileTreeNode[] }> {
  return [{ id, children: nodes }, ...nodes.flatMap(node => node.children ? collectTreeGroups(node.children, node.id) : [])]
}

function SettingDocument(props: { value: string; label?: string; readOnly?: boolean; onChange(value: string): void }) {
  const [mode, setMode] = useState<'source' | 'preview'>('preview')
  return <LongTextEditor
    label={props.label ?? 'Setting 正文'}
    disabled={props.readOnly}
    value={props.value}
    mode={mode}
    onModeChange={setMode}
    onChange={props.onChange}
    onCommit={props.onChange}
    minHeight={300}
    clearLabel="清空正文"
    clearedLabel="已清空正文"
    copiedLabel="已复制"
    copyFailedLabel="复制失败"
    copyLabel="复制正文"
    disableCodeWrapLabel="关闭换行"
    enableCodeWrapLabel="开启换行"
    previewEmptyLabel="暂无正文"
    previewModeLabel="预览 Markdown"
    restoreInitialLabel="恢复初始内容"
    sourceModeLabel="编辑 Markdown"
    undoEditLabel="撤销编辑"
    undoLabel="撤销清空"
  />
}
