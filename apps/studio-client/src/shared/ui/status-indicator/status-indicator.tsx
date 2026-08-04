import styles from './status-indicator.module.scss'

type StatusIndicatorProps = {
  label: string
  tone: 'info'
}

export function StatusIndicator(props: StatusIndicatorProps) {
  return (
    <span
      aria-label={props.label}
      className={styles.indicator}
      data-loom-component="status-indicator"
      data-tone={props.tone}
      role="img"
      title={props.label}
    />
  )
}
