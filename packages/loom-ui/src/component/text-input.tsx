import type { InputHTMLAttributes } from 'react'

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

export function TextInput(props: TextInputProps) {
  return <input {...props} type="text" />
}
