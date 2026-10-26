import { FileText, Folder } from 'lucide-react'
import type { ObservationSource } from '../../features/observability/model/observation-view.js'
import type { Translator } from '../../shared/i18n/index.js'
import { renderContextAssetTreeIcon, readContextAssetBadgeInfo } from '../../features/prompt-resources/ui/context-asset-tree.js'
import styles from '../../features/observability/ui/observability-workbench.module.scss'
export function ObservationSourceIcon({ source, expanded, t }: { source?: ObservationSource; expanded: boolean; t: Translator }) {
  if (!source) return <Folder size={15} />
  if (!source.nodeKind || (!source.activationKind && !source.lifecycle && ['entry', 'script'].includes(source.nodeKind))) return <FileText size={14} />
  const node: Parameters<typeof renderContextAssetTreeIcon>[0] = {
    id: source.id, kind: source.nodeKind,
    capabilities: {
      ...(source.activationKind ? { activation: { kind: source.activationKind } } : {}),
      ...(source.lifecycle ? { lifecycle: { lifecycle: source.lifecycle } } : {}),
    },
  }
  const badge = ['entry', 'script'].includes(node.kind) ? readContextAssetBadgeInfo(node, t) : null
  return <span className={styles.sourceIcon} aria-label={badge?.label} title={badge?.label}>{renderContextAssetTreeIcon(node, expanded)}</span>
}
