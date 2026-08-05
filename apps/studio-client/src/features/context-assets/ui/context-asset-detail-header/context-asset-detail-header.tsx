import { SlidersHorizontal } from 'lucide-react'
import type { ContextAssetNode } from '../../../../entities/index.js'
import type { Translator } from '../../../../shared/i18n/index.js'
import { Toggle } from '../../../../shared/ui/toggle/toggle.js'
import styles from './context-asset-detail-header.module.scss'

type ContextAssetDetailHeaderProps = {
  metadataOpen: boolean
  node?: ContextAssetNode
  toggleEnabled: boolean
  t: Translator
  onEnabledChange(enabled: boolean): void
  onMetadataOpenChange(open: boolean): void
}

export function ContextAssetDetailHeader(props: ContextAssetDetailHeaderProps) {
  const muted = props.node?.kind === 'entry' && props.node.enabled === false

  return (
    <header className={`${styles.header} ${muted ? styles.muted : ''}`}>
      <p>{readKindLabel(props.node, props.t)}</p>
      <div className={styles.titleRow}>
        {props.toggleEnabled && props.node ? (
          <Toggle
            checked={props.node.enabled !== false}
            label={props.t(props.node.enabled === false ? 'context.actionEnable' : 'context.actionDisable')}
            onChange={props.onEnabledChange}
          />
        ) : null}
        <h1>{props.node?.label ?? props.t('context.emptyTitle')}</h1>
        {props.node && props.node.kind !== 'order' ? (
          <button
            aria-expanded={props.metadataOpen}
            aria-label={props.t(props.metadataOpen ? 'context.hideMetadata' : 'context.showMetadata')}
            className={`${styles.metadataToggle} ${props.metadataOpen ? styles.metadataToggleActive : ''}`}
            title={props.t(props.metadataOpen ? 'context.hideMetadata' : 'context.showMetadata')}
            type="button"
            onClick={() => props.onMetadataOpenChange(!props.metadataOpen)}
            onMouseDown={event => event.preventDefault()}
          >
            <SlidersHorizontal aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <span>{props.node?.meta ?? props.t('context.emptyBody')}</span>
    </header>
  )
}

function readKindLabel(node: ContextAssetNode | undefined, t: Translator): string {
  if (!node) return t('context.detailLabel')
  if (node.kind === 'module') return t('context.kind.module')
  if (node.kind === 'folder') return t('context.kind.folder')
  if (node.kind === 'script') return t('context.kind.script')
  if (node.kind === 'virtual') return t('context.kind.virtual')
  if (node.kind === 'order') return t('context.kind.order')
  return t('context.kind.entry')
}
