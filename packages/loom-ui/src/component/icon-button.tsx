import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> & {
  'aria-label': string
  children: ReactNode
}

export function IconButton({ type, ...props }: IconButtonProps) {
  return <button {...props} type={type ?? 'button'} />
}
