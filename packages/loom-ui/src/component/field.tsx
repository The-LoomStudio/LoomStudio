import type { ReactNode } from 'react'

export type FieldProps = {
  id: string
  label: ReactNode
  description?: ReactNode
  error?: ReactNode
  children(controlProps: FieldControlProps): ReactNode
}

export function Field({ id, label, description, error, children }: FieldProps) {
  const descriptionId = description ? `${id}-description` : undefined
  const errorId = error ? `${id}-error` : undefined
  return (
    <div data-loom-field="">
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        'aria-describedby': descriptionId,
        'aria-errormessage': errorId,
        'aria-invalid': error ? true : undefined,
      })}
      {description ? <div id={descriptionId} data-loom-field-description="">{description}</div> : null}
      {error ? <div id={errorId} data-loom-field-error="" role="alert">{error}</div> : null}
    </div>
  )
}

export type FieldControlProps = {
  id: string
  'aria-describedby'?: string
  'aria-errormessage'?: string
  'aria-invalid'?: true
}
