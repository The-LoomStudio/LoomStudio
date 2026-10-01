import { useMemo } from 'react'
import type { ContextAssetNode, PromptResource } from '../../entities/index.js'
import { findContextAssetPath, resolveVirtualDisplayName } from '../../features/context-assets/model/context-asset-tree.js'
import { readPromptResourceWorkbenchRoot } from '../../features/context-assets/model/prompt-resource-view.js'
import { findContextNode } from '../../features/context-assets/model/projection-order.js'
import { ContextAssetHeader, type ContextAssetPathSegment } from '../../features/context-assets/ui/context-asset-header/context-asset-header.js'
import { useStudioLayoutStore } from '../../shared/studio-shell/studio-layout-store.js'
import { STUDIO_PANEL_PRESENTATION } from '../../shared/studio-shell/studio-panel-presentation.js'
import type { Translator } from '../../shared/i18n/index.js'

export function ContextWorkbenchHeader(props: {
  resources: PromptResource[]
  selectedResourceId?: string
  t: Translator
  workspaceId: string
  onSelectResource?: (resourceId: string) => void
}) {
  const definition = STUDIO_PANEL_PRESENTATION.resource
  const settingResources = useMemo(() => props.resources.filter(r => r.resourceKind === 'setting'), [props.resources])
  const selectedId = useStudioLayoutStore(state => state.assetLayouts.resources.views[props.workspaceId]?.selectedId)
  const openAssetDetail = useStudioLayoutStore(state => state.openAssetDetail)
  const selectedResource = props.selectedResourceId
    ? settingResources.find(r => r.id === props.selectedResourceId)
    : settingResources.find(resource => resource.id === selectedId || Boolean(findContextNode([resource.rootNode], selectedId)))
      ?? settingResources[0]
  const setAssetPane = useStudioLayoutStore(state => state.setAssetPane)
  const selectNode = (id: string) => {
    setAssetPane('resources', props.workspaceId, 'detail')
    openAssetDetail('resources', props.workspaceId, id)
  }
  const breadcrumbs = selectedResource && selectedId
    ? buildContextPathSegments(
      findContextAssetPath([readPromptResourceWorkbenchRoot(selectedResource)], selectedId),
      selectNode,
    )
    : []

  return (
    <ContextAssetHeader
      Icon={definition.Icon}
      title={props.t(definition.labelKey)}
      breadcrumbs={breadcrumbs}
      resources={settingResources}
      selectedResourceId={props.selectedResourceId ?? selectedResource?.id}
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
