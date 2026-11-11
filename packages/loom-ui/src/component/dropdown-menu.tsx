import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { DialogPortalContext } from './dialog-portal-context.js'
import { Check } from 'lucide-react'
import * as React from 'react'

let lastWindowBlurTime = 0
let lastTabSwitchTime = 0

if (typeof window !== 'undefined') {
  window.addEventListener('blur', () => {
    lastWindowBlurTime = Date.now()
  }, true)
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      lastTabSwitchTime = Date.now()
    } else {
      lastWindowBlurTime = Date.now()
    }
  })
}

export const DropdownMenu: React.FC<React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root>> = ({
  open,
  onOpenChange,
  ...props
}) => {
  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      // 拦截由浏览器切标签页、窗口失焦触发的意外关闭
      const isDueToWindowBlur =
        Date.now() - lastWindowBlurTime < 150 ||
        (typeof document !== 'undefined' && document.visibilityState === 'hidden')
      if (isDueToWindowBlur) {
        return
      }
    }
    onOpenChange?.(nextOpen)
  }, [onOpenChange])

  return <DropdownMenuPrimitive.Root {...props} open={open} onOpenChange={handleOpenChange} />
}
DropdownMenu.displayName = DropdownMenuPrimitive.Root.displayName
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
>(({ className, sideOffset = 4, children, onFocusOutside, onPointerDownOutside, onInteractOutside, ...props }, forwardedRef) => {
  const portalContainer = React.useContext(DialogPortalContext)

  const isBrowserChromeInteraction = (event: { detail: { originalEvent: unknown } }) => {
    // 1. 如果页面处于非活动标签页或后台
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return true
    }

    // 2. 如果标签页刚切回前台 350ms 内，忽略伴随切换产生的任何外部指针事件
    if (Date.now() - lastTabSwitchTime < 350) {
      return true
    }

    const original = event.detail.originalEvent
    // 3. 如果点击发生在浏览器视口之外（如顶部标签栏、地址栏、书签栏）
    if (original && typeof original === 'object' && 'clientY' in original && typeof window !== 'undefined') {
      const { clientX, clientY } = original as { clientX: number; clientY: number }
      if (clientY <= 0 || clientY >= window.innerHeight || clientX <= 0 || clientX >= window.innerWidth) {
        return true
      }
    }

    return false
  }

  return (
    <DropdownMenuPrimitive.Portal container={portalContainer}>
      <DropdownMenuPrimitive.Content
        {...props}
        collisionBoundary={props.collisionBoundary ?? portalContainer}
        ref={forwardedRef}
        className={menuClass('loom-ui-menu', className)}
        data-menu-kind="dropdown"
        sideOffset={sideOffset}
        onFocusOutside={event => {
          // 阻止因浏览器切标签页、窗口失焦或系统桌面切换导致的误关闭
          event.preventDefault()
          onFocusOutside?.(event)
        }}
        onPointerDownOutside={event => {
          if (isBrowserChromeInteraction(event)) {
            event.preventDefault()
            return
          }
          onPointerDownOutside?.(event)
        }}
        onInteractOutside={event => {
          if (isBrowserChromeInteraction(event)) {
            event.preventDefault()
            return
          }
          onInteractOutside?.(event)
        }}
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
