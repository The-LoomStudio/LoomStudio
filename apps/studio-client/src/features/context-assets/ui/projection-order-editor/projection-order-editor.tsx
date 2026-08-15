import type { Translator } from '../../../../shared/i18n/index.js'
import type { ProjectionOrderEntry } from '../../model/projection-order.js'
import { ProjectionRunlist } from '../projection-runlist/projection-runlist.js'

type ProjectionOrderEditorProps = {
  entries: ProjectionOrderEntry[]
  onReorder: (draggedId: string, targetId: string) => void
  onReorderZone: (draggedZoneId: string, targetZoneId: string) => void
  selectedId?: string
  t: Translator
}

export function ProjectionOrderEditor(props: ProjectionOrderEditorProps) {
  return (
    <ProjectionRunlist
      entries={props.entries}
      onReorder={props.onReorder}
      onReorderZone={props.onReorderZone}
      selectedId={props.selectedId}
      showSummary
      t={props.t}
    />
  )
}
