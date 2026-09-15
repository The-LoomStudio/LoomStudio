import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import { Check } from 'lucide-react'
import * as React from 'react'

export const ContextMenu = ContextMenuPrimitive.Root
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger

export const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content {...props} ref={ref} className={menuClass('loom-ui-menu', className)} data-menu-kind="context" />
  </ContextMenuPrimitive.Portal>
))
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName

type ContextMenuItemProps = React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
  icon?: React.ReactNode
  inset?: boolean
  tone?: 'default' | 'danger'
}

export const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  ContextMenuItemProps
>(({ children, className, icon, inset, tone, ...props }, ref) => (
  <ContextMenuPrimitive.Item {...props} ref={ref} className={menuClass('loom-ui-menu-item', className)} data-inset={inset || undefined} data-tone={tone}>
    {icon ? <span aria-hidden="true" className="loom-ui-menu-leading">{icon}</span> : null}
    <span className="loom-ui-menu-label">{children}</span>
  </ContextMenuPrimitive.Item>
))
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName

export const ContextMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>
>(({ checked, children, className, ...props }, ref) => (
  <ContextMenuPrimitive.CheckboxItem {...props} ref={ref} checked={checked} className={menuClass('loom-ui-menu-item', className)}>
    <span aria-hidden="true" className="loom-ui-menu-leading"><ContextMenuPrimitive.ItemIndicator><Check /></ContextMenuPrimitive.ItemIndicator></span>
    <span className="loom-ui-menu-label">{children}</span>
  </ContextMenuPrimitive.CheckboxItem>
))
ContextMenuCheckboxItem.displayName = ContextMenuPrimitive.CheckboxItem.displayName

export const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator {...props} ref={ref} className={menuClass('loom-ui-menu-separator', className)} />
))
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName

function menuClass(base: string, className?: string): string {
  return className ? `${base} ${className}` : base
}
