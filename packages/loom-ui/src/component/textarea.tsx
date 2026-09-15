import { forwardRef, type TextareaHTMLAttributes } from 'react'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea(props, ref) {
    return <textarea ref={ref} data-loom-ui-textarea="" {...props} />
  },
)
