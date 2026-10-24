import { Button } from '@loom-studio/ui'
import { Code2, Download, Plus, RefreshCw, Upload } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { LoomScriptMountTarget } from '@loom-studio/shared/loom-scripts'
import type { LoomScript, LoomScriptMount, LoomScriptOwner } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import { downloadBlob } from '../../../shared/browser/download.js'
import { notify } from '../../../shared/notifications/index.js'
import { FileTree } from '../../../shared/ui/file-tree/file-tree.js'
import { MasterDetailWorkbench } from '../../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import { LoomScriptSourceFields } from '../../text-transforms/ui/loom-script-source-fields.js'
import { scriptCapabilityLabel } from '../model/script-capabilities.js'
import { createScriptTemplate } from '../model/script-template.js'
import { sceneScriptDevelopment, sceneScriptMetadataId } from '../model/scene-script-development.js'
import styles from './script-management-panel.module.scss'

type ScriptDraft = { script?: LoomScript; owner: LoomScriptOwner; fileName: string; source: string; savedSource: string; savedFileName: string }

export function ScriptManagementPanel(props: {
  api: StudioApi['loomScripts']
  cardId?: string
  onScriptsChanged(): void
  refreshToken?: number
  header?: ReactNode
  t: Translator
}) {
  useSyncExternalStore(sceneScriptDevelopment.subscribe, sceneScriptDevelopment.revision, sceneScriptDevelopment.revision)
  const [scripts, setScripts] = useState<LoomScript[]>([])
  const [mounts, setMounts] = useState<LoomScriptMount[]>([])
  const [draft, setDraft] = useState<ScriptDraft>()
  const [scope, setScope] = useState<'user' | 'card'>('user')
  const [mobilePane, setMobilePane] = useState<'master' | 'detail'>('master')
  const [expandedIds, setExpandedIds] = useState(['user', 'card', 'extension', 'workspace', 'preset'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef(0)
  const target: LoomScriptMountTarget = scope === 'card' && props.cardId ? { kind: 'card', cardId: props.cardId } : { kind: 'user' }
  const targetLabel = target.kind === 'card' ? '当前角色' : '全局'
  const selectedMounts = mounts.filter(mount => mount.scriptDocumentId === draft?.script?.id && sameTarget(mount.target, target))
  const dirty = Boolean(draft && (draft.source !== draft.savedSource || draft.fileName !== draft.savedFileName || !draft.script))

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

  async function run(operation: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    try { await operation() } catch (cause) { setError(readError(cause)) } finally { setBusy(false) }
  }
  function canReplaceDraft() {
    return !dirty || window.confirm('放弃尚未保存的脚本修改？')
  }
  async function selectScript(script: LoomScript) {
    if (busy || !canReplaceDraft()) return
    const request = ++requestRef.current
    await run(async () => {
      const { artifact } = await props.api.export(script.id)
      if (request !== requestRef.current) return
      setDraft({ script, owner: script.owner, fileName: artifact.fileName, source: artifact.source, savedSource: artifact.source, savedFileName: artifact.fileName })
      setMobilePane('detail')
    })
  }
  function startNew() {
    if (!canReplaceDraft()) return
    requestRef.current++
    setDraft({ owner: target, fileName: 'script.loom.js', source: createScriptTemplate(), savedSource: '', savedFileName: '' })
    setMobilePane('detail')
    setError('')
  }
  function startSceneExample() {
    if (busy || !canReplaceDraft()) return
    requestRef.current++
    setDraft({ owner: target, fileName: 'scene-background-card.loom.js', source: sceneScriptDevelopment.source(), savedSource: '', savedFileName: '' })
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
  const nodes = (['user', 'card', 'extension', 'workspace', 'preset'] as const).map(kind => ({
    id: kind,
    kind: 'folder' as const,
    label: ({ user: '个人脚本', card: '角色脚本', extension: '扩展包脚本', workspace: '工作区脚本', preset: '预设脚本' })[kind],
    children: scripts.filter(script => script.owner.kind === kind).map(script => ({ id: script.id, kind: 'entry' as const, label: script.name, meta: `${script.id.slice(-8)} · v${script.version}` })),
  })).filter(node => node.children.length)

  return <MasterDetailWorkbench navigationScope="local" masterWidth={260} mobilePane={mobilePane} onMobilePaneChange={setMobilePane}
    master={<div className={styles.sidebar}>
      {props.header}
      <div className={styles.toolbar}>
        <label className={styles.scope}>创建 / 采用范围<select aria-label="脚本创建与采用范围" disabled={busy} value={target.kind} onChange={event => setScope(event.target.value as 'user' | 'card')}>
          <option value="user">全局</option>{props.cardId ? <option value="card">当前角色</option> : null}
        </select></label>
        <Button size="small" variant="ghost" disabled={busy} onClick={startNew}><Plus size={14} aria-hidden="true" />新建</Button>
        <Button size="small" variant="ghost" disabled={busy} onClick={startSceneExample}>场景卡示例</Button>
        <Button size="small" variant="ghost" disabled={busy} onClick={() => inputRef.current?.click()}><Upload size={14} aria-hidden="true" />导入</Button>
        <input ref={inputRef} hidden type="file" accept=".loom.js,.js,text/javascript" aria-label="导入脚本" onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) void importFile(file) }} />
      </div>
      <div className={styles.tree}>
        <FileTree ariaLabel="脚本" nodes={nodes} selectedId={draft?.script?.id} expandedIds={expandedIds} onExpandedIdsChange={setExpandedIds}
          moreActionsLabel="更多操作" getDisclosureLabel={node => node.label} getDragLabel={node => node.label}
          renderIcon={() => <Code2 size={14} aria-hidden="true" />} onSelect={node => { const script = scripts.find(item => item.id === node.id); if (script) void selectScript(script) }} />
        {!scripts.length ? <p className={styles.muted}>暂无脚本。新建或导入后，可在选定范围中启用。</p> : null}
      </div>
    </div>}>
    <div className={styles.detail}>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {draft ? <>
        <header className={styles.heading}>
          <div><h3>{draft.script?.name ?? '新脚本'}</h3><small>{scriptOwnerLabel(draft.owner)}{draft.script ? ` · ${draft.script.id} · 已保存 v${draft.script.version}` : ' · 未保存'}</small></div>
          <div className={styles.actions}>
            <Button size="small" disabled={busy || !dirty} onClick={() => void save()}>{props.t('textTransform.save')}</Button>
            <Button size="small" variant="ghost" disabled={busy || !draft.script} onClick={() => void run(async () => { const { artifact } = await props.api.export(draft.script!.id); downloadBlob(new Blob([artifact.source], { type: 'text/javascript' }), artifact.fileName) })}><Download size={14} aria-hidden="true" />导出已保存版本</Button>
          </div>
        </header>
        {draft.script ? <section className={styles.adoption}>
          <h4>{targetLabel}采用</h4><p className={styles.muted}>运行环境：{draft.script.runtime}</p>
          {selectedMounts.length === 0 ? <Button size="small" disabled={busy} onClick={() => void run(async () => {
            await props.api.createMount({ target, scriptDocumentId: draft.script!.id, orderIndex: mounts.filter(mount => sameTarget(mount.target, target)).length })
            await load()
          })}>添加到{targetLabel}（未启用）</Button> : selectedMounts.map(mount => <div className={styles.mount} key={mount.id}>
            <div className={styles.actions}>
              <label><input type="checkbox" checked={mount.enabled} disabled={busy || (!mount.enabled && draft.script!.requestedCapabilities.some(capability => !mount.grantedCapabilities.includes(capability)))} onChange={event => void changeMount(mount, { enabled: event.target.checked })} /> 在{targetLabel}启用</label>
              <Button size="small" variant="ghost" disabled={busy || !mount.enabled} onClick={() => void run(async () => { await props.api.refreshMount({ mountId: mount.id, expectedVersion: mount.version }); await load(); props.onScriptsChanged() })}><RefreshCw size={14} aria-hidden="true" />刷新此实例</Button>
            </div>
            <small className={styles.muted}>采用版本：{mount.adoptedDocumentVersion === undefined ? '尚未启用' : `v${mount.adoptedDocumentVersion}`}</small>
            {import.meta.env.DEV && draft.script?.metadataId === sceneScriptMetadataId && <label className={styles.grant}>
              <input type="checkbox" checked={sceneScriptDevelopment.enabled(mount.id)} onChange={event => sceneScriptDevelopment.setEnabled(mount.id, event.target.checked)} />开发联调：跟随仓库场景卡 JS 热更新（仅当前页面，不保存到脚本文档）
            </label>}
            <fieldset disabled={busy || mount.enabled}><legend>能力授权</legend><p className={styles.muted}>逐项确认后启用；修改授权前请先停用此实例。</p>{draft.script!.requestedCapabilities.length ? draft.script!.requestedCapabilities.map(capability => <label key={capability} className={styles.grant}>
              <input type="checkbox" checked={mount.grantedCapabilities.includes(capability)} onChange={event => void changeMount(mount, { grantedCapabilities: event.target.checked ? [...mount.grantedCapabilities, capability] : mount.grantedCapabilities.filter(value => value !== capability) })} /> {scriptCapabilityLabel(capability)}
            </label>) : <p className={styles.muted}>此脚本未申请额外能力。</p>}</fieldset>
          </div>)}
        </section> : <p className={styles.muted}>创建归属：{scriptOwnerLabel(draft.owner)}。保存后可添加到采用范围。</p>}
        <LoomScriptSourceFields fileName={draft.fileName} source={draft.source} disabled={busy} t={props.t}
          onFileNameChange={fileName => setDraft({ ...draft, fileName })} onSourceChange={source => setDraft({ ...draft, source })} />
      </> : <p className={styles.muted}>选择脚本查看源码、来源及采用配置。</p>}
    </div>
  </MasterDetailWorkbench>
}

function sameTarget(left: LoomScriptMountTarget, right: LoomScriptMountTarget) { return JSON.stringify(left) === JSON.stringify(right) }
function readError(cause: unknown) { return cause instanceof Error ? cause.message : String(cause) }
function scriptOwnerLabel(owner: LoomScriptOwner): string {
  if (owner.kind === 'user') return '个人脚本'
  if (owner.kind === 'card') return `角色：${owner.cardId}`
  if (owner.kind === 'extension') return `扩展包：${owner.packageId}`
  if (owner.kind === 'workspace') return `工作区：${owner.workspaceId}`
  return `预设：${owner.presetId}`
}
