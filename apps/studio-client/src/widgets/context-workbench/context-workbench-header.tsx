import { useMemo } from 'react'
import type { PromptResource } from '../../entities/index.js'
import { findContextAssetPath } from '../../features/prompt-resources/model/context-asset-tree.js'
import { readPromptResourceWorkbenchRoot } from '../../features/prompt-resources/model/prompt-resource-view.js'
import { findContextAssetNode } from '../../features/prompt-resources/model/context-asset-tree.js'
import { ContextAssetHeader } from '../../features/prompt-resources/ui/context-asset-header/context-asset-header.js'
import { buildContextPathSegments } from '../../features/prompt-resources/ui/context-asset-header/build-context-path-segments.js'
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
  const loreResources = useMemo(() => props.resources.filter(r => r.resourceKind === 'lore'), [props.resources])
  const selectedId = useStudioLayoutStore(state => state.assetLayouts.resources.views[props.workspaceId]?.selectedId)
  const openAssetDetail = useStudioLayoutStore(state => state.openAssetDetail)
  const selectedResource = props.selectedResourceId
    ? loreResources.find(r => r.id === props.selectedResourceId)
    : loreResources.find(resource => resource.id === selectedId || Boolean(findContextAssetNode([resource.rootNode], selectedId)))
      ?? loreResources[0]
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
      resources={loreResources}
      selectedResourceId={props.selectedResourceId ?? selectedResource?.id}
      t={props.t}
      onSelectResource={resourceId => props.onSelectResource?.(resourceId)}
    />
  )
}
