import { useEffect, useMemo, useRef, useState } from 'react'
import type { LoomScriptMountTarget } from '@loom-studio/shared/loom-scripts'
import type { LoomScript, LoomScriptMount, ResolvedLoomScriptRendererMount, UnavailableLoomScriptMount } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import { notify } from '../../../shared/notifications/index.js'
import { createScriptTemplate } from './script-template.js'

type Input = {
  loomScriptsApi?: StudioApi['loomScripts']; t: Translator; onRuntimeChanged?: () => void
  ownerKey: string; scriptOwner?: LoomScriptMountTarget; authoring: boolean
  runtimeScriptContext?: { workspaceId?: string; timelineId?: string; presetId?: string }
}
export function useScopedScriptEditor(props: Input) {
  const { authoring, scriptOwner } = props
  const runtimeKey = authoring ? '' : JSON.stringify(props.runtimeScriptContext ?? {})
  const catalogScope = useMemo(() => ({}), [props.loomScriptsApi, props.ownerKey, runtimeKey])
  const catalogScopeRef = useRef(catalogScope); catalogScopeRef.current = catalogScope
  const mountedRef = useRef(true)
  const refreshRequest = useRef(0)
  const scriptReadRef = useRef(0)
  const [scripts, setScripts] = useState<LoomScript[]>([])
  const [mounts, setMounts] = useState<LoomScriptMount[]>([])
  const [resolvedMounts, setResolvedMounts] = useState<ResolvedLoomScriptRendererMount[]>([])
  const [unavailableMounts, setUnavailableMounts] = useState<UnavailableLoomScriptMount[]>([])
  const [scriptSource, setScriptSource] = useState('')
  const [scriptFileName, setScriptFileName] = useState('script.loom.js')
  const [scriptDraft, setScriptDraft] = useState<{ scope: typeof catalogScope; id: string; version: number }>()
  const [selectedScriptId, setSelectedScriptId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setErrorState] = useState('')
  function isCurrentCatalog() { return mountedRef.current && catalogScopeRef.current === catalogScope }
  function setError(value: string) { if (isCurrentCatalog()) setErrorState(value) }
  const visibleMounts = scriptOwner ? mounts.filter(mount => JSON.stringify(mount.target) === JSON.stringify(scriptOwner)) : mounts
  const visibleScripts = visibleMounts.map(mount => ({ mount, script: scripts.find(script => script.id === mount.scriptDocumentId) })).filter((item): item is { mount: LoomScriptMount; script: LoomScript } => Boolean(item.script))
  async function refresh() {
    if (!isCurrentCatalog()) return
    const request = ++refreshRequest.current
    setBusy(true)
    try {
      const [scriptResult, mountResult, resolvedResult] = await Promise.all([
        authoring ? (props.loomScriptsApi?.list() ?? Promise.resolve({ scripts: [] })) : Promise.resolve({ scripts: [] }),
        authoring ? (props.loomScriptsApi?.listMounts(scriptOwner) ?? Promise.resolve({ mounts: [] })) : Promise.resolve({ mounts: [] }),
        !authoring && props.loomScriptsApi ? props.loomScriptsApi.resolveRendererMounts(props.runtimeScriptContext) : Promise.resolve({ mounts: [], unavailableMounts: [] }),
      ])
      if (!isCurrentCatalog() || request !== refreshRequest.current) return
      setScripts(scriptResult.scripts); setMounts(mountResult.mounts)
      setResolvedMounts(resolvedResult.mounts); setUnavailableMounts(resolvedResult.unavailableMounts); setError('')
    } catch (cause) { if (isCurrentCatalog() && request === refreshRequest.current) setError(readError(cause)) }
    finally { if (isCurrentCatalog() && request === refreshRequest.current) setBusy(false) }
  }
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; refreshRequest.current++ } }, [])
  useEffect(() => { setSelectedScriptId(''); setScriptDraft(undefined); setError(''); void refresh() }, [catalogScope])
  async function selectScript(id: string, importedScript?: LoomScript) {
    const request = ++scriptReadRef.current
    setScriptDraft(undefined)
    setScriptSource('')
    setSelectedScriptId(id)
    const resolved = resolvedMounts.find(item => item.script.id === id)
    if (resolved) {
      setScriptSource(resolved.source)
      setScriptFileName(`${resolved.script.metadataId}.loom.js`)
      setScriptDraft({ scope: catalogScope, id, version: resolved.script.version })
      return
    }
    const script = importedScript ?? scripts.find(item => item.id === id)
    if (!script || !props.loomScriptsApi) return
    try {
      setBusy(true)
      const result = await props.loomScriptsApi.export(id)
      if (!isCurrentCatalog() || request !== scriptReadRef.current) return
      setScriptSource(result.artifact.source)
      setScriptFileName(result.artifact.fileName)
      setScriptDraft({ scope: catalogScope, id, version: script.version })
    } catch (cause) {
      if (isCurrentCatalog() && request === scriptReadRef.current) setError(readError(cause))
    } finally {
      if (isCurrentCatalog() && request === scriptReadRef.current) setBusy(false)
    }
  }

  async function importScript(file: File) {
    if (!scriptOwner || !props.loomScriptsApi) return
    try {
      setBusy(true)
      const source = await file.text()
      const result = await props.loomScriptsApi.import({ owner: scriptOwner, fileName: file.name, source, mount: { target: scriptOwner, orderIndex: visibleMounts.length } })
      await refresh()
      await selectScript(result.script.id, result.script)
      notify.success(props.t('notify.success.imported'))
      return result.script.id
    } catch (cause) {
      const message = readError(cause)
      setError(message)
      notify.failure('脚本编辑操作未完成', message)
    } finally { setBusy(false) }
  }

  async function createScript() {
    if (!scriptOwner || !props.loomScriptsApi) return
    try {
      setBusy(true)
      const result = await props.loomScriptsApi.import({ owner: scriptOwner, fileName: 'script.loom.js', source: createScriptTemplate(), mount: { target: scriptOwner, orderIndex: visibleMounts.length } })
      await refresh()
      await selectScript(result.script.id, result.script)
      notify.success(props.t('notify.success.saved'))
      return result.script.id
    } catch (cause) { setError(readError(cause)) } finally { setBusy(false) }
  }

  async function refreshScriptMount(mount: LoomScriptMount) {
    if (!props.loomScriptsApi) return
    try {
      setBusy(true)
      await props.loomScriptsApi.refreshMount({ mountId: mount.id, expectedVersion: mount.version })
      await refresh()
      props.onRuntimeChanged?.()
    } catch (cause) { setError(readError(cause)) } finally { setBusy(false) }
  }

  async function saveScript() {
    if (!selectedScriptId || !props.loomScriptsApi) return
    const script = scripts.find(item => item.id === selectedScriptId)
    if (!script || !scriptDraft || scriptDraft.scope !== catalogScope || scriptDraft.id !== script.id || !isCurrentCatalog()) return
    try {
      setBusy(true)
      const result = await props.loomScriptsApi.update({ scriptDocumentId: scriptDraft.id, expectedVersion: scriptDraft.version, fileName: scriptFileName, source: scriptSource })
      setScriptDraft(current => current === scriptDraft ? { ...current, version: result.script.version } : current)
      await refresh()
      notify.success(props.t('notify.success.saved'))
    } catch (cause) {
      const message = readError(cause)
      setError(message)
      notify.failure('脚本编辑操作未完成', message)
    } finally { setBusy(false) }
  }

  async function updateScriptMount(mount: LoomScriptMount, patch: Partial<Pick<LoomScriptMount, 'enabled' | 'orderIndex' | 'grantedCapabilities'>>) {
    if (!props.loomScriptsApi) return
    try {
      setBusy(true)
      await props.loomScriptsApi.updateMount({ mountId: mount.id, expectedVersion: mount.version, enabled: patch.enabled ?? mount.enabled, orderIndex: patch.orderIndex ?? mount.orderIndex, ...(mount.pinnedDocumentVersion !== undefined ? { pinnedDocumentVersion: mount.pinnedDocumentVersion } : {}), grantedCapabilities: patch.grantedCapabilities ?? mount.grantedCapabilities })
      await refresh()
      props.onRuntimeChanged?.()
    } catch (cause) { setError(readError(cause)) } finally { setBusy(false) }
  }

  return { visibleScripts, resolvedMounts, unavailableMounts, scriptSource, scriptFileName, setScriptSource, setScriptFileName,
    selectScript, importScript, createScript, refreshScriptMount, saveScript, updateScriptMount, refresh, busy, error,
    canCreateScript: Boolean(scriptOwner) }
}
function readError(value: unknown): string { return value instanceof Error ? value.message : String(value) }
