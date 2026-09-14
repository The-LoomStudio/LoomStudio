import { useMemo } from 'react'
import type { ContextAssetNode, PromptResource } from '../../entities/index.js'
import { findContextAssetPath, resolveVirtualDisplayName } from '../../features/context-assets/model/context-asset-tree.js'
import { readPromptResourceWorkbenchRoot } from '../../features/context-assets/model/prompt-resource-view.js'
import { findContextNode } from '../../features/context-assets/model/projection-order.js'
import { ContextAssetHeader, type ContextAssetPathSegment } from '../../features/context-assets/ui/context-asset-header/context-asset-header.js'
import { useStudioLayoutStore } from '../../pages/studio/model/studio-layout-store.js'
import { STUDIO_PANEL_PRESENTATION } from '../../pages/studio/model/studio-panel-presentation.js'
import type { Translator } from '../../shared/i18n/index.js'

export function ContextWorkbenchHeader(props: {
  view: 'settings' | 'macros' | 'text'
  resources: PromptResource[]
  selectedResourceId?: string
  t: Translator
  workspaceId: string
  onViewChange: (view: 'settings' | 'macros' | 'text') => void
  onSelectResource?: (resourceId: string) => void
}) {
  const definition = STUDIO_PANEL_PRESENTATION.resource
  const settingResources = useMemo(() => props.resources.filter(r => r.resourceKind === 'setting'), [props.resources])
  const selectedId = useStudioLayoutStore(state => state.assetLayouts.resources.views[props.workspaceId]?.selectedId)
  const openAssetDetail = useStudioLayoutStore(state => state.openAssetDetail)
  const selectedResource = settingResources.find(r => r.id === props.selectedResourceId)
    ?? settingResources.find(resource => resource.id === selectedId || Boolean(findContextNode([resource.rootNode], selectedId)))
    ?? settingResources[0]
  const setAssetPane = useStudioLayoutStore(state => state.setAssetPane)
  const selectNode = (id: string) => {
    setAssetPane('resources', props.workspaceId, 'detail')
    openAssetDetail('resources', props.workspaceId, id)
  }
  const selectedPath = selectedResource && selectedId
    ? buildContextPathSegments(
      findContextAssetPath([readPromptResourceWorkbenchRoot(selectedResource)], selectedId),
      selectNode,
    )
    : []
  const tabOptions: Array<{ id: 'settings' | 'macros' | 'text'; label: string }> = [
    { id: 'settings', label: props.t('context.authoring.settings') },
    { id: 'macros', label: props.t('context.authoring.macros') },
    { id: 'text', label: props.t('rail.textTransform') },
  ]
  const activeTab = tabOptions.find(tab => tab.id === props.view)
  const breadcrumbs: ContextAssetPathSegment[] = activeTab
    ? [{
      id: activeTab.id,
      label: activeTab.label,
      options: tabOptions,
      onSelect: id => {
        if (id !== 'settings' && id !== 'macros' && id !== 'text') return
        setAssetPane('resources', props.workspaceId, 'explorer')
        props.onViewChange(id)
      },
    }, ...selectedPath]
    : []

  return (
    <ContextAssetHeader
      Icon={definition.Icon}
      title={props.t(definition.labelKey)}
      breadcrumbs={breadcrumbs}
      resources={settingResources}
      selectedResourceId={selectedResource?.id}
      t={props.t}
      onSelectResource={resourceId => props.onSelectResource?.(resourceId)}
    />
  )
}

function buildContextPathSegments(pathNodes: ContextAssetNode[], onSelectNode: (id: string) => void): ContextAssetPathSegment[] {
  return pathNodes.slice(1).map((node, index) => {
    const parent = pathNodes[index]
    const options = (parent?.children ?? []).map(sibling => ({
      id: sibling.id,
      label: resolveVirtualDisplayName(sibling.label, sibling.kind),
    }))
    return {
      id: node.id,
      label: resolveVirtualDisplayName(node.label, node.kind),
      options,
      onSelect: onSelectNode,
    }
  })
}
