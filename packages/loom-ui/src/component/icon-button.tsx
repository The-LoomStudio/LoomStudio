import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> & {
  'aria-label': string
  children: ReactNode
  size?: 'medium' | 'small'
  variant?: 'default' | 'danger' | 'ghost'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size, type = 'button', variant = 'ghost', title, ...props },
  ref,
) {
  return <button ref={ref} data-loom-ui-icon-button="" data-size={size} data-variant={variant} {...props} title={title ?? props['aria-label']} type={type} />
})
