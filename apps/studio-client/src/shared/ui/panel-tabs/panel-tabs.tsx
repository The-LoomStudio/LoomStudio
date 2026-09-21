import { type KeyboardEvent, type ReactNode, useRef } from 'react'
import styles from './panel-tabs.module.scss'

export type PanelTabItem<T extends string = string> = {
  id: T
  label: ReactNode
  ariaLabel?: string
  disabled?: boolean
  badge?: ReactNode
}

export type PanelTabsProps<T extends string = string> = {
  items: ReadonlyArray<PanelTabItem<T>>
  activeId: T
  onChange: (id: T) => void
  ariaLabel?: string
  className?: string
  size?: 'standard' | 'compact'
  align?: 'start' | 'center'
}

export function PanelTabs<T extends string = string>(props: PanelTabsProps<T>) {
  const { items, activeId, onChange, ariaLabel, className, size = 'standard', align = 'start' } = props
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([])

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
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
    buttonRefs.current[targetIndex]?.focus()
  }

  const containerClasses = [
    styles.tabList,
    size === 'compact' ? styles.compact : undefined,
    align === 'center' ? styles.alignCenter : undefined,
    className,
  ].filter(Boolean).join(' ')

  return (
    <nav aria-label={ariaLabel} className={containerClasses} role="tablist">
      {items.map((item, index) => {
        const isActive = item.id === activeId
        const buttonClass = [
          styles.tabButton,
          isActive ? styles.tabButtonActive : undefined,
        ].filter(Boolean).join(' ')

        return (
          <button
            key={item.id}
            ref={element => { buttonRefs.current[index] = element }}
            aria-label={item.ariaLabel}
            aria-selected={isActive}
            className={buttonClass}
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
            {item.badge ? <span className={styles.badge}>{item.badge}</span> : null}
          </button>
        )
      })}
    </nav>
  )
}
