import type { ReactNode } from 'react'

export type FieldProps = {
  id?: string
  label: ReactNode
  description?: ReactNode
  error?: ReactNode
  children: ReactNode
}

export function Field({ id, label, description, error, children }: FieldProps) {
  return (
    <div data-loom-field="">
      <label htmlFor={id}>{label}</label>
      {children}
      {description ? <div data-loom-field-description="">{description}</div> : null}
      {error ? <div data-loom-field-error="" role="alert">{error}</div> : null}
    </div>
  )
}
