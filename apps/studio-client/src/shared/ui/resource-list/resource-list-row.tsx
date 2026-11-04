import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import styles from './resource-list-row.module.scss'

export function ResourceListRow(props: {
  itemId?: string
  icon: ReactNode
  name: string
  description?: string
  metadata?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  openLabel?: string
  onOpen(): void
}) {
  return <div className={styles.row}>
    <button type="button" className={styles.open} data-resource-id={props.itemId} aria-label={props.openLabel ?? props.name} onClick={props.onOpen}>
      <span className={styles.icon} aria-hidden="true">{props.icon}</span>
      <span className={styles.body}>
        <span className={styles.title}>{props.name}{props.badge && <small>{props.badge}</small>}</span>
        {props.description && <span className={styles.description}>{props.description}</span>}
        {props.metadata && <span className={styles.metadata}>{props.metadata}</span>}
      </span>
      {!props.actions && <ChevronRight size={16} className={styles.chevron} aria-hidden="true" />}
    </button>
    {props.actions && <div className={styles.actions}>{props.actions}</div>}
  </div>
}
