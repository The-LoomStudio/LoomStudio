import { forwardRef, type InputHTMLAttributes } from 'react'

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(props, ref) {
  return <input ref={ref} data-loom-ui-text-input="" {...props} type="text" />
})
