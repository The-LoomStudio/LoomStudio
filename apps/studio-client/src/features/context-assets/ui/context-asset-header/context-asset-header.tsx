import type { LucideIcon } from 'lucide-react'
import type { PromptResource } from '../../../../entities/index.js'
import type { Translator } from '../../../../shared/i18n/index.js'
import styles from './context-asset-header.module.scss'

type ContextAssetHeaderProps = {
  Icon: LucideIcon
  title: string
  resources: PromptResource[]
  selectedResourceId?: string
  t: Translator
  onSelectResource(resourceId: string): void
}

export function ContextAssetHeader(props: ContextAssetHeaderProps) {
  const Icon = props.Icon
  const selectedResource = props.resources.find(r => r.id === props.selectedResourceId) ?? props.resources[0]

  return (
    <div className={styles.headerWrapper} data-loom-component="context-asset-header">
      <div className={styles.headerTitle}>
        <Icon aria-hidden="true" />
        <span>{props.title}</span>
      </div>
      {props.resources.length > 0 ? (
        <>
          <span style={{ color: 'var(--loom-color-text-subtle)', opacity: 0.6 }}>·</span>
          <select
            aria-label={props.t('promptResource.select')}
            className={styles.resourceSelect}
            value={selectedResource?.id ?? ''}
            onChange={event => props.onSelectResource(event.target.value)}
          >
            {props.resources.map(resource => (
              <option key={resource.id} value={resource.id}>
                {resource.rootNode?.label ?? 'Resource'}{resource.origin?.kind === 'builtin' ? ` · ${props.t('promptResource.official')}` : ''}
              </option>
            ))}
          </select>
        </>
      ) : null}
    </div>
  )
}
