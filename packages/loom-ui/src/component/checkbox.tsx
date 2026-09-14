import type { InputHTMLAttributes } from 'react'

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

export function Checkbox(props: CheckboxProps) {
  return <input {...props} type="checkbox" />
}
