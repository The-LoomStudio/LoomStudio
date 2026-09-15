import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { Check } from 'lucide-react'
import * as React from 'react'

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content {...props} ref={ref} className={menuClass('loom-ui-menu', className)} data-menu-kind="dropdown" sideOffset={sideOffset} />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

type DropdownMenuItemProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
  icon?: React.ReactNode
  inset?: boolean
  tone?: 'default' | 'danger'
}

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  DropdownMenuItemProps
>(({ children, className, icon, inset, tone, ...props }, ref) => (
  <DropdownMenuPrimitive.Item {...props} ref={ref} className={menuClass('loom-ui-menu-item', className)} data-inset={inset || undefined} data-tone={tone}>
    {icon ? <span aria-hidden="true" className="loom-ui-menu-leading">{icon}</span> : null}
    <span className="loom-ui-menu-label">{children}</span>
  </DropdownMenuPrimitive.Item>
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

export const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ checked, children, className, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem {...props} ref={ref} checked={checked} className={menuClass('loom-ui-menu-item', className)}>
    <span aria-hidden="true" className="loom-ui-menu-leading"><DropdownMenuPrimitive.ItemIndicator><Check /></DropdownMenuPrimitive.ItemIndicator></span>
    <span className="loom-ui-menu-label">{children}</span>
  </DropdownMenuPrimitive.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName

export const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator {...props} ref={ref} className={menuClass('loom-ui-menu-separator', className)} />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

function menuClass(base: string, className?: string): string {
  return className ? `${base} ${className}` : base
}
