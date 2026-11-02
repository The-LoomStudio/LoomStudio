import { isPromptMessageSequence } from '@loom-studio/shared'
import { useState, useRef, useEffect } from 'react'
import { Check, Copy, SlidersHorizontal } from 'lucide-react'
import type { ContextAssetNode } from '../../../../entities/index.js'
import type { Translator } from '../../../../shared/i18n/index.js'
import { tryWriteClipboardText } from '../../../../shared/browser/clipboard.js'
import { Toggle } from '@loom-studio/ui'
import { resolveContextAssetUri } from '../../model/context-asset-tree.js'
import { readContextAssetBadgeInfo, readContextAssetToggleLabel } from '../context-asset-tree.js'
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
  const disabledBy = props.pathNodes?.find(parent => parent.id !== props.node?.id && parent.enabled === false)
  const muted = props.node?.enabled === false || !!disabledBy

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current)
    }
  }, [])

  const uri = props.node ? resolveContextAssetUri(props.node, props.pathNodes) : ''
  const sequence = props.node ? isPromptMessageSequence(props.node) : false
  const badgeInfo = sequence ? null : readContextAssetBadgeInfo(props.node, props.t)
  const anchorId = props.node?.kind === 'virtual'
    ? (props.node.capabilities?.targetAnchorId || (props.node.label.startsWith('@') ? props.node.label : undefined))
    : undefined

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
      <div className={styles.kindRow}>
        {props.toggleEnabled && props.node ? (
          <Toggle
            checked={props.node.enabled !== false}
            label={readContextAssetToggleLabel(props.node, props.t)}
            onChange={props.onEnabledChange}
          />
        ) : null}
        <span className={styles.kindText}>{sequence ? props.t('context.kind.messageSequence') : readKindLabel(props.node, props.t)}</span>
        {badgeInfo ? (
          <button
            type="button"
            className={`${styles.statusBadge} ${styles[`statusBadge_${badgeInfo.tone}`]} ${muted ? styles.statusBadgeMuted : ''}`}
            title={props.t(props.metadataOpen ? 'context.hideMetadata' : 'context.showMetadata')}
            onClick={() => props.onMetadataOpenChange(!props.metadataOpen)}
            onMouseDown={event => event.preventDefault()}
          >
            <span className={styles.statusDot} aria-hidden="true" />
            <span>{badgeInfo.label}</span>
          </button>
        ) : null}
      </div>
      {disabledBy && <p className={styles.enablementHint} role="status">{props.t('context.disabledByAncestor', { label: disabledBy.label })}</p>}
      {props.toggleEnabled && props.node?.kind === 'folder' && <p className={styles.enablementHint}>{props.t('context.groupEnableHint')}</p>}
      <div className={styles.titleRow}>
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
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
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
        {props.node && !sequence ? (
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
      {anchorId || props.node?.meta ? (
        <span>
          {anchorId
            ? `${props.node?.meta ? `${props.node.meta} · ` : ''}${props.t(sequence ? 'context.metadata.messageSource' : 'context.metadata.anchorId')}: ${anchorId}`
            : props.node?.meta}
        </span>
      ) : null}
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
