import { Button, IconButton, Tabs, Toggle } from '@loom-studio/ui'
import { Code2, Download, Folder, Plus, Power, RefreshCw, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { resolveLoomScriptSettings, type LoomScriptMountTarget, type LoomScriptSettingDefinition, type LoomScriptSettings } from '@loom-studio/shared/loom-scripts'
import type { LoomScript, LoomScriptMount, LoomScriptOwner } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import { downloadBlob } from '../../../shared/browser/download.js'
import { notify } from '../../../shared/notifications/index.js'
import { FileTree } from '../../../shared/ui/file-tree/file-tree.js'
import { MasterDetailWorkbench } from '../../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import { LoomScriptSourceFields } from './loom-script-source-fields.js'
import { ScriptSettingsFields } from './script-settings-fields.js'
import { scriptCapabilityLabel } from '../model/script-capabilities.js'
import { createScriptTemplate, createTextRuleScriptTemplate } from '../model/script-template.js'
import { sceneScriptDevelopment, sceneScriptMetadataId } from '../model/scene-script-development.js'
import styles from './script-management-panel.module.scss'

type ScriptDraft = { script?: LoomScript; owner: LoomScriptOwner; fileName: string; source: string; savedSource: string; savedFileName: string }
type ScriptSettingsSnapshot = {
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
  api: Pick<StudioApi['loomScripts'], 'list' | 'listMounts' | 'export' | 'import' | 'update' | 'createMount' | 'updateMount' | 'refreshMount'> & Partial<Pick<StudioApi['loomScripts'], 'preview' | 'getSettings' | 'removeMount'>>
  cardId?: string
  getOwnerName?(owner: LoomScriptOwner): string | undefined
  onScriptsChanged(): void
  refreshToken?: number
  header?: ReactNode
  t: Translator
}) {
  useSyncExternalStore(sceneScriptDevelopment.subscribe, sceneScriptDevelopment.revision, sceneScriptDevelopment.revision)
  const [scripts, setScripts] = useState<LoomScript[]>([])
  const [mounts, setMounts] = useState<LoomScriptMount[]>([])
  const [draft, setDraft] = useState<ScriptDraft>()
  const [detailTab, setDetailTab] = useState<'run' | 'source'>('run')
  const [scope, setScope] = useState<'user' | 'card'>('user')
  const [mobilePane, setMobilePane] = useState<'master' | 'detail'>('master')
  const [collapsedIds, setCollapsedIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [tag, setTag] = useState('')
  const [settingsDrafts, setSettingsDrafts] = useState<Record<string, LoomScriptSettings>>({})
  const [settingsSnapshots, setSettingsSnapshots] = useState<Record<string, ScriptSettingsSnapshot>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef(0)
  const target: LoomScriptMountTarget = scope === 'card' && props.cardId ? { kind: 'card', cardId: props.cardId } : { kind: 'user' }
  const selectedMounts = useMemo(() => mounts.filter(mount => mount.scriptDocumentId === draft?.script?.id), [mounts, draft?.script?.id])
  const enabledMounts = selectedMounts.filter(mount => mount.enabled)
  const dirty = Boolean(draft && (draft.source !== draft.savedSource || draft.fileName !== draft.savedFileName || !draft.script))
  const settingsDirty = selectedMounts.some(mount => settingsDrafts[mount.id] !== undefined && !sameSettings(settingsDrafts[mount.id]!, mount.settings ?? {}))
  const tags = useMemo(() => [...new Set(scripts.flatMap(script => script.tags ?? []))].sort((left, right) => left.localeCompare(right)), [scripts])
  const scopeScripts = scripts.filter(script => scope !== 'card' || !props.cardId
    || script.owner.kind === 'card' && script.owner.cardId === props.cardId
    || mounts.some(mount => mount.scriptDocumentId === script.id
      && (mount.target.kind === 'user' || mount.target.kind === 'card' && mount.target.cardId === props.cardId)))
  const visibleScripts = scopeScripts.filter(script => (!tag || script.tags?.includes(tag))
    && `${script.name} ${script.metadataId} ${props.getOwnerName?.(script.owner) ?? ''} ${(script.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))

  useEffect(() => { if (tag && !tags.includes(tag)) setTag('') }, [tag, tags])

  async function load() {
    const [scriptResult, mountResult] = await Promise.all([props.api.list(), props.api.listMounts()])
    setScripts(scriptResult.scripts)
    setMounts(mountResult.mounts)
  }
  useEffect(() => {
    let active = true
    void Promise.all([props.api.list(), props.api.listMounts()]).then(([scriptResult, mountResult]) => {
      if (!active) return
      setScripts(scriptResult.scripts)
      setMounts(mountResult.mounts)
    }).catch(cause => { if (active) setError(readError(cause)) })
    return () => { active = false; requestRef.current++ }
  }, [props.api, props.refreshToken])

  useEffect(() => {
    if (!props.api.getSettings) return
    let active = true
    setSettingsSnapshots({})
    void Promise.all(selectedMounts.map(async mount => [mount.id, await props.api.getSettings!({ mountId: mount.id })] as const))
      .then(results => { if (active) setSettingsSnapshots(Object.fromEntries(results)) })
      .catch(cause => { if (active) setError(readError(cause)) })
    return () => { active = false }
  }, [props.api, selectedMounts, draft?.script?.version])

  async function run(operation: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    try { await operation() } catch (cause) { setError(readError(cause)) } finally { setBusy(false) }
  }
  function canReplaceDraft() {
    const accepted = !dirty && !settingsDirty || window.confirm('放弃尚未保存的脚本或配置修改？')
    if (accepted) setSettingsDrafts({})
    return accepted
  }
  async function selectScript(script: LoomScript) {
    if (busy || !canReplaceDraft()) return
    const request = ++requestRef.current
    await run(async () => {
      const { artifact } = await props.api.export(script.id)
      if (request !== requestRef.current) return
      setDraft({ script, owner: script.owner, fileName: artifact.fileName, source: artifact.source, savedSource: artifact.source, savedFileName: artifact.fileName })
      setDetailTab('run')
      setMobilePane('detail')
    })
  }
  function startNew(rule = false) {
    if (!canReplaceDraft()) return
    requestRef.current++
    setDraft({ owner: target, fileName: rule ? 'rule.loom.js' : 'script.loom.js', source: rule ? createTextRuleScriptTemplate() : createScriptTemplate(), savedSource: '', savedFileName: '' })
    setDetailTab('source')
    setMobilePane('detail')
    setError('')
  }
  function startSceneExample() {
    if (busy || !canReplaceDraft()) return
    requestRef.current++
    setDraft({ owner: target, fileName: 'scene-background-card.loom.js', source: sceneScriptDevelopment.source(), savedSource: '', savedFileName: '' })
    setDetailTab('source')
    setMobilePane('detail')
    setError('')
  }
  async function importFile(file: File) {
    if (!canReplaceDraft()) return
    await run(async () => {
      const source = await file.text()
      const { script } = await props.api.import({ owner: target, fileName: file.name, source })
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
        : await props.api.import({ ...input, owner: draft.owner })
      setDraft({ ...draft, script, owner: script.owner, savedSource: draft.source, savedFileName: draft.fileName })
      await load()
      notify.success(props.t('notify.success.saved'))
    })
  }
  async function changeMount(mount: LoomScriptMount, patch: Partial<Pick<LoomScriptMount, 'enabled' | 'grantedCapabilities'>>) {
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
      notify.success('配置已保存，刷新脚本后生效。')
    })
  }
  async function removeMount(mount: LoomScriptMount) {
    if (!props.api.removeMount) return
    if (settingsDrafts[mount.id] && !sameSettings(settingsDrafts[mount.id]!, mount.settings ?? {}) && !window.confirm('放弃此范围尚未保存的配置并恢复继承？')) return
    await run(async () => {
      await props.api.removeMount!({ mountId: mount.id, expectedVersion: mount.version })
      setSettingsDrafts(current => { const next = { ...current }; delete next[mount.id]; return next })
      await load()
      props.onScriptsChanged()
    })
  }
  function closeDetail() {
    if (busy || !canReplaceDraft()) return
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
  const owners = new Map(visibleScripts.map(script => [JSON.stringify(script.owner), script.owner]))
  const nodes = [...owners].map(([key, owner]) => ({
    id: `owner:${key}`,
    kind: 'folder' as const,
    label: ownerLabel(owner),
    children: visibleScripts.filter(script => JSON.stringify(script.owner) === key).map(script => {
      const count = mounts.filter(mount => mount.scriptDocumentId === script.id && mount.enabled).length
      return { id: script.id, kind: 'entry' as const, label: script.name, meta: `${count ? `${count} 个范围已启用` : '未启用'} · v${script.version}${script.tags?.length ? ` · ${script.tags.join(' · ')}` : ''}` }
    }),
  }))
  function changeScope(next: 'user' | 'card') {
    if (!canReplaceDraft()) return
    requestRef.current++
    setScope(next)
    setDraft(undefined)
    setMobilePane('master')
  }


  return <MasterDetailWorkbench navigationScope="local" masterWidth={260} mobilePane={mobilePane} onMobilePaneChange={setMobilePane} hasSelection={Boolean(draft)}
    master={<div className={styles.sidebar}>
      {props.header}
      <div className={styles.toolbar}>
        <label className={styles.scope}>查看 / 新建范围<select aria-label="脚本查看与创建范围" disabled={busy} value={target.kind} onChange={event => changeScope(event.target.value as 'user' | 'card')}>
          <option value="user">全部脚本（新建到全局）</option>{props.cardId ? <option value="card">当前角色</option> : null}
        </select></label>
        <Button size="small" variant="ghost" disabled={busy} onClick={() => startNew()}><Plus size={14} aria-hidden="true" />新建</Button>
        <Button size="small" variant="ghost" disabled={busy} onClick={() => startNew(true)}>新建规则</Button>
        <Button size="small" variant="ghost" disabled={busy} onClick={() => inputRef.current?.click()}><Upload size={14} aria-hidden="true" />导入</Button>
        <input ref={inputRef} hidden type="file" accept=".loom.js,.js,text/javascript" aria-label="导入脚本" onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) void importFile(file) }} />
      </div>
      <div className={styles.search}>
        <input type="search" aria-label="搜索脚本名称、标识或标签" placeholder="搜索名称、标识或标签" value={search} onChange={event => setSearch(event.target.value)} />
        {tags.length > 0 && <select aria-label="按脚本标签筛选" value={tag} onChange={event => setTag(event.target.value)}><option value="">全部标签</option>{tags.map(value => <option key={value} value={value}>{value}</option>)}</select>}
      </div>
      <div className={styles.tree}>
        <FileTree ariaLabel="脚本" nodes={nodes} selectedId={draft?.script?.id} expandedIds={nodes.map(node => node.id).filter(id => !collapsedIds.includes(id))} onExpandedIdsChange={ids => setCollapsedIds(nodes.map(node => node.id).filter(id => !ids.includes(id)))}
          moreActionsLabel="更多操作" getDisclosureLabel={node => node.label} getDragLabel={node => node.label}
          renderIcon={node => node.kind === 'folder' ? <Folder size={14} aria-hidden="true" /> : <Code2 size={14} aria-hidden="true" />}
          renderTrailing={node => node.kind !== 'folder' && mounts.some(mount => mount.scriptDocumentId === node.id && mount.enabled)
            ? <IconButton size="small" disabled={busy} aria-label={`停用 ${node.label} 的所有范围`} onClick={event => { event.stopPropagation(); void stopScript(node.id) }}><Power size={14} aria-hidden="true" /></IconButton> : null}
          onSelect={node => { const script = scripts.find(item => item.id === node.id); if (script) void selectScript(script) }} />
        {!scripts.length ? <p className={styles.muted}>暂无脚本。新建或导入后，再授权并启用。</p> : null}
        {scripts.length > 0 && !visibleScripts.length ? <p className={styles.muted}>此范围内没有匹配的脚本。调整范围、搜索词或标签。</p> : null}
      </div>
      <details className={styles.examples}><summary>示例脚本</summary><Button size="small" variant="ghost" disabled={busy} onClick={startSceneExample}>新建场景卡示例</Button></details>
    </div>}>
    <div className={styles.detail}>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {draft ? <>
        <header className={styles.heading}>
          <div className={styles.title}><h3>{draft.script?.name ?? '新脚本'}</h3><small>{ownerLabel(draft.owner)} · {draft.script ? `v${draft.script.version}` : '未保存'}{dirty && draft.script ? ' · 有未保存修改' : ''}</small></div>
          <div className={styles.actions}>
            {enabledMounts.length > 0 && <Button size="small" variant="ghost" disabled={busy} onClick={() => void stopScript(draft.script!.id)}><Power size={14} aria-hidden="true" />全部停用</Button>}
            <Button size="small" disabled={busy || !dirty} onClick={() => void save()}>{props.t('textTransform.save')}</Button>
            <IconButton size="small" disabled={busy} aria-label="关闭脚本详情" onClick={closeDetail}><X size={16} aria-hidden="true" /></IconButton>
          </div>
        </header>
        <Tabs<'run' | 'source'>
          className={styles.tabs}
          ariaLabel="脚本详情"
          activeId={detailTab}
          onChange={setDetailTab}
          items={[{ id: 'run', label: '运行与授权' }, { id: 'source', label: `源码${dirty ? ' ·' : ''}` }]}
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
            const settingsLoading = Boolean(props.api.getSettings && !settings)
            return <section className={styles.mount} key={mount.id} aria-label={`${label}脚本配置`}>
              <div className={styles.mountHeading}>
                <div><strong>{label}</strong><div className={styles.muted}>{mount.enabled ? '已启用' : '已停用'}{mount.adoptedDocumentVersion !== undefined ? ` · 采用 v${mount.adoptedDocumentVersion}` : ''}</div></div>
                <div className={styles.actions}>
                  <IconButton size="small" disabled={busy || !mount.enabled} aria-label={`刷新${label}脚本实例`} onClick={() => void run(async () => { await props.api.refreshMount({ mountId: mount.id, expectedVersion: mount.version }); await load(); props.onScriptsChanged() })}><RefreshCw size={15} aria-hidden="true" /></IconButton>
                  <Toggle checked={mount.enabled} disabled={busy || (!mount.enabled && missing.length > 0 && !independentRules)} label={`${label}启用脚本`} onChange={enabled => void changeMount(mount, { enabled })} />
                </div>
              </div>
              {missing.length > 0 && <p className={styles.muted}>{independentRules ? '独立声明规则可以先启用；代码运行仍需授权。' : `还需确认 ${missing.length} 项权限，展开下方授权后即可启用。`}</p>}
              {mount.enabled && mount.adoptedDocumentVersion !== undefined && mount.adoptedDocumentVersion !== draft.script!.version && <p className={styles.muted}>已保存新版，刷新此实例后生效。</p>}
              {settings?.validationError && <p role="alert" className={styles.error}>{settings.validationError}</p>}
              {settings?.definitions.length ? <p className={styles.muted}>配置声明来自 v{settings.documentVersion}{settings.documentVersion !== settings.adoptedDocumentVersion && mount.enabled ? '；刷新后采用此版本。' : ''}</p> : null}
              <ScriptSettingsFields definitions={settings?.definitions ?? draft.script!.settings ?? []} values={settingsDrafts[mount.id] ?? settings?.saved ?? mount.settings ?? {}}
                inherited={settings?.inherited}
                dirty={settingsDrafts[mount.id] !== undefined && !sameSettings(settingsDrafts[mount.id]!, mount.settings ?? {})}
                disabled={busy || settingsLoading} pendingApply={mount.enabled && Boolean(settings?.effective && !sameSettings(settings.effective, settings.adopted ?? {}))}
                onChange={settings => setSettingsDrafts(current => ({ ...current, [mount.id]: settings }))} onSave={() => void saveSettings(mount)}
                onDiscard={() => setSettingsDrafts(current => { const next = { ...current }; delete next[mount.id]; return next })} />
              <details className={styles.permissions}><summary>能力授权 · {missing.length ? `${missing.length} 项待确认` : '已确认'}</summary>
                <fieldset disabled={busy || mount.enabled}><legend className={styles.muted}>{mount.enabled ? '停用此范围后可修改授权。' : '逐项确认脚本请求的能力。'}</legend>{draft.script!.requestedCapabilities.length ? draft.script!.requestedCapabilities.map(capability => <label key={capability} className={styles.grant}>
                  <input type="checkbox" checked={mount.grantedCapabilities.includes(capability)} onChange={event => void changeMount(mount, { grantedCapabilities: event.target.checked ? [...mount.grantedCapabilities, capability] : mount.grantedCapabilities.filter(value => value !== capability) })} /> {scriptCapabilityLabel(capability)}
                </label>) : <p className={styles.muted}>此脚本未申请额外能力。</p>}</fieldset>
              </details>
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
          <details className={styles.metadata}><summary>来源与标识</summary><p>{ownerLabel(draft.owner)}</p><p>文档：{draft.script.id}</p><p>Metadata：{draft.script.metadataId}</p></details>
        </> : <p className={styles.muted}>保存脚本后，可添加启用范围并授权。保存不会自动启动。</p> : <>
          <div className={styles.sourceToolbar}><span className={styles.muted}>编辑原脚本 · {ownerLabel(draft.owner)}</span><Button size="small" variant="ghost" disabled={busy || !draft.script} onClick={() => void run(async () => { const { artifact } = await props.api.export(draft.script!.id); downloadBlob(new Blob([artifact.source], { type: 'text/javascript' }), artifact.fileName) })}><Download size={14} aria-hidden="true" />导出已保存版本</Button></div>
          <LoomScriptSourceFields key={draft.script?.id ?? `new-script-${requestRef.current}`} fileName={draft.fileName} source={draft.source} disabled={busy} t={props.t} onPreview={props.api.preview}
            onFileNameChange={fileName => setDraft({ ...draft, fileName })} onSourceChange={source => setDraft({ ...draft, source })} />
        </>}
        </div>
      </> : <div className={styles.empty}><Code2 size={28} aria-hidden="true" /><p>选择脚本管理启用范围，或新建、导入脚本。</p><p className={styles.muted}>列表中的电源按钮可停用该脚本的所有范围。</p></div>}
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
