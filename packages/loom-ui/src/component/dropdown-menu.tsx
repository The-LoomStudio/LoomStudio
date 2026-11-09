import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { DialogPortalContext } from './dialog-portal-context.js'
import { Check } from 'lucide-react'
import * as React from 'react'

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
export const DropdownMenuSub = DropdownMenuPrimitive.Sub

export const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    icon?: React.ReactNode
    inset?: boolean
  }
>(({ children, className, icon, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    {...props}
    ref={ref}
    className={menuClass('loom-ui-menu-item', className)}
    data-inset={inset || undefined}
  >
    {icon ? <span aria-hidden="true" className="loom-ui-menu-leading">{icon}</span> : null}
    <span className="loom-ui-menu-label">{children}</span>
  </DropdownMenuPrimitive.SubTrigger>
))
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName

export const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, sideOffset = 4, children, ...props }, forwardedRef) => {
  const portalContainer = React.useContext(DialogPortalContext)

  return (
    <DropdownMenuPrimitive.Portal container={portalContainer}>
      <DropdownMenuPrimitive.SubContent
        {...props}
        collisionBoundary={props.collisionBoundary ?? portalContainer}
        ref={forwardedRef}
        className={menuClass('loom-ui-menu', className)}
        data-menu-kind="dropdown-sub"
        sideOffset={sideOffset}
      >
        {children}
      </DropdownMenuPrimitive.SubContent>
    </DropdownMenuPrimitive.Portal>
  )
})
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, children, ...props }, forwardedRef) => {
  const portalContainer = React.useContext(DialogPortalContext)

  return (
    <DropdownMenuPrimitive.Portal container={portalContainer}>
      <DropdownMenuPrimitive.Content
        {...props}
        collisionBoundary={props.collisionBoundary ?? portalContainer}
        ref={forwardedRef}
        className={menuClass('loom-ui-menu', className)}
        data-menu-kind="dropdown"
        sideOffset={sideOffset}
      >
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  )
})
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
