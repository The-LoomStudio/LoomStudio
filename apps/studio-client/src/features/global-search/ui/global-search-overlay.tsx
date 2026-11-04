import type { GlobalSearchHit } from '@loom-studio/shared'
import type { StudioPanelId } from '../../../shared/studio-shell/studio-layout-store.js'
import { GlobalSearchDialog } from '../../../widgets/global-search/global-search-dialog.js'
import { useGlobalSearch, type GlobalSearchInput } from '../model/use-global-search.js'

/** Candidate input, debounce and query results belong to the search overlay. */
export function GlobalSearchOverlay(props: GlobalSearchInput & {
  recent: GlobalSearchHit[]
  onClose(): void
  onOpenPanel(panel: StudioPanelId): void
  onOpenResult(hit: GlobalSearchHit, query: string): void
}) {
  const search = useGlobalSearch(props)
  return <GlobalSearchDialog open={props.open} search={search} recent={props.recent} t={props.t}
    onClose={props.onClose} onOpenPanel={props.onOpenPanel}
    onOpenResult={hit => props.onOpenResult(hit, search.query)} />
}
