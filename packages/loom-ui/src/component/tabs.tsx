import * as React from 'react'

export type TabItem<T extends string = string> = {
  id: T
  label: React.ReactNode
  ariaLabel?: string
  disabled?: boolean
  badge?: React.ReactNode
}

export type TabsProps<T extends string = string> = {
  items: ReadonlyArray<TabItem<T>>
  activeId: T
  onChange: (id: T) => void
  ariaLabel?: string
  className?: string
  size?: 'standard' | 'compact'
  align?: 'start' | 'center'
  /** 横向子页签只使用选中下划线，不加整条底部分割线（包括外层容器）。
   *  bordered 仅供确实需要结构分隔的特殊场景显式启用。 */
  bordered?: boolean
}

export type UnderlineTabsProps<T extends string = string> = TabsProps<T>

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect

export function Tabs<T extends string = string>(props: TabsProps<T>) {
  const {
    items,
    activeId,
    onChange,
    ariaLabel,
    className,
    size = 'standard',
    align = 'start',
    bordered = false,
  } = props

  const navRef = React.useRef<HTMLElement | null>(null)
  const buttonRefs = React.useRef<Map<T, HTMLButtonElement>>(new Map())
  const [isReady, setIsReady] = React.useState(false)
  const [indicator, setIndicator] = React.useState<{
    left: number
    width: number
    visible: boolean
  }>({
    left: 0,
    width: 0,
    visible: false,
  })

  useIsomorphicLayoutEffect(() => {
    const nav = navRef.current
    const button = buttonRefs.current.get(activeId)
    if (!nav || !button) {
      setIndicator(prev => (prev.visible ? { ...prev, visible: false } : prev))
      return
    }

    const left = button.offsetLeft
    const width = button.offsetWidth

    setIndicator({
      left,
      width,
      visible: true,
    })

    if (!isReady) {
      // 首次就位后开启滑动过渡
      const timer = requestAnimationFrame(() => {
        setIsReady(true)
      })
      return () => cancelAnimationFrame(timer)
    }
  }, [activeId, isReady])

  React.useEffect(() => {
    const nav = navRef.current
    if (!nav || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      const button = buttonRefs.current.get(activeId)
      if (!button) return
      setIndicator({
        left: button.offsetLeft,
        width: button.offsetWidth,
        visible: true,
      })
    })

    observer.observe(nav)
    return () => observer.disconnect()
  }, [activeId])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()

    const enabledIndices = items
      .map((item, index) => (!item.disabled ? index : -1))
      .filter(index => index !== -1)
    if (enabledIndices.length === 0) return

    let targetIndex = currentIndex
    if (event.key === 'Home') {
      targetIndex = enabledIndices[0]
    } else if (event.key === 'End') {
      targetIndex = enabledIndices[enabledIndices.length - 1]
    } else if (event.key === 'ArrowRight') {
      const currentPos = enabledIndices.indexOf(currentIndex)
      targetIndex = enabledIndices[(currentPos + 1) % enabledIndices.length]
    } else if (event.key === 'ArrowLeft') {
      const currentPos = enabledIndices.indexOf(currentIndex)
      targetIndex = enabledIndices[(currentPos - 1 + enabledIndices.length) % enabledIndices.length]
    }

    const targetItem = items[targetIndex]
    if (targetItem && targetItem.id !== activeId) {
      onChange(targetItem.id)
    }
    const targetButton = buttonRefs.current.get(targetItem.id)
    targetButton?.focus()
    targetButton?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }

  const indicatorStyle: React.CSSProperties = {
    transform: `translateX(${indicator.left}px)`,
    width: `${indicator.width}px`,
    opacity: indicator.visible ? 1 : 0,
    transition: isReady
      ? 'transform 240ms cubic-bezier(0.2, 0, 0, 1), width 240ms cubic-bezier(0.2, 0, 0, 1), opacity 140ms ease'
      : 'opacity 140ms ease',
  }

  const containerClasses = [
    size === 'compact' ? 'compact' : undefined,
    align === 'center' ? 'alignCenter' : undefined,
    className,
  ].filter(Boolean).join(' ') || undefined

  return (
    <nav
      ref={navRef}
      aria-label={ariaLabel}
      className={containerClasses}
      data-align={align}
      data-bordered={bordered ? 'true' : undefined}
      data-loom-ui-tabs=""
      data-size={size}
      role="tablist"
    >
      {items.map((item, index) => {
        const isActive = item.id === activeId

        return (
          <button
            key={item.id}
            ref={element => {
              if (element) {
                buttonRefs.current.set(item.id, element)
              } else {
                buttonRefs.current.delete(item.id)
              }
            }}
            aria-label={item.ariaLabel}
            aria-selected={isActive}
            data-active={isActive ? 'true' : undefined}
            data-loom-ui-tabs-button=""
            disabled={item.disabled}
            role="tab"
            tabIndex={isActive ? 0 : -1}
            type="button"
            onClick={() => {
              if (!item.disabled && item.id !== activeId) {
                onChange(item.id)
              }
            }}
            onKeyDown={event => handleKeyDown(event, index)}
          >
            <span>{item.label}</span>
            {item.badge ? <span data-loom-ui-tabs-badge="">{item.badge}</span> : null}
          </button>
        )
      })}
      <div
        aria-hidden="true"
        data-loom-ui-tabs-indicator=""
        style={indicatorStyle}
      />
    </nav>
  )
}

export const UnderlineTabs = Tabs
