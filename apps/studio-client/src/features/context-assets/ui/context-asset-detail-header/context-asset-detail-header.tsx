import { useState, useRef, useEffect } from 'react'
import { Check, Copy, SlidersHorizontal } from 'lucide-react'
import type { ContextAssetNode } from '../../../../entities/index.js'
import type { Translator } from '../../../../shared/i18n/index.js'
import { tryWriteClipboardText } from '../../../../shared/browser/clipboard.js'
import { Toggle } from '../../../../shared/ui/toggle/toggle.js'
import { resolveContextAssetUri, resolveVirtualDisplayName } from '../../model/context-asset-tree.js'
import styles from './context-asset-detail-header.module.scss'

type ContextAssetDetailHeaderProps = {
  metadataOpen: boolean
  node?: ContextAssetNode
  pathNodes?: ContextAssetNode[]
  readOnly?: boolean
  toggleEnabled: boolean
  t: Translator
  onChangeLabel?(label: string): void
  onCommitLabel?(label: string): void
  onEnabledChange(enabled: boolean): void
  onMetadataOpenChange(open: boolean): void
}

export function ContextAssetDetailHeader(props: ContextAssetDetailHeaderProps) {
  const [copied, setCopied] = useState(false)
  const copyTimeoutRef = useRef<number | null>(null)
  const muted = props.node?.kind === 'entry' && props.node.enabled === false

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current)
    }
  }, [])

  const uri = props.node ? resolveContextAssetUri(props.node, props.pathNodes) : ''

  const handleCopyUri = async () => {
    if (!uri) return
    const success = await tryWriteClipboardText(uri)
    if (success) {
      setCopied(true)
      if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current)
      copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 1600)
    }
  }

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
        {props.node ? (
          <div className={styles.titleWrapper}>
            <input
              aria-label={props.t('context.metadata.label')}
              className={styles.titleInput}
              disabled={props.readOnly}
              value={props.node.label}
              onChange={event => props.onChangeLabel?.(event.target.value)}
              onBlur={event => props.onCommitLabel?.(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur()
                }
              }}
            />
            {uri ? (
              <button
                aria-label={`复制条目 URI: ${uri}`}
                className={`${styles.uriCopyBadge} ${copied ? styles.uriCopyBadgeSuccess : ''}`}
                title={copied ? '已复制 URI' : `复制条目 URI (${uri})`}
                type="button"
                onClick={handleCopyUri}
              >
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              </button>
            ) : null}
          </div>
        ) : (
          <h1>{props.t('context.emptyTitle')}</h1>
        )}
        {props.node ? (
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
  return t('context.kind.entry')
}
