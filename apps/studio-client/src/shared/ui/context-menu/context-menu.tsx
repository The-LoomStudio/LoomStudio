import * as React from 'react'
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import { Check, ChevronRight } from 'lucide-react'
import styles from './context-menu.module.scss'

const LONG_PRESS_DELAY = 520
const CLICK_SUPPRESSION_TIME = 800

const ContextMenu = ContextMenuPrimitive.Root

const ContextMenuTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Trigger>
>(({ children, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture, ...props }, ref) => {
  const triggerRef = React.useRef<HTMLElement | null>(null)
  const longPressTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const suppressionTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const suppressClickRef = React.useRef(false)
  const startPosRef = React.useRef<{ x: number; y: number } | null>(null)

  const clearLongPress = () => {
    clearTimeout(longPressTimerRef.current)
  }

  React.useEffect(() => {
    return () => {
      clearLongPress()
      clearTimeout(suppressionTimerRef.current)
    }
  }, [])

  const handlePointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    onPointerDown?.(e)
    if (e.pointerType === 'mouse' || e.button !== 0) return
    clearLongPress()
    startPosRef.current = { x: e.clientX, y: e.clientY }
    const target = triggerRef.current
    if (!target) return
    
    longPressTimerRef.current = setTimeout(() => {
      suppressClickRef.current = true
      clearTimeout(suppressionTimerRef.current)
      suppressionTimerRef.current = setTimeout(() => {
        suppressClickRef.current = false
      }, CLICK_SUPPRESSION_TIME)
      
      target.dispatchEvent(new MouseEvent('contextmenu', { 
        bubbles: true, 
        clientX: startPosRef.current?.x ?? 0, 
        clientY: startPosRef.current?.y ?? 0 
      }))
    }, LONG_PRESS_DELAY)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    onPointerMove?.(e)
    if (!startPosRef.current) return
    const dx = e.clientX - startPosRef.current.x
    const dy = e.clientY - startPosRef.current.y
    if (dx * dx + dy * dy > 100) clearLongPress()
  }

  const handlePointerEnd = (e: React.PointerEvent<HTMLSpanElement>) => {
    onPointerUp?.(e)
    clearLongPress()
  }

  const handlePointerCancel = (e: React.PointerEvent<HTMLSpanElement>) => {
    onPointerCancel?.(e)
    clearLongPress()
  }

  return (
    <ContextMenuPrimitive.Trigger
      ref={(node) => {
        triggerRef.current = node as HTMLElement | null
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerCancel}
      onClickCapture={(e) => {
        onClickCapture?.(e)
        if (suppressClickRef.current) {
          e.preventDefault()
          e.stopPropagation()
          suppressClickRef.current = false
        }
      }}
      {...props}
    >
      {children}
    </ContextMenuPrimitive.Trigger>
  )
})
ContextMenuTrigger.displayName = ContextMenuPrimitive.Trigger.displayName

const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={`${styles.menu} ${className ?? ''}`}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
))
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName

const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
    inset?: boolean
    tone?: 'default' | 'danger'
    icon?: React.ReactNode
  }
>(({ className, inset, tone, icon, children, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={`${styles.item} ${tone === 'danger' ? styles.danger : ''} ${inset ? styles.inset : ''} ${className ?? ''}`}
    {...props}
  >
    {icon && (
      <span className={styles.leading} aria-hidden="true">
        {icon}
      </span>
    )}
    <span className={styles.label}>{children}</span>
  </ContextMenuPrimitive.Item>
))
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName

const ContextMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <ContextMenuPrimitive.CheckboxItem
    ref={ref}
    className={`${styles.item} ${className ?? ''}`}
    checked={checked}
    {...props}
  >
    <span className={styles.leading} aria-hidden="true">
      <ContextMenuPrimitive.ItemIndicator>
        <Check />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    <span className={styles.label}>{children}</span>
  </ContextMenuPrimitive.CheckboxItem>
))
ContextMenuCheckboxItem.displayName = ContextMenuPrimitive.CheckboxItem.displayName

const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={`${styles.separator} ${className ?? ''}`}
    {...props}
  />
))
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName

const ContextMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={`${styles.shortcut} ${className ?? ''}`}
      {...props}
    />
  )
}
ContextMenuShortcut.displayName = "ContextMenuShortcut"

const ContextMenuSub = ContextMenuPrimitive.Sub

const ContextMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> & {
    inset?: boolean
    icon?: React.ReactNode
  }
>(({ className, inset, icon, children, ...props }, ref) => (
  <ContextMenuPrimitive.SubTrigger
    ref={ref}
    className={`${styles.item} ${styles.subTrigger} ${inset ? styles.inset : ''} ${className ?? ''}`}
    {...props}
  >
    {icon && (
      <span className={styles.leading} aria-hidden="true">
        {icon}
      </span>
    )}
    <span className={styles.label}>{children}</span>
    <span className={styles.trailing} aria-hidden="true">
      <ChevronRight />
    </span>
  </ContextMenuPrimitive.SubTrigger>
))
ContextMenuSubTrigger.displayName = ContextMenuPrimitive.SubTrigger.displayName

const ContextMenuSubContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.SubContent
      ref={ref}
      className={`${styles.menu} ${className ?? ''}`}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
))
ContextMenuSubContent.displayName = ContextMenuPrimitive.SubContent.displayName

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
}
