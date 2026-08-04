import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { placeContextMenu, type ContextMenuPoint } from './context-menu-model.js'
import styles from './context-menu.module.scss'

export type ContextMenuItem = {
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

type OpenMenuInput = ContextMenuPoint & {
  items: ContextMenuItem[]
  returnFocus?: HTMLElement | null
}

type OpenMenuState = OpenMenuInput & {
  instanceId: number
}

type ContextMenuApi = {
  closeMenu(restoreFocus?: boolean): void
  openMenu(input: OpenMenuInput): void
}

const ContextMenuContext = createContext<ContextMenuApi | null>(null)

export function ContextMenuProvider(props: { children: ReactNode; label: string }) {
  const menuRef = useRef<HTMLDivElement>(null)
  const openMenuRef = useRef<OpenMenuState | undefined>(undefined)
  const instanceIdRef = useRef(0)
  const [menu, setMenu] = useState<OpenMenuState>()
  const [position, setPosition] = useState<ContextMenuPoint>({ x: 0, y: 0 })

  const closeMenu = useCallback((restoreFocus = true) => {
    const returnFocus = openMenuRef.current?.returnFocus
    setMenu(undefined)
    if (restoreFocus && returnFocus?.isConnected) {
      queueMicrotask(() => {
        if (returnFocus.isConnected) returnFocus.focus()
      })
    }
  }, [])

  const openMenu = useCallback((input: OpenMenuInput) => {
    if (!input.items.some(item => item.type !== 'separator')) return
    instanceIdRef.current += 1
    setPosition({ x: input.x, y: input.y })
    setMenu({ ...input, instanceId: instanceIdRef.current })
  }, [])

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return
    const bounds = menuRef.current.getBoundingClientRect()
    setPosition(placeContextMenu(
      { x: menu.x, y: menu.y },
      { width: bounds.width, height: bounds.height },
      { width: window.innerWidth, height: window.innerHeight },
    ))
    readEnabledMenuItems(menuRef.current)[0]?.focus()
  }, [menu])

  useEffect(() => {
    if (!menu) return

    function handlePointerDown(event: globalThis.PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) closeMenu(false)
    }

    function handleDismiss() {
      closeMenu(false)
    }

    window.addEventListener('blur', handleDismiss)
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('resize', handleDismiss)
    document.addEventListener('scroll', handleDismiss, true)
    return () => {
      window.removeEventListener('blur', handleDismiss)
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('resize', handleDismiss)
      document.removeEventListener('scroll', handleDismiss, true)
    }
  }, [closeMenu, menu])

  openMenuRef.current = menu
  const api = useMemo(() => ({ closeMenu, openMenu }), [closeMenu, openMenu])

  return (
    <ContextMenuContext.Provider value={api}>
      {props.children}
      {menu ? createPortal(
        <div
          aria-label={props.label}
          className={styles.menu}
          data-loom-component="context-menu"
          key={menu.instanceId}
          ref={menuRef}
          role="menu"
          style={{ left: position.x, top: position.y }}
          tabIndex={-1}
          onContextMenu={event => event.preventDefault()}
          onKeyDown={event => handleMenuKeyDown(event, menuRef.current, closeMenu)}
        >
          {menu.items.map(item => item.type === 'separator' ? (
            <div className={styles.separator} key={item.id} role="separator" />
          ) : (
            <button
              aria-checked={item.checked}
              className={`${styles.item} ${item.tone === 'danger' ? styles.danger : ''}`}
              disabled={item.disabled}
              key={item.id}
              role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              type="button"
              onClick={() => {
                closeMenu()
                item.onSelect()
              }}
            >
              <span className={styles.leading} aria-hidden="true">
                {item.checked ? <Check /> : item.icon}
              </span>
              <span className={styles.label}>{item.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      ) : null}
    </ContextMenuContext.Provider>
  )
}

export function useContextMenu(): ContextMenuApi {
  const context = useContext(ContextMenuContext)
  if (!context) throw new Error('useContextMenu must be used inside ContextMenuProvider')
  return context
}

function handleMenuKeyDown(
  event: ReactKeyboardEvent<HTMLDivElement>,
  menu: HTMLDivElement | null,
  closeMenu: (restoreFocus?: boolean) => void,
) {
  if (!menu) return
  const items = readEnabledMenuItems(menu)
  if (items.length === 0) return

  if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault()
    closeMenu()
    return
  }

  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    items[event.key === 'Home' ? 0 : items.length - 1]?.focus()
    return
  }

  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
  const direction = event.key === 'ArrowDown' ? 1 : -1
  const nextIndex = currentIndex < 0
    ? direction > 0 ? 0 : items.length - 1
    : (currentIndex + direction + items.length) % items.length
  items[nextIndex]?.focus()
}

function readEnabledMenuItems(menu: HTMLDivElement): HTMLButtonElement[] {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
}
