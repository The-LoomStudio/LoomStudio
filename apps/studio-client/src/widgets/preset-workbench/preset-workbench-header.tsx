import { useMemo } from 'react'
import type { PromptResource } from '../../entities/index.js'
import { findContextAssetNode, findContextAssetPath } from '../../features/prompt-resources/model/context-asset-tree.js'
import { readPromptResourceWorkbenchRoot } from '../../features/prompt-resources/model/prompt-resource-view.js'
import { ContextAssetHeader } from '../../features/prompt-resources/ui/context-asset-header/context-asset-header.js'
import { buildContextPathSegments } from '../../features/prompt-resources/ui/context-asset-header/build-context-path-segments.js'
import { useStudioLayoutStore } from '../../shared/studio-shell/studio-layout-store.js'
import { STUDIO_PANEL_PRESENTATION } from '../../shared/studio-shell/studio-panel-presentation.js'
import type { Translator } from '../../shared/i18n/index.js'

export function PresetWorkbenchHeader(props: {
  library?: boolean
  resources: PromptResource[]
  selectedResourceId?: string
  t: Translator
  workspaceId: string
  onSelectResource?: (resourceId: string) => void
}) {
  const definition = STUDIO_PANEL_PRESENTATION.agent
  const presetResources = useMemo(() => props.resources.filter(r => r.resourceKind === 'preset'), [props.resources])
  const selectedId = useStudioLayoutStore(state => state.assetLayouts.preset.views[props.workspaceId]?.selectedId)
  const openAssetDetail = useStudioLayoutStore(state => state.openAssetDetail)
  const setAssetPane = useStudioLayoutStore(state => state.setAssetPane)

  const selectedResource = props.selectedResourceId
    ? presetResources.find(r => r.id === props.selectedResourceId)
    : (selectedId ? presetResources.find(resource => resource.id === selectedId || resource.rootNode.id === selectedId || Boolean(findContextAssetNode([resource.rootNode], selectedId))) : undefined)
      ?? (props.library ? undefined : presetResources[0])

  const isLibrary = Boolean(props.library && !selectedResource)

  const breadcrumbs = isLibrary || !selectedResource || !selectedId
    ? []
    : buildContextPathSegments(
      findContextAssetPath([readPromptResourceWorkbenchRoot(selectedResource)], selectedId),
      (id: string) => {
        setAssetPane('preset', props.workspaceId, 'detail')
        openAssetDetail('preset', props.workspaceId, id)
      },
    )

  return (
    <ContextAssetHeader
      Icon={definition.Icon}
      title={isLibrary ? '预设库' : props.t(definition.labelKey)}
      breadcrumbs={breadcrumbs}
      resources={isLibrary ? [] : presetResources}
      selectedResourceId={isLibrary ? undefined : props.selectedResourceId ?? selectedResource?.id}
      t={props.t}
      onSelectResource={resourceId => props.onSelectResource?.(resourceId)}
    />
  )
}
