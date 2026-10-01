import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Clock, Code2, Copy, FileText, Folder, FolderOpen, Globe, Layers, Maximize2, Minus, Plus, RefreshCw, Save } from 'lucide-react'
import { toast } from 'sonner'
import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { StateSnapshot, StateTarget } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import type { MenuAction } from '@loom-studio/ui'
import { FileTree, type FileTreeNode } from '../../../shared/ui/file-tree/file-tree.js'
import { MasterDetailWorkbench } from '../../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import styles from './state-variables-panel.module.scss'
import { createBatchSetStatePropertiesInput, stateSnapshotToTreeNodes, type StateTreeNodeCapabilities } from '../model/state-variable-editor.js'

type Props = {
  api: StudioApi['states']
  timelineTarget?: Extract<StateTarget, { scope: 'timeline' }>
  refreshToken?: string
  t: Translator
  canOpenTimelineSource?: boolean
  onOpenSource?(scope: 'global' | 'timeline'): void
  onStateMutated?(): void | Promise<void>
}

type RuntimeScope = 'global' | 'timeline'
type SnapshotSource = { api: Props['api']; key: string }

export function StateVariablesPanel(props: Props) {
  const [globalSnapshot, setGlobalSnapshot] = useState<StateSnapshot>()
  const [timelineSnapshot, setTimelineSnapshot] = useState<StateSnapshot>()
  const [scope, setScope] = useState<RuntimeScope>(props.timelineTarget ? 'timeline' : 'global')
  const [mobilePane, setMobilePane] = useState<'master' | 'detail'>('master')
  const [editedProperties, setEditedProperties] = useState<Record<string, unknown>>({})
  const [draftContextKey, setDraftContextKey] = useState('')
  const [snapshotSource, setSnapshotSource] = useState<SnapshotSource>()
  const [treeExpandedIds, setTreeExpandedIds] = useState<string[]>([])
  const [expandedLongTextPaths, setExpandedLongTextPaths] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const requestIdRef = useRef(0)
  const saveRequestRef = useRef<symbol | undefined>(undefined)
  const mountedRef = useRef(true)
  const targetKey = JSON.stringify([props.timelineTarget?.timelineId, props.timelineTarget?.branchId, props.refreshToken])
  const sourceRef = useRef<SnapshotSource>({ api: props.api, key: targetKey })
  if (sourceRef.current.api !== props.api || sourceRef.current.key !== targetKey) {
    sourceRef.current = { api: props.api, key: targetKey }
  }
  const source = sourceRef.current

  const currentSnapshot = snapshotSource === source
    ? (scope === 'timeline' ? timelineSnapshot : globalSnapshot)
    : undefined
  const editContextKey = currentSnapshot
    ? `${targetKey}:${scope}:${currentSnapshot.revisionId}`
    : `${targetKey}:${scope}:loading`
  const editContextRef = useRef(editContextKey)
  editContextRef.current = editContextKey
  const treeNodes = useMemo(
    () => stateSnapshotToTreeNodes(currentSnapshot?.value),
    [currentSnapshot?.value],
  )
  const dirtyCount = Object.keys(editedProperties).length

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestIdRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (!props.timelineTarget) setScope('global')
  }, [props.timelineTarget])

  useEffect(() => {
    saveRequestRef.current = undefined
    setSaving(false)
    setDraftContextKey(editContextKey)
    setEditedProperties({})
  }, [source, editContextKey])

  useEffect(() => {
    if (treeNodes.length > 0 && treeExpandedIds.length === 0) {
      setTreeExpandedIds(treeNodes.map(node => node.id))
    }
  }, [treeExpandedIds.length, treeNodes])

  async function refresh() {
    const requestId = ++requestIdRef.current
    const target = props.timelineTarget
    try {
      const [globalResult, timelineResult] = await Promise.all([
        props.api.get({ scope: 'global' }),
        target ? props.api.get(target) : Promise.resolve(undefined),
      ])
      if (!mountedRef.current || requestId !== requestIdRef.current || sourceRef.current !== source) return
      setGlobalSnapshot(globalResult.snapshot)
      setTimelineSnapshot(timelineResult?.snapshot)
      setSnapshotSource(source)
      setError('')
    } catch (cause) {
      if (mountedRef.current && requestId === requestIdRef.current && sourceRef.current === source) {
        setError(readError(cause))
      }
    }
  }

  useEffect(() => {
    setSnapshotSource(undefined)
    setGlobalSnapshot(undefined)
    setTimelineSnapshot(undefined)
    setDraftContextKey('')
    setEditedProperties({})
    setError('')
    void refresh()
  }, [source])

  async function saveAllDirtyProperties() {
    const snapshot = currentSnapshot
    const saveContextKey = draftContextKey
    const changes = editedProperties as Record<string, ClientJsonValue>
    if (!snapshot || dirtyCount === 0 || saveRequestRef.current || sourceRef.current !== source
      || saveContextKey !== editContextRef.current) return
    const expectedTarget: StateTarget | undefined = scope === 'global' ? { scope: 'global' } : props.timelineTarget
    if (!expectedTarget || snapshot.target.scope !== expectedTarget.scope
      || (snapshot.target.scope === 'timeline' && expectedTarget.scope === 'timeline'
        && (snapshot.target.timelineId !== expectedTarget.timelineId || snapshot.target.branchId !== expectedTarget.branchId))) {
      setError(props.t('stateVariables.targetMismatch'))
      return
    }
    const request = Symbol()
    saveRequestRef.current = request
    setSaving(true)
    try {
      await props.api.apply(createBatchSetStatePropertiesInput(snapshot.target, snapshot.revisionId, changes))
      if (!mountedRef.current || sourceRef.current !== source || saveRequestRef.current !== request || editContextRef.current !== saveContextKey) return
      setEditedProperties({})
      toast.success(`${props.t('stateVariables.savedProperties')} ${Object.keys(changes).length}`)
      await refresh()
      if (mountedRef.current && sourceRef.current === source) void props.onStateMutated?.()
    } catch (cause) {
      if (mountedRef.current && sourceRef.current === source && saveRequestRef.current === request) setError(readError(cause))
    } finally {
      if (mountedRef.current && sourceRef.current === source && saveRequestRef.current === request) {
        saveRequestRef.current = undefined
        setSaving(false)
      }
    }
  }

  function toggleExpanded(path: string) {
    setExpandedLongTextPaths(previous => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function copyMacro(token: string) {
    void navigator.clipboard.writeText(token).then(() => {
      toast.success(`${props.t('stateVariables.copiedMacro')}: ${token}`)
    })
  }

  function setProperty(path: string, value: unknown) {
    if (saveRequestRef.current || sourceRef.current !== source || editContextRef.current !== editContextKey) return
    setEditedProperties(previous => ({ ...previous, [path]: value }))
  }

  function renderTrailing(node: FileTreeNode) {
    const capabilities = node.capabilities as StateTreeNodeCapabilities | undefined
    if (!capabilities || node.container || node.kind === 'object') return null
    const currentValue = editedProperties[capabilities.path] !== undefined
      ? editedProperties[capabilities.path]
      : capabilities.value

    if (capabilities.type === 'number') {
      const value = typeof currentValue === 'number' ? currentValue : 0
      return (
        <div className={styles.treeTrailingControl}>
          <div className={styles.stepperContainer}>
            <button
              aria-label={props.t('stateVariables.decrease')}
              className={styles.stepperBtn}
              type="button"
              onClick={() => setProperty(capabilities.path, value - 1)}
            >
              <Minus aria-hidden="true" size={12} />
            </button>
            <input
              aria-label={capabilities.path}
              className={styles.stepperInput}
              type="number"
              value={typeof currentValue === 'number' ? currentValue : ''}
              onChange={event => setProperty(capabilities.path, event.target.value === '' ? 0 : Number(event.target.value))}
              onKeyDown={event => { if (event.key === 'Enter') void saveAllDirtyProperties() }}
            />
            <button
              aria-label={props.t('stateVariables.increase')}
              className={styles.stepperBtn}
              type="button"
              onClick={() => setProperty(capabilities.path, value + 1)}
            >
              <Plus aria-hidden="true" size={12} />
            </button>
          </div>
        </div>
      )
    }

    if (capabilities.type === 'boolean') {
      const currentBoolean = currentValue === true
      return (
        <div className={styles.treeTrailingControl}>
          <button
            aria-checked={currentBoolean}
            aria-label={capabilities.path}
            className={styles.toggleBtn}
            role="switch"
            type="button"
            onClick={() => setProperty(capabilities.path, !currentBoolean)}
          >
            <span className={styles.toggleTrack}><span className={styles.toggleThumb} /></span>
            <span>{currentBoolean ? 'true' : 'false'}</span>
          </button>
        </div>
      )
    }

    if (capabilities.isLongText) {
      const expanded = expandedLongTextPaths.has(capabilities.path)
      return (
        <div className={styles.treeTrailingControl}>
          <span className={styles.treePreviewText} title={String(currentValue ?? '')}>
            {String(currentValue ?? '').replace(/\n/g, ' ').slice(0, 24)}
            {String(currentValue ?? '').length > 24 ? '…' : ''}
          </span>
          <button
            aria-label={expanded ? props.t('stateVariables.collapseEditor') : props.t('stateVariables.expandEditor')}
            className={styles.iconButton}
            type="button"
            onClick={() => toggleExpanded(capabilities.path)}
          >
            {expanded ? <ChevronUp aria-hidden="true" size={12} /> : <ChevronDown aria-hidden="true" size={12} />}
            <span>{expanded ? props.t('stateVariables.collapse') : props.t('stateVariables.edit')}</span>
          </button>
        </div>
      )
    }

    return (
      <div className={styles.treeTrailingControl}>
        <input
          aria-label={capabilities.path}
          className={styles.propertyTextInput}
          type="text"
          value={typeof currentValue === 'string' ? currentValue : String(currentValue ?? '')}
          onChange={event => setProperty(capabilities.path, event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') void saveAllDirtyProperties() }}
        />
      </div>
    )
  }

  function renderExpandedRow(node: FileTreeNode) {
    const capabilities = node.capabilities as StateTreeNodeCapabilities | undefined
    if (!capabilities?.isLongText || !expandedLongTextPaths.has(capabilities.path)) return null
    const currentValue = editedProperties[capabilities.path] !== undefined
      ? editedProperties[capabilities.path]
      : capabilities.value
    return (
      <div className={styles.treeLongTextDrawer}>
        <textarea
          aria-label={capabilities.path}
          className={styles.treeLongTextarea}
          rows={4}
          value={typeof currentValue === 'string' ? currentValue : String(currentValue ?? '')}
          onChange={event => setProperty(capabilities.path, event.target.value)}
        />
        <div className={styles.treeLongTextActions}>
          <span className={styles.cardFooterMeta}>{props.t('stateVariables.macro')}: {capabilities.macroToken} · {String(currentValue ?? '').length}</span>
          <button className={styles.iconButton} type="button" onClick={() => copyMacro(capabilities.macroToken)}>
            <Copy aria-hidden="true" size={12} />
            <span>{props.t('stateVariables.copyMacro')}</span>
          </button>
        </div>
      </div>
    )
  }

  function getActions(node: FileTreeNode): MenuAction[] {
    const capabilities = node.capabilities as StateTreeNodeCapabilities | undefined
    if (!capabilities) return []
    const actions: MenuAction[] = [
      {
        id: 'copy-macro',
        label: `${props.t('stateVariables.copyMacro')} (${capabilities.macroToken})`,
        icon: <Copy aria-hidden="true" />,
        onSelect: () => copyMacro(capabilities.macroToken),
      },
      {
        id: 'copy-pointer',
        label: `${props.t('stateVariables.copyPointer')} (${capabilities.path})`,
        icon: <Code2 aria-hidden="true" />,
        onSelect: () => void navigator.clipboard.writeText(capabilities.path),
      },
    ]
    if (capabilities.value !== undefined && !node.container && node.kind !== 'object') {
      actions.push({
        id: 'copy-value',
        label: props.t('stateVariables.copyValue'),
        icon: <FileText aria-hidden="true" />,
        onSelect: () => void navigator.clipboard.writeText(String(capabilities.value)),
      })
    }
    if (capabilities.isLongText) {
      actions.push(
        { id: 'longtext-separator', type: 'separator' },
        {
          id: 'expand-longtext',
          label: props.t('stateVariables.expandEditor'),
          icon: <Maximize2 aria-hidden="true" />,
          onSelect: () => toggleExpanded(capabilities.path),
        },
      )
    }
    return actions
  }

  const runtimeScopeNodes: FileTreeNode[] = useMemo(() => [
    {
      id: 'runtime-group',
      label: props.t('stateVariables.runtimeGroup'),
      kind: 'folder',
      children: [
        {
          id: 'timeline',
          label: props.t('stateVariables.timelineState'),
          kind: 'entry',
          meta: props.timelineTarget ? `${props.timelineTarget.timelineId} · ${props.timelineTarget.branchId}` : props.t('stateVariables.noTimeline'),
          disabled: !props.timelineTarget,
        },
        {
          id: 'global',
          label: props.t('stateVariables.globalState'),
          kind: 'entry',
          meta: props.t('stateVariables.globalDescription'),
        },
      ],
    },
  ], [props.t, props.timelineTarget])

  const [runtimeExpandedIds, setRuntimeExpandedIds] = useState<string[]>(['runtime-group'])

  return (
    <section className={styles.panel} data-loom-component="state-variables-panel">
      <header className={styles.intro}>
        <h2>{props.t('stateVariables.title')}</h2>
        <button aria-label={props.t('stateVariables.refresh')} className={styles.iconButton} disabled={saving} type="button" onClick={() => void refresh()}>
          <RefreshCw aria-hidden="true" size={13} />
          <span>{props.t('stateVariables.refresh')}</span>
        </button>
      </header>
      {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
      <MasterDetailWorkbench
        backLabel={props.t('stateAuthoring.backToList')}
        resizeLabel={props.t('stateVariables.resizeSidebar')}
        className={styles.panelBody}
        mobilePane={mobilePane}
        onMobilePaneChange={setMobilePane}
        master={(
          <div className={styles.treeContainer}>
            <FileTree
              ariaLabel={props.t('stateVariables.navigation')}
              expandedIds={runtimeExpandedIds}
              getDisclosureLabel={(node, expanded) => `${expanded ? props.t('stateVariables.collapse') : props.t('stateVariables.expand')} ${node.label}`}
              getDragLabel={node => node.label}
              moreActionsLabel={props.t('stateVariables.actions')}
              nodes={runtimeScopeNodes}
              onExpandedIdsChange={setRuntimeExpandedIds}
              onSelect={node => {
                if (node.id === 'timeline' && props.timelineTarget) {
                  setScope('timeline')
                  setMobilePane('detail')
                } else if (node.id === 'global') {
                  setScope('global')
                  setMobilePane('detail')
                } else if (node.id === 'runtime-group') {
                  setRuntimeExpandedIds(prev => prev.includes('runtime-group') ? [] : ['runtime-group'])
                }
              }}
              renderIcon={(node, expanded) => {
                if (node.id === 'runtime-group') return expanded ? <FolderOpen size={16} /> : <Folder size={16} />
                if (node.id === 'timeline') return <Clock size={16} />
                if (node.id === 'global') return <Globe size={16} />
                return null
              }}
              selectedId={scope}
            />
          </div>
        )}
      >
        <div className={styles.detailPane}>
          <header className={styles.detailHeader}>
            <div className={styles.headerTitle}>
              <Layers aria-hidden="true" size={15} />
              <h3>{scope === 'timeline' ? props.t('stateVariables.timelineRuntime') : props.t('stateVariables.globalRuntime')}</h3>
              <span className={styles.badge}>{props.t('stateVariables.revision')}: {(currentSnapshot?.revisionId ?? '').slice(0, 8) || '-'}</span>
            </div>
            <div className={styles.headerActions}>
              {props.onOpenSource && scope === 'timeline' && props.canOpenTimelineSource ? (
                <button className={styles.iconButton} type="button" onClick={() => props.onOpenSource?.(scope)}>
                  <Code2 aria-hidden="true" size={13} />
                  <span>{props.t('stateVariables.openSource')}</span>
                </button>
              ) : null}
              <button className={styles.primaryActionBtn} disabled={!currentSnapshot || draftContextKey !== editContextKey || dirtyCount === 0 || saving} type="button" onClick={() => void saveAllDirtyProperties()}>
                <Save aria-hidden="true" size={13} />
                <span>{props.t('stateVariables.saveChanges')}{saving ? '…' : dirtyCount > 0 ? ` (${dirtyCount})` : ''}</span>
              </button>
            </div>
          </header>
          <div className={styles.treeContainer} inert={saving} aria-busy={saving}>
            {scope === 'timeline' && props.timelineTarget ? <div className={styles.scopeBanner}>{props.timelineTarget.timelineId} · {props.timelineTarget.branchId}</div> : null}
            {treeNodes.length === 0 ? (
              <div className={styles.emptyState}><p>{props.t('stateVariables.emptyRuntime')}</p></div>
            ) : (
              <FileTree
                ariaLabel={props.t('stateVariables.treeLabel')}
                expandedIds={treeExpandedIds}
                getDisclosureLabel={(node, expanded) => `${expanded ? props.t('stateVariables.collapse') : props.t('stateVariables.expand')} ${node.label}`}
                getDragLabel={node => node.label}
                getActions={getActions}
                hasActions={node => Boolean(node.capabilities)}
                moreActionsLabel={props.t('stateVariables.actions')}
                nodes={treeNodes}
                onExpandedIdsChange={setTreeExpandedIds}
                onSelect={() => undefined}
                renderTrailing={renderTrailing}
                renderExpandedRow={renderExpandedRow}
              />
            )}
          </div>
        </div>
      </MasterDetailWorkbench>
    </section>
  )
}

function readError(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
