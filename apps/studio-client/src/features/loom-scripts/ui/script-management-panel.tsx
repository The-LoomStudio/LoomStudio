import { useQuery } from '@tanstack/react-query'
import { StudioPanelActive } from '../../../shared/studio-shell/studio-panel-active.js'
import { MobileTabPageActive } from '../../../shared/ui/mobile-tab-pages/mobile-tab-pages.js'
import { RelatedLore } from '../../prompt-resources/ui/related-lore/related-lore.js'
import { RuleUsageFields } from './rule-usage-fields.js'
import { InfoDialog } from '../../../shared/ui/info-dialog/info-dialog.js'
import { useWorkbenchView } from '../../../shared/studio-shell/use-workbench-view.js'
import { Button, IconButton, Tabs, SearchField, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@loom-studio/ui'
import { ScanSearch, ChevronDown, Code2, Download, Folder, Plus, Power, ToggleLeft, ToggleRight, RefreshCw, SquareArrowRightEnter, X } from 'lucide-react'
import { lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { loomScriptMediaType, resolveLoomScriptSettings, type LoomScriptMountTarget, type LoomScriptSettingDefinition, type LoomScriptSettings } from '@loom-studio/shared/loom-scripts'
import type { LoomScript, LoomScriptMount, LoomScriptOwner } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import { downloadBlob } from '../../../shared/browser/download.js'
import { notify } from '../../../shared/notifications/index.js'
import { confirm } from '../../../shared/ui/confirm-dialog/index.js'
import { FileTree, type FileTreeNode } from '../../../shared/ui/file-tree/file-tree.js'
import { MasterDetailWorkbench } from '../../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import { LoomScriptSourceFields } from './loom-script-source-fields.js'
import { ScriptSettingsFields } from './script-settings-fields.js'
import { scriptCapabilityLabel } from '../model/script-capabilities.js'
import { createScriptTemplate, createTextRuleScriptTemplate } from '../model/script-template.js'
import { sceneScriptDevelopment, sceneScriptMetadataId } from '../model/scene-script-development.js'
import styles from './script-management-panel.module.scss'

const emptyScripts: LoomScript[] = []
const emptyMounts: LoomScriptMount[] = []

const TextRulePreviewDialog = lazy(async () => ({ default: (await import('./text-rule-preview-dialog.js')).TextRulePreviewDialog }))

type ScriptDraft = { script?: LoomScript; owner: LoomScriptOwner; fileName: string; source: string; savedSource: string; savedFileName: string }
type ScriptSettingsSnapshot = {
  ruleDefaults?: Array<{ id: string; rule: import('@loom-studio/shared/loom-scripts').ScriptTextTransformRule }>
  definitions: LoomScriptSettingDefinition[]
  effective?: LoomScriptSettings
  saved: LoomScriptSettings
  inherited?: LoomScriptSettings
  adopted?: LoomScriptSettings
  documentVersion: number
  adoptedDocumentVersion?: number
  validationError?: string
}

export function ScriptManagementPanel(props: {
  endpoint: string
  api: Pick<StudioApi['loomScripts'], 'list' | 'listMounts' | 'export' | 'import' | 'update' | 'createMount' | 'updateMount' | 'refreshMount'> & Partial<Pick<StudioApi['loomScripts'], 'preview' | 'getSettings' | 'removeMount' | 'remove' | 'reorder'>>
  promptResourceApi?: StudioApi['promptResources']
  onNavigate?(path: string): void
  initialScriptId?: string
  initialFilter?: 'rules' | 'runtime'
  category?: 'rules' | 'runtime'
  previewContext?: 'narrative' | 'agent-session'
  cardId?: string
  scopes?: Array<{ owner: LoomScriptOwner; target: LoomScriptMountTarget }>
  getOwnerName?(owner: LoomScriptOwner): string | undefined
  onRelatedResourceChanged?(): void | Promise<void>
  onScriptsChanged(): void
  onInspect?: () => void
  header?: ReactNode
  t: Translator
}) {
  useSyncExternalStore(sceneScriptDevelopment.subscribe, sceneScriptDevelopment.revision, sceneScriptDevelopment.revision)
  const [savedFilter, setFilter] = useWorkbenchView<'rules' | 'runtime'>('scripts.filter', props.initialFilter ?? 'rules', ['rules', 'runtime'])
  useEffect(() => { if (props.initialFilter) setFilter(props.initialFilter) }, [props.initialFilter])
  const filter = props.category ?? savedFilter
  const viewKey = props.category ? `scripts.${props.category}` : 'scripts'
  const panelActive = useContext(StudioPanelActive)
  const pageActive = useContext(MobileTabPageActive)
  const visible = panelActive && pageActive
  const catalog = useQuery({
    queryKey: ['loom-script-catalog', props.endpoint],
    queryFn: async () => {
      const [scripts, mounts] = await Promise.all([props.api.list(), props.api.listMounts()])
      return { scripts: scripts.scripts, mounts: mounts.mounts }
    },
    enabled: visible,
  })
  const scripts = catalog.data?.scripts ?? emptyScripts
  const mounts = catalog.data?.mounts ?? emptyMounts
  const [draft, setDraft] = useState<ScriptDraft>()
  const [previewOpen, setPreviewOpen] = useState(false)
  const [detailTab, setDetailTab] = useWorkbenchView<'run' | 'source'>(`${viewKey}.detail`, 'run', ['run', 'source'])
  const [scopeTab, setScopeTab] = useWorkbenchView<'user' | 'card' | 'select'>(`${viewKey}.scope`, 'user', props.cardId ? ['user', 'card', 'select'] : ['user', 'select'])
  const [selectedOwner, setSelectedOwner] = useState<string>()
  const scope = scopeTab === 'select' && selectedOwner ? selectedOwner : scopeTab
  const [mobilePane, setMobilePane] = useState<'master' | 'detail'>('master')
  const [collapsedIds, setCollapsedIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [tag, setTag] = useState('')
  const [dirtyRuleUsageMounts, setDirtyRuleUsageMounts] = useState<Set<string>>(() => new Set())
  const onRuleUsageDirtyChange = useCallback((id: string, dirty: boolean) => {
    setDirtyRuleUsageMounts(current => {
      if (current.has(id) === dirty) return current
      const next = new Set(current)
      if (dirty) next.add(id); else next.delete(id)
      return next
    })
  }, [])
  const [settingsDrafts, setSettingsDrafts] = useState<Record<string, LoomScriptSettings>>({})
  const [settingsPending, setSettingsPending] = useState(false)
  const [settingsSnapshots, setSettingsSnapshots] = useState<Record<string, ScriptSettingsSnapshot>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef(0)
  const initialSelectionRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!visible) return
    if (!props.initialScriptId) { initialSelectionRef.current = undefined; return }
    if (initialSelectionRef.current === props.initialScriptId || busy) return
    const script = scripts.find(item => item.id === props.initialScriptId || item.contributions.some(contribution => contribution.kind !== 'renderer' && (item.textResourceIds?.[contribution.id] ?? `${item.id}:${contribution.id}`) === props.initialScriptId))
    if (script && (!props.category || scriptMatchesFilter(script, props.category))) {
      initialSelectionRef.current = props.initialScriptId
      setScopeTab('select')
      setSelectedOwner(`owner:${JSON.stringify(script.owner)}`)
      if (!scriptMatchesFilter(script, filter)) setFilter(scriptMatchesFilter(script, 'rules') ? 'rules' : 'runtime')
      void selectScript(script)
    }
  }, [props.initialScriptId, scripts, busy, visible])
  const scopeOwner = scope.startsWith('owner:') ? JSON.parse(scope.slice(6)) as LoomScriptOwner : undefined
  const creationOwner: LoomScriptOwner = scopeOwner ?? (scope === 'card' && props.cardId ? { kind: 'card', cardId: props.cardId } : { kind: 'user' })
  function ownerTarget(owner: LoomScriptOwner): LoomScriptMountTarget {
    if (owner.kind !== 'extension') return owner
    return props.scopes?.find(item => JSON.stringify(item.owner) === JSON.stringify(owner))?.target
      ?? mounts.find(mount => scripts.some(script => script.id === mount.scriptDocumentId && JSON.stringify(script.owner) === JSON.stringify(owner)))?.target ?? { kind: 'user' }
  }
  const target = ownerTarget(creationOwner)

  const selectedMounts = useMemo(() => mounts.filter(mount => mount.scriptDocumentId === draft?.script?.id), [mounts, draft?.script?.id])
  const enabledMounts = selectedMounts.filter(mount => mount.enabled)
  const dirty = Boolean(draft && (draft.source !== draft.savedSource || draft.fileName !== draft.savedFileName || !draft.script))
  const settingsDirty = selectedMounts.some(mount => settingsDrafts[mount.id] !== undefined && !sameSettings(settingsDrafts[mount.id]!, mount.settings ?? {}))
  const tags = useMemo(() => [...new Set(scripts.flatMap(script => script.tags ?? []))].sort((left, right) => left.localeCompare(right)), [scripts])
  const scopeScripts = scripts.filter(script => {
    if (scopeOwner) return JSON.stringify(script.owner) === JSON.stringify(scopeOwner)
    if (scope === 'select') return false
    const scriptTarget = ownerTarget(script.owner)
    const globallyOwned = scriptTarget.kind === 'user'
    const currentCardOwned = scriptTarget.kind === 'card' && scriptTarget.cardId === props.cardId
    const globallyAdopted = mounts.some(mount => mount.scriptDocumentId === script.id && mount.target.kind === 'user')
    if (scope === 'user') return globallyOwned || globallyAdopted
    return currentCardOwned || mounts.some(mount => mount.scriptDocumentId === script.id
      && mount.target.kind === 'card' && mount.target.cardId === props.cardId)
  })
  const visibleScripts = scopeScripts.filter(script => scriptMatchesFilter(script, filter) && (!tag || script.tags?.includes(tag))
    && `${script.name} ${script.metadataId} ${props.getOwnerName?.(script.owner) ?? ''} ${(script.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))

  useEffect(() => { if (tag && !tags.includes(tag)) setTag('') }, [tag, tags])

  async function load() {
    const result = await catalog.refetch()
    if (result.error) throw result.error
  }
  useEffect(() => () => { requestRef.current++ }, [props.api])

  useEffect(() => {
    if (!visible || !props.api.getSettings) return
    let active = true
    setSettingsPending(true)
    void Promise.all(selectedMounts.map(async mount => [mount.id, await props.api.getSettings!({ mountId: mount.id })] as const))
      .then(results => { if (active) setSettingsSnapshots(Object.fromEntries(results)) })
      .catch(cause => { if (active) setError(readError(cause)) })
      .finally(() => { if (active) setSettingsPending(false) })
    return () => { active = false }
  }, [props.api, selectedMounts, draft?.script?.version, visible])

  async function run(operation: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    try { await operation() } catch (cause) { setError(readError(cause)) } finally { setBusy(false) }
  }
  async function canReplaceDraft() {
    const accepted = !dirty && !settingsDirty && dirtyRuleUsageMounts.size === 0 || await confirm('放弃尚未保存的脚本或配置修改？')
    if (accepted) setSettingsDrafts({})
    return accepted
  }
  async function selectScript(script: LoomScript) {
    if (busy) return
    if (draft?.script?.id === script.id) { setMobilePane('detail'); return }
    if (!await canReplaceDraft()) return
    const request = ++requestRef.current
    setError('')
    // Reading a selection must not disable the whole registry or change its drag gutter.
    try {
      const { artifact } = await props.api.export(script.id)
      if (request !== requestRef.current) return
      setDraft({ script, owner: script.owner, fileName: artifact.fileName, source: artifact.source, savedSource: artifact.source, savedFileName: artifact.fileName })
      setMobilePane('detail')
    } catch (cause) {
      if (request === requestRef.current) setError(readError(cause))
    }
  }
  async function startNew(rule = false) {
    if (!await canReplaceDraft()) return
    requestRef.current++
    setDraft({ owner: creationOwner, fileName: rule ? 'rule.md' : 'script.loom.js', source: rule ? createTextRuleScriptTemplate() : createScriptTemplate(), savedSource: '', savedFileName: '' })
    setDetailTab('source')
    setMobilePane('detail')
    setError('')
  }
  async function startSceneExample() {
    if (busy || !await canReplaceDraft()) return
    requestRef.current++
    setDraft({ owner: creationOwner, fileName: 'scene-background-card.loom.js', source: sceneScriptDevelopment.source(), savedSource: '', savedFileName: '' })
    setDetailTab('source')
    setMobilePane('detail')
    setError('')
  }
  async function importFile(file: File) {
    if (!await canReplaceDraft()) return
    await run(async () => {
      const source = await file.text()
      const { script } = await props.api.import({ owner: creationOwner, fileName: file.name, source, mount: { target: ownerTarget(creationOwner) } })
      setDraft({ script, owner: script.owner, fileName: file.name, source, savedSource: source, savedFileName: file.name })
      setMobilePane('detail')
      setDetailTab('run')
      await load()
      notify.success(props.t('notify.success.imported'))
    })
  }
  async function save() {
    if (!draft) return
    await run(async () => {
      const input = { fileName: draft.fileName, source: draft.source }
      const { script } = draft.script
        ? await props.api.update({ ...input, scriptDocumentId: draft.script.id, expectedVersion: draft.script.version })
        : await props.api.import({ ...input, owner: draft.owner, mount: { target: ownerTarget(draft.owner) } })
      setDraft({ ...draft, script, owner: script.owner, savedSource: draft.source, savedFileName: draft.fileName })
      await load()
      props.onScriptsChanged()
      notify.success(props.t('notify.success.saved'))
    })
  }
  async function changeMount(mount: LoomScriptMount, patch: Partial<Pick<LoomScriptMount, 'enabled' | 'grantedCapabilities' | 'ruleUsage'>>) {
    await run(async () => {
      await props.api.updateMount({ mountId: mount.id, expectedVersion: mount.version, enabled: mount.enabled, orderIndex: mount.orderIndex, pinnedDocumentVersion: mount.pinnedDocumentVersion, grantedCapabilities: mount.grantedCapabilities, ...patch })
      await load()
      props.onScriptsChanged()
    })
  }
  async function saveSettings(mount: LoomScriptMount) {
    const settings = settingsDrafts[mount.id]
    if (!settings || !draft?.script) return
    await run(async () => {
      resolveLoomScriptSettings(settingsSnapshots[mount.id]?.definitions ?? draft.script!.settings ?? [], settings)
      await props.api.updateMount({ mountId: mount.id, expectedVersion: mount.version, enabled: mount.enabled,
        orderIndex: mount.orderIndex, pinnedDocumentVersion: mount.pinnedDocumentVersion, grantedCapabilities: mount.grantedCapabilities, settings })
      setSettingsDrafts(current => { const next = { ...current }; delete next[mount.id]; return next })
      await load()
      props.onScriptsChanged()
      notify.success(draft.script!.runtime === 'declarative' ? '配置已保存并生效。' : '配置已保存，刷新脚本后生效。')
    })
  }
  async function removeMount(mount: LoomScriptMount) {
    if (!props.api.removeMount) return
    if (settingsDrafts[mount.id] && !sameSettings(settingsDrafts[mount.id]!, mount.settings ?? {}) && !await confirm('放弃此范围尚未保存的配置并恢复继承？')) return
    await run(async () => {
      await props.api.removeMount!({ mountId: mount.id, expectedVersion: mount.version })
      setSettingsDrafts(current => { const next = { ...current }; delete next[mount.id]; return next })
      await load()
      props.onScriptsChanged()
    })
  }
  async function closeDetail() {
    if (busy || !await canReplaceDraft()) return
    requestRef.current++
    setDraft(undefined)
    setMobilePane('master')
  }
  async function stopScript(scriptId: string) {
    await run(async () => {
      const enabled = mounts.filter(mount => mount.scriptDocumentId === scriptId && mount.enabled)
      const results = await Promise.allSettled(enabled.map(mount => props.api.updateMount({
        mountId: mount.id, expectedVersion: mount.version, enabled: false, orderIndex: mount.orderIndex,
        pinnedDocumentVersion: mount.pinnedDocumentVersion, grantedCapabilities: mount.grantedCapabilities,
      })))
      props.onScriptsChanged()
      await load()
      const failures = results.flatMap(result => result.status === 'rejected' ? [readError(result.reason)] : [])
      if (failures.length) throw new Error(`有 ${failures.length} 个范围未能停用：${failures.join('；')}`)
    })
  }
  async function addMount(adoptionTarget: LoomScriptMountTarget) {
    if (!draft?.script) return
    await run(async () => {
      await props.api.createMount({ target: adoptionTarget, scriptDocumentId: draft.script!.id, orderIndex: mounts.filter(mount => sameTarget(mount.target, adoptionTarget)).length })
      await load()
    })
  }
  function ownerLabel(owner: LoomScriptOwner) {
    const name = props.getOwnerName?.(owner)
    return name ? `${({ user: '个人', card: '角色', extension: '扩展', workspace: '工作区', preset: '预设' })[owner.kind]} · ${name}` : scriptOwnerLabel(owner)
  }
  function declaredOrder(script: LoomScript): number {
    const rule = script.contributions.find(item => item.kind === 'text-transform')
    return rule?.kind === 'text-transform' && typeof rule.rule.orderIndex === 'number' ? rule.rule.orderIndex : 0
  }
  function orderingMount(script: LoomScript) {
    const destination = scope === 'card' ? target : ownerTarget(script.owner)
    return mounts.find(mount => mount.scriptDocumentId === script.id && sameTarget(mount.target, destination))
  }
  function groupOrder(owner: LoomScriptOwner) {
    const member = scripts.find(script => JSON.stringify(script.owner) === JSON.stringify(owner) && typeof orderingMount(script)?.origin.groupOrder === 'number')
    return member ? Number(orderingMount(member)!.origin.groupOrder) : ({ preset: 0, card: 1, extension: 2, user: 3, workspace: 3 })[owner.kind]
  }
  function canOrderScripts(ids: string[]) {
    return scope !== 'card' || ids.every(id => { const script = scripts.find(item => item.id === id)!; return Boolean(orderingMount(script)) || script.owner.kind !== 'extension' && sameTarget(script.owner, target) })
  }
  function ownerScripts(owner: LoomScriptOwner) {
    return scripts.filter(script => JSON.stringify(script.owner) === JSON.stringify(owner))
      .sort((a, b) => (orderingMount(a)?.orderIndex ?? declaredOrder(a)) - (orderingMount(b)?.orderIndex ?? declaredOrder(b)) || a.id.localeCompare(b.id))
  }
  async function moveNode(id: string, targetId: string, position: 'before' | 'inside' | 'after') {
    if (!props.api.reorder || position === 'inside') return
    let groups: Array<{ owner: LoomScriptOwner; scriptIds: string[]; groupOrder?: number }>
    if (id.startsWith('owner:') && targetId.startsWith('owner:')) {
      const owners = [...orderedOwners]
      const from = owners.findIndex(([key]) => `owner:${key}` === id)
      const [owner] = owners.splice(from, 1)
      owners.splice(owners.findIndex(([key]) => `owner:${key}` === targetId) + (position === 'after' ? 1 : 0), 0, owner!)
      groups = owners.map(([, owner], index) => ({ owner, scriptIds: ownerScripts(owner).map(script => script.id), groupOrder: index }))
    } else {
      const entry = entries.get(id)
      const destination = entries.get(targetId)
      if (!entry || !destination || entry.parent !== destination.parent) return
      const siblings = [...entries.values()].filter(item => item.parent === entry.parent).map(item => item.script.id)
      const reordered = siblings.filter(value => value !== entry.script.id)
      reordered.splice(reordered.indexOf(destination.script.id) + (position === 'after' ? 1 : 0), 0, entry.script.id)
      let index = 0
      const visible = new Set(siblings)
      const scriptIds = ownerScripts(entry.script.owner).map(script => visible.has(script.id) ? reordered[index++]! : script.id)
      groups = [{ owner: entry.script.owner, scriptIds }]
    }
    await run(async () => { await props.api.reorder!({ groups, ...(scope === 'card' ? { target } : {}) }); await load(); props.onScriptsChanged() })
  }
  async function deleteScript() {
    if (!draft?.script || !props.api.remove || !await canReplaceDraft()) return
    if (!await confirm({ title: '删除脚本', message: `删除“${draft.script.name}”及其采用配置？`, danger: true })) return
    const script = draft.script
    await run(async () => { await props.api.remove!({ scriptDocumentId: script.id, expectedVersion: script.version }); setDraft(undefined); setMobilePane('master'); await load(); props.onScriptsChanged() })
  }
  const owners = new Map(scopeScripts.map(script => [JSON.stringify(script.owner), script.owner]))
  const orderedOwners = [...owners].sort((a, b) => groupOrder(a[1]) - groupOrder(b[1]) || a[0].localeCompare(b[0]))
  const entries = new Map<string, { script: LoomScript; parent: string }>()
  const folderIds: string[] = []
  const nodes: FileTreeNode[] = orderedOwners.flatMap(([key, owner]) => {
    const members = ownerScripts(owner).filter(script => visibleScripts.includes(script))
    if (!members.length) return []
    const ownerId = `owner:${key}`
    folderIds.push(ownerId)
    const children: FileTreeNode[] = members.map(script => {
      const id = script.id
      entries.set(id, { script, parent: ownerId })
      const count = mounts.filter(mount => mount.scriptDocumentId === script.id && mount.enabled).length
      return { id, kind: 'entry', label: script.name, meta: `${count ? `${count} 个范围已启用` : '未启用'} · v${script.version}${script.tags?.length ? ` · ${script.tags.join(' · ')}` : ''}` }
    })
    const label = props.getOwnerName?.(owner) ?? ownerLabel(owner).replace(/^(个人|角色|扩展|工作区|预设)[：·\s]+/, '')
    return [{ id: ownerId, kind: 'folder', label, children }]
  })
  // Sections follow the persisted order, including repeated kinds after a cross-source move.
  const sections: FileTreeNode[] = []
  let previousKind: LoomScriptOwner['kind'] | undefined
  for (const node of nodes) {
    const owner = JSON.parse(node.id.slice(6)) as LoomScriptOwner
    if (owner.kind !== previousKind) {
      sections.push({ id: `section:${node.id}`, isSection: true, label: ({ user: '个人', card: '角色', extension: '扩展', workspace: '工作区', preset: '预设' })[owner.kind], children: [] })
      previousKind = owner.kind
    }
    sections[sections.length - 1]!.children!.push(node)
  }
  const draftIsRule = draft?.script ? scriptMatchesFilter(draft.script, 'rules') && !scriptMatchesFilter(draft.script, 'runtime') : draft?.fileName.endsWith('.md')
  async function changeScope(next: string) {
    if (!await canReplaceDraft()) return
    requestRef.current++
    setSelectedOwner(next.startsWith('owner:') ? next : undefined)
    setScopeTab(next.startsWith('owner:') ? 'select' : next as 'user' | 'card' | 'select')
    setDraft(undefined)
    setMobilePane('master')
  }


  return <MasterDetailWorkbench navigationScope="local" defaultMasterWidth={260} mobilePane={mobilePane} onMobilePaneChange={setMobilePane} hasSelection={Boolean(draft)}
    master={<div data-loom-mobile-tab-scope="" className={styles.sidebar}>
      {props.header}
      <div data-loom-mobile-tab-scope="" className={styles.mobileFilters}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="small">{scopeTab === 'card' ? '当前角色' : scopeTab === 'user' ? '全局' : '单独选择'}<ChevronDown size={14} /></Button></DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem disabled={!props.cardId} onSelect={() => void changeScope('card')}>当前角色</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void changeScope('user')}>全局</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void changeScope('select')}>单独选择</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {!props.category && <Tabs<'rules' | 'runtime'> ariaLabel="脚本分类" size="compact" activeId={filter} onChange={setFilter}
          items={[{ id: 'rules', label: '正则' }, { id: 'runtime', label: '脚本' }]} />}
      </div>
      <div data-loom-mobile-tab-scope="" style={{ display: 'contents' }}>
      <div className={styles.toolbar}>
        <div className={styles.scope}>
          <Tabs ariaLabel="脚本查看范围" size="compact" activeId={scope.startsWith('owner:') ? 'select' : scope} onChange={id => void changeScope(id)}
            items={[{ id: 'card', label: '当前角色', disabled: !props.cardId }, { id: 'user', label: '全局' }, { id: 'select', label: '单独选择' }]} />

        </div>
      </div>
      <div data-loom-mobile-tab-scope="" style={{ display: 'contents' }}>
      {!props.category && <Tabs<'rules' | 'runtime'> className={styles.filterTabs} ariaLabel="脚本分类" activeId={filter} onChange={setFilter}
        items={[{ id: 'rules', label: '正则' }, { id: 'runtime', label: '脚本' }]} />}
      {(scope === 'select' || scopeOwner) && <div className={styles.sourcePicker}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="small" className={styles.sourceTrigger} disabled={busy} aria-label="选择脚本来源">
            <span>{scopeOwner ? ownerLabel(scopeOwner) : '选择角色、预设或扩展'}</span><ChevronDown size={14} aria-hidden="true" />
          </Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {[...new Map([...(props.scopes ?? []).map(item => item.owner), ...scripts.map(script => script.owner)].map(owner => [JSON.stringify(owner), owner])).entries()].map(([key, owner]) => <DropdownMenuItem key={key} onSelect={() => void changeScope(`owner:${key}`)}>{ownerLabel(owner)}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>}
      <div className={styles.tools}>
        {filter === 'rules' && props.onInspect && <IconButton size="small" aria-label="运行检查器" title="运行检查器" onClick={props.onInspect}><ScanSearch size={16} aria-hidden="true" /></IconButton>}
        <IconButton size="small" disabled={busy || scope === 'select'} aria-label={filter === 'rules' ? '新建规则' : '新建脚本'} title={filter === 'rules' ? '新建规则' : '新建脚本'} onClick={() => void startNew(filter === 'rules')}><Plus size={16} aria-hidden="true" /></IconButton>
        <IconButton size="small" disabled={busy || scope === 'select'} aria-label="导入脚本或规则" title="导入脚本或规则" onClick={() => inputRef.current?.click()}><SquareArrowRightEnter size={16} aria-hidden="true" /></IconButton>
        <input ref={inputRef} hidden type="file" accept=".loom.js,.js,.md,text/javascript,text/markdown" aria-label="导入脚本" onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) void importFile(file) }} />
      </div>
      <div className={styles.search}>
        <SearchField clearLabel="清除搜索" onClear={() => setSearch('')} aria-label="搜索脚本名称、标识或标签" placeholder="搜索名称、标识或标签" value={search} onChange={event => setSearch(event.target.value)} />
        {tags.length > 0 && <select aria-label="按脚本标签筛选" value={tag} onChange={event => setTag(event.target.value)}><option value="">全部标签</option>{tags.map(value => <option key={value} value={value}>{value}</option>)}</select>}
      </div>
      <div className={styles.tree}>
        <FileTree onMoveNode={props.api.reorder ? (id, targetId, position) => { void moveNode(id, targetId, position) } : undefined}
          canDrag={node => !busy && !search && !tag && (node.id.startsWith('owner:') ? canOrderScripts(ownerScripts(JSON.parse(node.id.slice(6)) as LoomScriptOwner).map(script => script.id)) : entries.has(node.id) && canOrderScripts([entries.get(node.id)!.script.id]))}
          canDrop={(id, targetId, position) => !busy && !search && !tag && position !== 'inside' && (id.startsWith('owner:') && targetId.startsWith('owner:')
            ? canOrderScripts(orderedOwners.flatMap(([, owner]) => ownerScripts(owner).map(script => script.id)))
            : Boolean(entries.get(id) && entries.get(targetId) && entries.get(id)!.parent === entries.get(targetId)!.parent && canOrderScripts(ownerScripts(entries.get(id)!.script.owner).map(script => script.id))))}
          ariaLabel="脚本" nodes={sections} selectedId={[...entries].find(([, item]) => item.script.id === draft?.script?.id)?.[0]}
          expandedIds={folderIds.filter(id => !collapsedIds.includes(id))} onExpandedIdsChange={ids => setCollapsedIds(folderIds.filter(id => !ids.includes(id)))}
          isMuted={node => {
            if (node.isSection || node.kind === 'folder') return false
            const script = entries.get(node.id)?.script
            return script ? !mounts.some(mount => mount.scriptDocumentId === script.id && mount.enabled) : false
          }}
          moreActionsLabel="更多操作" getDisclosureLabel={node => node.label} getDragLabel={node => node.label}
          renderIcon={node => node.kind === 'folder' ? <Folder size={14} aria-hidden="true" /> : <Code2 size={14} aria-hidden="true" />}
          renderTrailing={node => {
            const script = entries.get(node.id)?.script
            if (!script) return null
            const enabled = mounts.some(mount => mount.scriptDocumentId === script.id && mount.enabled)
            const mount = orderingMount(script)
            const canEnable = mount && script.requestedCapabilities.every(capability => mount.grantedCapabilities.includes(capability))
            const label = enabled ? `停用 ${node.label} 的所有范围` : canEnable ? `启用 ${node.label}` : `配置并启用 ${node.label}`
            return <button type="button" className={styles.treeToggle} disabled={busy} aria-label={label} title={label} aria-pressed={enabled}
              onClick={event => { event.stopPropagation(); if (enabled) void stopScript(script.id); else if (canEnable) void changeMount(mount, { enabled: true }); else void selectScript(script) }}>
              {enabled ? <ToggleRight aria-hidden="true" /> : <ToggleLeft aria-hidden="true" />}
            </button>
          }}
          onSelect={node => { const script = entries.get(node.id)?.script; if (script) void selectScript(script) }} />
        {visible && catalog.isPending ? <p role="status">正在读取脚本目录…</p> : null}
        {catalog.error ? <p role="alert">{readError(catalog.error)} <button type="button" onClick={() => void catalog.refetch()}>重试</button></p> : null}
        {!catalog.isPending && !catalog.error && !scripts.length ? <p className={styles.muted}>暂无脚本。新建或导入后，再授权并启用。</p> : null}
        {scripts.length > 0 && !visibleScripts.length ? <p className={styles.muted}>此范围内没有匹配的脚本。调整范围、搜索词或标签。</p> : null}
      </div>
      <p className={styles.sortHint}>拖动来源组与条目调整管理列表顺序。</p>
      <details className={styles.examples}><summary>示例脚本</summary><Button size="small" variant="ghost" disabled={busy || scope === 'select'} onClick={() => void startSceneExample()}>新建场景卡示例</Button></details>
      </div></div>
    </div>}>
    <div data-loom-mobile-tab-scope="" className={styles.detail}>
      {previewOpen && draft && props.api.preview && <Suspense fallback={null}><TextRulePreviewDialog key={draft.script?.id ?? 'new'} source={draft.source} previewContext={props.previewContext} name={draft.script?.name ?? '新规则'} onPreview={props.api.preview} t={props.t} onClose={() => setPreviewOpen(false)} /></Suspense>}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {draft ? <>
        <header className={styles.heading}>
          <div className={styles.title}><h3>{draft.script?.name ?? '新脚本'}</h3><small>{ownerLabel(draft.owner)} · {draft.script ? `v${draft.script.version}` : '未保存'}{dirty && draft.script ? ' · 有未保存修改' : ''}</small></div>
          <div className={styles.actions}>
            {draft.script && <InfoDialog key={draft.script.id} title="来源与标识"><dl><dt>来源</dt><dd>{ownerLabel(draft.owner)}</dd><dt>文档</dt><dd>{draft.script.id}</dd><dt>Metadata</dt><dd>{draft.script.metadataId}</dd></dl></InfoDialog>}
            {props.api.preview && (draft.fileName.endsWith('.md') || draft.script?.contributions.some(item => item.kind === 'text-transform')) && <Button size="small" variant="ghost" onClick={() => setPreviewOpen(true)}>实时预览</Button>}
            {enabledMounts.length > 0 && <Button size="small" variant="ghost" disabled={busy} onClick={() => void stopScript(draft.script!.id)}><Power size={14} aria-hidden="true" />全部停用</Button>}
            <Button size="small" variant="ghost" disabled={busy || !draft.script || !props.api.remove} onClick={() => void deleteScript()}>删除</Button>
            <Button size="small" disabled={busy || !dirty} onClick={() => void save()}>{props.t('textTransform.save')}</Button>
            <IconButton size="small" disabled={busy} aria-label="关闭脚本详情" onClick={() => void closeDetail()}><X size={16} aria-hidden="true" /></IconButton>
          </div>
        </header>
        <Tabs<'run' | 'source'>
          className={styles.tabs}
          ariaLabel="脚本详情"
          activeId={detailTab}
          onChange={setDetailTab}
          items={[{ id: 'run', label: draftIsRule ? '规则与启用' : '运行与授权' }, { id: 'source', label: `源码${dirty ? ' ·' : ''}` }]}
        />
        <div className={styles.content}>
        {detailTab === 'run' ? draft.script ? <>
          <div className={styles.sectionHeading}><h4>启用范围</h4><span className={styles.muted}>{draft.script.runtime}</span></div>
          <p className={styles.muted}>同一脚本只运行一次，角色配置优先于全局。角色明确关闭时，会覆盖全局启用；关闭不会删除脚本或授权。</p>
          {!selectedMounts.length && <p className={styles.empty}>尚未添加启用范围。选择下方的全局或当前角色开始配置。</p>}
          {selectedMounts.map(mount => {
            const label = props.getOwnerName?.(mount.target) ? ownerLabel(mount.target) : mountTargetLabel(mount.target, props.cardId)
            const missing = draft.script!.requestedCapabilities.filter(capability => !mount.grantedCapabilities.includes(capability))
            const independentRules = draft.script!.contributions.some(contribution => contribution.kind !== 'renderer' && !contribution.requiresCode)
            const settings = settingsSnapshots[mount.id]
            const settingsLoading = Boolean(props.api.getSettings && (settingsPending || !settings))
            return <section className={styles.mount} key={mount.id} aria-label={`${label}脚本配置`}>
              <div className={styles.mountHeading}>
                <div><strong>{label}</strong><div className={styles.muted}>{mount.enabled ? '已启用' : '已停用'}{mount.adoptedDocumentVersion !== undefined ? ` · 采用 v${mount.adoptedDocumentVersion}` : ''}</div></div>
                <div className={styles.actions}>
                  <IconButton size="small" disabled={busy || !mount.enabled} aria-label={`刷新${label}脚本实例`} onClick={() => void run(async () => { await props.api.refreshMount({ mountId: mount.id, expectedVersion: mount.version }); await load(); props.onScriptsChanged() })}><RefreshCw size={15} aria-hidden="true" /></IconButton>
                  <button type="button" className={styles.treeToggle} aria-pressed={mount.enabled} disabled={busy || (!mount.enabled && missing.length > 0 && !independentRules)} aria-label={`${label}启用脚本`} onClick={() => void changeMount(mount, { enabled: !mount.enabled })}>
                    {mount.enabled ? <ToggleRight aria-hidden="true" /> : <ToggleLeft aria-hidden="true" />}
                  </button>
                </div>
              </div>
              {missing.length > 0 && <p className={styles.muted}>{independentRules ? '独立声明规则可以先启用；代码运行仍需授权。' : `还需确认 ${missing.length} 项权限，展开下方授权后即可启用。`}</p>}
              {mount.enabled && mount.adoptedDocumentVersion !== undefined && mount.adoptedDocumentVersion !== draft.script!.version && <p className={styles.muted}>已保存新版，刷新此实例后生效。</p>}
              {settings?.validationError && <p role="alert" className={styles.error}>{settings.validationError}</p>}
              {settings?.definitions.length ? <p className={styles.muted}>配置声明来自 v{settings.documentVersion}{settings.documentVersion !== settings.adoptedDocumentVersion && mount.enabled ? '；刷新后采用此版本。' : ''}</p> : null}
              {props.promptResourceApi && props.onNavigate && settings?.ruleDefaults && <RelatedLore
                references={settings.ruleDefaults.flatMap(item => item.rule.loreRefs ?? [])} api={props.promptResourceApi}
                onNavigate={props.onNavigate} onChanged={props.onRelatedResourceChanged ?? props.onScriptsChanged} />}
              {!!settings?.ruleDefaults?.length && <RuleUsageFields key={`${mount.id}:${mount.version}`} mountId={mount.id} rules={settings.ruleDefaults}
                saved={mount.ruleUsage ?? {}} disabled={busy || settingsLoading} onDirtyChange={onRuleUsageDirtyChange} onSave={ruleUsage => changeMount(mount, { ruleUsage })} />}
              <ScriptSettingsFields immediate={draft.script!.runtime === 'declarative'} definitions={settings?.definitions ?? draft.script!.settings ?? []} values={settingsDrafts[mount.id] ?? settings?.saved ?? mount.settings ?? {}}
                inherited={settings?.inherited}
                dirty={settingsDrafts[mount.id] !== undefined && !sameSettings(settingsDrafts[mount.id]!, mount.settings ?? {})}
                disabled={busy || settingsLoading} pendingApply={mount.enabled && Boolean(settings?.effective && !sameSettings(settings.effective, settings.adopted ?? {}))}
                onChange={settings => setSettingsDrafts(current => ({ ...current, [mount.id]: settings }))} onSave={() => void saveSettings(mount)}
                onDiscard={() => setSettingsDrafts(current => { const next = { ...current }; delete next[mount.id]; return next })} />
              {(!draftIsRule || draft.script!.requestedCapabilities.length > 0) && <details className={styles.permissions}><summary>能力授权 · {missing.length ? `${missing.length} 项待确认` : '已确认'}</summary>
                <fieldset disabled={busy || mount.enabled}><legend className={styles.muted}>{mount.enabled ? '停用此范围后可修改授权。' : '逐项确认脚本请求的能力。'}</legend>{draft.script!.requestedCapabilities.length ? draft.script!.requestedCapabilities.map(capability => <label key={capability} className={styles.grant}>
                  <input type="checkbox" checked={mount.grantedCapabilities.includes(capability)} onChange={event => void changeMount(mount, { grantedCapabilities: event.target.checked ? [...mount.grantedCapabilities, capability] : mount.grantedCapabilities.filter(value => value !== capability) })} /> {scriptCapabilityLabel(capability)}
                </label>) : <p className={styles.muted}>此脚本未申请额外能力。</p>}</fieldset>
              </details>}
              {import.meta.env.DEV && draft.script?.metadataId === sceneScriptMetadataId && <details className={styles.permissions}><summary>开发联调</summary><label className={styles.grant}>
                <input type="checkbox" checked={sceneScriptDevelopment.enabled(mount.id)} onChange={event => sceneScriptDevelopment.setEnabled(mount.id, event.target.checked)} />跟随仓库场景卡热更新（仅当前页面）
              </label></details>}
              {props.api.removeMount && <div className={styles.removeScope}><Button size="small" variant="ghost" disabled={busy} onClick={() => void removeMount(mount)}>{mount.target.kind === 'card' ? '移除角色覆盖，恢复继承' : '移除此范围'}</Button><small className={styles.muted}>只移除此范围的启用和配置，不删除脚本。</small></div>}
            </section>
          })}
          <div className={styles.actions}>
            {!selectedMounts.some(mount => mount.target.kind === 'user') && <Button size="small" variant="ghost" disabled={busy} onClick={() => void addMount({ kind: 'user' })}><Plus size={14} aria-hidden="true" />添加到全局</Button>}
            {props.cardId && !selectedMounts.some(mount => mount.target.kind === 'card' && mount.target.cardId === props.cardId) && <Button size="small" variant="ghost" disabled={busy} onClick={() => void addMount({ kind: 'card', cardId: props.cardId! })}><Plus size={14} aria-hidden="true" />添加到当前角色</Button>}
          </div>

        </> : <p className={styles.muted}>保存脚本后，可添加启用范围并授权。保存不会自动启动。</p> : <>
          <div className={styles.sourceToolbar}><span className={styles.muted}>编辑原脚本 · {ownerLabel(draft.owner)}</span><Button size="small" variant="ghost" disabled={busy || !draft.script} onClick={() => void run(async () => { const { artifact } = await props.api.export(draft.script!.id); downloadBlob(new Blob([artifact.source], { type: loomScriptMediaType(artifact.fileName) }), artifact.fileName) })}><Download size={14} aria-hidden="true" />导出已保存版本</Button></div>
          <LoomScriptSourceFields key={draft.script?.id ?? `new-script-${requestRef.current}`} fileName={draft.fileName} source={draft.source} disabled={busy} t={props.t}
            onFileNameChange={fileName => setDraft({ ...draft, fileName })} onSourceChange={source => setDraft({ ...draft, source })} />
        </>}
        </div>
      </> : <div className={styles.empty}><Code2 size={28} aria-hidden="true" /><p>选择脚本管理启用范围，或新建、导入脚本。</p><p className={styles.muted}>使用列表右侧开关启停脚本；需要授权时会打开详情。</p></div>}
    </div>
  </MasterDetailWorkbench>
}

function mountTargetLabel(target: LoomScriptMountTarget, cardId?: string): string {
  if (target.kind === 'user') return '全局'
  if (target.kind === 'card') return target.cardId === cardId ? '当前角色' : `其他角色 · ${target.cardId}`
  if (target.kind === 'workspace') return `工作区 · ${target.workspaceId}`
  return `预设 · ${target.presetId}`
}

function sameTarget(left: LoomScriptMountTarget, right: LoomScriptMountTarget) { return JSON.stringify(left) === JSON.stringify(right) }
function sameSettings(left: LoomScriptSettings, right: LoomScriptSettings) { return Object.keys(left).length === Object.keys(right).length && Object.entries(left).every(([key, value]) => right[key] === value) }
function readError(cause: unknown) { return cause instanceof Error ? cause.message : String(cause) }
function scriptOwnerLabel(owner: LoomScriptOwner): string {
  if (owner.kind === 'user') return '个人脚本'
  if (owner.kind === 'card') return `角色：${owner.cardId}`
  if (owner.kind === 'extension') return `扩展包：${owner.packageId}`
  if (owner.kind === 'workspace') return `工作区：${owner.workspaceId}`
  return `预设：${owner.presetId}`
}

function scriptMatchesFilter(script: LoomScript, filter: 'rules' | 'runtime') {
  const hasRules = script.contributions.some(item => item.kind === 'text-transform')
  return filter === 'rules' ? hasRules : !hasRules || script.runtime !== 'declarative'
}
