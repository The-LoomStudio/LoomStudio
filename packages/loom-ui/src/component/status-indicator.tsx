export function StatusIndicator(props: { label: string; tone?: 'danger' | 'info' | 'success' | 'warning' }) {
  return <span aria-label={props.label} data-loom-ui-status-indicator="" data-tone={props.tone} role="img" title={props.label} />
}
