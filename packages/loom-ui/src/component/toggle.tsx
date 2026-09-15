import { Check } from 'lucide-react'

export type ToggleProps = {
  checked: boolean
  className?: string
  disabled?: boolean
  label: string
  onChange(checked: boolean): void
}

export function Toggle(props: ToggleProps) {
  return (
    <button aria-checked={props.checked} aria-label={props.label} className={props.className} data-loom-ui-toggle="" data-state={props.checked ? 'checked' : 'unchecked'} disabled={props.disabled} role="switch" title={props.label} type="button" onClick={() => props.onChange(!props.checked)}>
      <Check aria-hidden="true" />
    </button>
  )
}
