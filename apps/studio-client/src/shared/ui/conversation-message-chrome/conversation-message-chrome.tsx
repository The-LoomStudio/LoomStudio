import type { ReactNode } from 'react'
import styles from './conversation-message-chrome.module.scss'

export function ConversationMessageChrome(props: { actions: ReactNode; createdAt: string; index: number }) {
  return (
    <footer className={styles.footer} data-conversation-message-footer>
      <span className={styles.timestamp} data-conversation-message-timestamp title={formatFullTimestamp(props.createdAt)}>
        #{props.index + 1} · {formatConversationTimestamp(props.createdAt)}
      </span>
      <div className={styles.actions} data-conversation-message-actions>{props.actions}</div>
    </footer>
  )
}

export function ConversationMessageAction(props: { children: ReactNode; disabled?: boolean; label: string; onClick?: () => void }) {
  return (
    <button aria-label={props.label} className={styles.action} disabled={props.disabled} title={props.label} type="button" onClick={props.onClick}>
      {props.children}
    </button>
  )
}

export function formatConversationTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--'
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatFullTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
