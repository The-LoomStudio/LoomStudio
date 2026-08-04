import { Check } from 'lucide-react'
import styles from './toggle.module.scss'

type ToggleProps = {
  checked: boolean
  className?: string
  disabled?: boolean
  label: string
  onChange(checked: boolean): void
}

export function Toggle(props: ToggleProps) {
  const className = [styles.toggle, props.checked ? styles.checked : '', props.className ?? '']
    .filter(Boolean)
    .join(' ')

  return (
    <button
      aria-checked={props.checked}
      aria-label={props.label}
      className={className}
      data-state={props.checked ? 'checked' : 'unchecked'}
      disabled={props.disabled}
      role="switch"
      title={props.label}
      type="button"
      onClick={() => props.onChange(!props.checked)}
    >
      <Check aria-hidden="true" />
    </button>
  )
}
