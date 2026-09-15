import { forwardRef, type ButtonHTMLAttributes } from 'react'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: 'medium' | 'small'
  variant?: 'default' | 'danger' | 'ghost' | 'secondary'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { size, type = 'button', variant, ...props },
  ref,
) {
  return <button ref={ref} data-loom-ui-button="" data-size={size} data-variant={variant} {...props} type={type} />
})
