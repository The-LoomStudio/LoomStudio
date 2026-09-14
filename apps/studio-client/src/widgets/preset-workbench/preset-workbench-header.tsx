import { useMemo } from 'react'
import type { PromptResource } from '../../entities/index.js'
import { findContextAssetPath, resolveVirtualDisplayName } from '../../features/context-assets/model/context-asset-tree.js'
import { readPromptResourceWorkbenchRoot } from '../../features/context-assets/model/prompt-resource-view.js'
import { ContextAssetHeader, type ContextAssetPathSegment } from '../../features/context-assets/ui/context-asset-header/context-asset-header.js'
import { useStudioLayoutStore } from '../../pages/studio/model/studio-layout-store.js'
import { STUDIO_PANEL_PRESENTATION } from '../../pages/studio/model/studio-panel-presentation.js'
import type { Translator } from '../../shared/i18n/index.js'

export function PresetWorkbenchHeader(props: {
  resources: PromptResource[]
  selectedResourceId?: string
  t: Translator
  workspaceId: string
  onSelectResource?: (resourceId: string) => void
}) {
  const definition = STUDIO_PANEL_PRESENTATION.preset
  const activePresetView = useStudioLayoutStore(state => state.presetView)
  const setActivePresetView = useStudioLayoutStore(state => state.setPresetView)
  const presetResources = useMemo(() => props.resources.filter(r => r.resourceKind === 'preset'), [props.resources])
  const selectedResource = presetResources.find(r => r.id === props.selectedResourceId) ?? presetResources[0]
  const selectedId = useStudioLayoutStore(state => state.assetLayouts.preset.views[props.workspaceId]?.selectedId)
  const openAssetDetail = useStudioLayoutStore(state => state.openAssetDetail)
  const setAssetPane = useStudioLayoutStore(state => state.setAssetPane)
  const selectedPath = selectedResource && selectedId
    ? findContextAssetPath([readPromptResourceWorkbenchRoot(selectedResource)], selectedId)
      .slice(1)
      .map((node, index, pathNodes) => {
        const parent = [readPromptResourceWorkbenchRoot(selectedResource), ...pathNodes][index]
        return {
          id: node.id,
          label: resolveVirtualDisplayName(node.label, node.kind),
          options: (parent?.children ?? []).map(sibling => ({
            id: sibling.id,
            label: resolveVirtualDisplayName(sibling.label, sibling.kind),
          })),
        }
      })
    : []
  const tabOptions: Array<{ id: 'assets' | 'text' | 'tools' | 'macros'; label: string }> = [
    { id: 'assets', label: props.t('preset.panel.assets') },
    { id: 'text', label: props.t('rail.textTransform') },
    { id: 'tools', label: props.t('preset.panel.tools') },
    { id: 'macros', label: props.t('context.authoring.macros') },
  ]
  const activeTab = tabOptions.find(tab => tab.id === activePresetView)
  const breadcrumbs: ContextAssetPathSegment[] = activeTab
    ? [{
      id: activeTab.id,
      label: activeTab.label,
      options: tabOptions,
      onSelect: id => {
        if (id !== 'assets' && id !== 'text' && id !== 'tools' && id !== 'macros') return
        setAssetPane('preset', props.workspaceId, 'explorer')
        setActivePresetView(id)
      },
    }, ...selectedPath.map(segment => ({ ...segment, onSelect: (id: string) => {
      setAssetPane('preset', props.workspaceId, 'detail')
      openAssetDetail('preset', props.workspaceId, id)
    } }))]
    : []

  return (
    <ContextAssetHeader
      Icon={definition.Icon}
      title={props.t(definition.labelKey)}
      breadcrumbs={breadcrumbs}
      resources={presetResources}
      selectedResourceId={selectedResource?.id}
      t={props.t}
      onSelectResource={resourceId => props.onSelectResource?.(resourceId)}
    />
  )
}
