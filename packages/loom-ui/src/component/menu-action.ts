import type { ReactNode } from 'react'

export type MenuAction = {
  checked?: boolean
  disabled?: boolean
  icon?: ReactNode
  id: string
  label: string
  onSelect(): void
  tone?: 'default' | 'danger'
  type?: 'item'
} | {
  id: string
  type: 'separator'
}
