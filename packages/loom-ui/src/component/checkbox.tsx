import { forwardRef, type InputHTMLAttributes } from 'react'

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(props, ref) {
  return <input ref={ref} data-loom-ui-checkbox="" {...props} type="checkbox" />
})
