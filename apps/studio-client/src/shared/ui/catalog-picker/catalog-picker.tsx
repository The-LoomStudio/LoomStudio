import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Layers,
  Star,
  X,
} from 'lucide-react'
import { SearchField } from '@loom-studio/ui'
import styles from './catalog-picker.module.scss'

export interface CatalogCategory {
  id: string
  label: string
  icon?: ReactNode
  badge?: number | string
  /** 分组扩展信息，例如右侧操作按钮 */
  action?: {
    label: string
    onClick: () => void
    disabled?: boolean
  }
}

/** 提取无图标来源的紧凑文字标签（如 youzi (柚子中转) -> youzi, Fake AI -> Fake, 硅基流动 -> 硅基） */
export function getCategoryShortLabel(label: string): string {
  const trimmed = label.trim()
  if (!trimmed) return '??'
  // 去除括号备注，如 "youzi (柚子中转)" -> "youzi"
  const clean = trimmed.replace(/\([^)]*\)|（[^）]*）/g, '').trim() || trimmed
  // 中文开头取前 2~3 个汉字
  if (/^[\u4e00-\u9fa5]/.test(clean)) {
    return clean.slice(0, 3)
  }
  // 英文开头取首词（最多 6 字符，完整容纳 youzi 等）
  const firstWord = clean.split(/\s+/)[0] ?? clean
  return firstWord.length > 6 ? firstWord.slice(0, 6) : firstWord
}

export interface CatalogItem<T = unknown> {
  id: string
  /** 对应的来源分类 ID（如提供商 ID 或扩展 ID） */
  categoryId?: string
  title: string
  subtitle?: string
  icon?: ReactNode
  shortcut?: string
  pinned?: boolean
  disabled?: boolean
  selected?: boolean
  tags?: string[]
  data: T
}

export interface CatalogPickerProps<T = unknown> {
  title?: ReactNode
  categories?: CatalogCategory[]
  activeCategoryId?: string
  onCategoryChange?: (id: string) => void

  items: CatalogItem<T>[]
  activeItemId?: string
  onActiveItemChange?: (id: string) => void

  searchPlaceholder?: string
  emptyMessage?: string
  onSelect: (item: CatalogItem<T>) => void
  onClose?: () => void

  /** 右侧详情与操作面板渲染函数 */
  renderDetail?: (item: CatalogItem<T>) => ReactNode

  /** 是否强制移动端视图（用于 Dev Preview 调试或小屏幕自适应） */
  mobileMode?: boolean
  className?: string
}

export function CatalogPicker<T = unknown>(props: CatalogPickerProps<T>) {
  const [query, setQuery] = useState('')
  const [internalCategory, setInternalCategory] = useState<string>(() => {
    return props.activeCategoryId ?? 'all'
  })
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => {
    return new Set(props.items.filter(item => item.pinned).map(item => item.id))
  })

  // 移动端下钻状态：'master'（列表）与 'detail'（详情及次级配置）
  const [mobileStage, setMobileStage] = useState<'master' | 'detail'>('master')

  const activeCategory = props.activeCategoryId ?? internalCategory
  const setCategory = props.onCategoryChange ?? setInternalCategory

  // 搜索与过滤后的平铺列表（用于键盘上下键导航和聚焦）
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    return props.items.filter(item => {
      // 分类过滤
      if (activeCategory === 'favorites') {
        if (!pinnedIds.has(item.id)) return false
      } else if (activeCategory !== 'all' && props.categories && props.categories.length > 0) {
        if (item.categoryId && item.categoryId !== activeCategory) return false
      }

      // 文本搜索
      if (!q) return true
      const matchTitle = item.title.toLowerCase().includes(q)
      const matchSubtitle = item.subtitle?.toLowerCase().includes(q)
      const matchId = item.id.toLowerCase().includes(q)
      const matchTags = item.tags?.some(tag => tag.toLowerCase().includes(q))
      return Boolean(matchTitle || matchSubtitle || matchId || matchTags)
    }).sort((a, b) => {
      // 星标置顶（在单一分类或未搜索时置顶）
      const aPin = pinnedIds.has(a.id)
      const bPin = pinnedIds.has(b.id)
      if (activeCategory === 'favorites' || query) return 0
      if (aPin !== bPin) return aPin ? -1 : 1
      return 0
    })
  }, [props.items, query, activeCategory, pinnedIds, props.categories])

  // 按来源分组聚合（当选择“全部”或处于搜索时，按来源/分类分块并用分割线划分归属）
  const groupedSections = useMemo(() => {
    if (!props.categories || props.categories.length === 0) {
      return [{ category: undefined, items: filteredItems }]
    }

    // 单一具体来源模式：不展示分组 Header，纯平铺
    if (activeCategory !== 'all' && activeCategory !== 'favorites' && !query) {
      const currentCat = props.categories.find(c => c.id === activeCategory)
      return [{ category: currentCat, items: filteredItems }]
    }

    // 全部模式或全局搜索模式：按来源分组聚合
    const sections: { category?: CatalogCategory; items: CatalogItem<T>[] }[] = []

    // 按来源/Provider 依次分组
    const usedCategories = new Set<string>()
    for (const cat of props.categories) {
      if (cat.id === 'all' || cat.id === 'favorites') continue
      const catItems = filteredItems.filter(item => item.categoryId === cat.id)
      if (catItems.length > 0) {
        sections.push({ category: cat, items: catItems })
        usedCategories.add(cat.id)
      }
    }

    // 3. 未归类或未知来源项
    const uncategorized = filteredItems.filter(
      item => !item.categoryId || !usedCategories.has(item.categoryId),
    )
    if (uncategorized.length > 0 && activeCategory !== 'favorites') {
      // 避免与置顶星标重复
      const remaining = activeCategory === 'all' && !query
        ? uncategorized.filter(item => !pinnedIds.has(item.id))
        : uncategorized
      if (remaining.length > 0) {
        sections.push({ category: undefined, items: remaining })
      }
    }

    return sections
  }, [filteredItems, props.categories, activeCategory, query, pinnedIds])

  // 当前聚焦项（驱动右侧 Detail 面板）
  const [internalFocusedId, setInternalFocusedId] = useState<string>(() => {
    return props.activeItemId ?? filteredItems[0]?.id ?? ''
  })
  const focusedItemId = props.activeItemId ?? internalFocusedId
  const setFocusedItemId = props.onActiveItemChange ?? setInternalFocusedId

  useEffect(() => {
    if (filteredItems.length > 0 && !filteredItems.some(item => item.id === focusedItemId)) {
      setFocusedItemId(filteredItems[0].id)
    }
  }, [filteredItems, focusedItemId, setFocusedItemId])

  const focusedItem = useMemo(() => {
    return props.items.find(item => item.id === focusedItemId) ?? filteredItems[0]
  }, [props.items, focusedItemId, filteredItems])

  const togglePin = useCallback((id: string, event: React.MouseEvent) => {
    event.stopPropagation()
    setPinnedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // 键盘导航
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const index = filteredItems.findIndex(i => i.id === focusedItemId)
      if (index >= 0 && index < filteredItems.length - 1) {
        setFocusedItemId(filteredItems[index + 1].id)
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      const index = filteredItems.findIndex(i => i.id === focusedItemId)
      if (index > 0) {
        setFocusedItemId(filteredItems[index - 1].id)
      }
    } else if (event.key === 'Enter') {
      if (focusedItem && !focusedItem.disabled) {
        event.preventDefault()
        if (props.mobileMode && mobileStage === 'master' && props.renderDetail) {
          setMobileStage('detail')
        } else {
          props.onSelect(focusedItem)
        }
      }
    } else if (event.key === 'Escape') {
      if (props.mobileMode && mobileStage === 'detail') {
        event.preventDefault()
        setMobileStage('master')
      } else if (props.onClose) {
        event.preventDefault()
        props.onClose()
      }
    }
  }, [filteredItems, focusedItemId, focusedItem, setFocusedItemId, props, mobileStage])

  const handleItemClick = (item: CatalogItem<T>) => {
    setFocusedItemId(item.id)
    if (props.mobileMode && props.renderDetail) {
      setMobileStage('detail')
    } else {
      props.onSelect(item)
    }
  }

  const isMobile = Boolean(props.mobileMode)

  return (
    <div
      className={`${styles.container} ${isMobile ? styles.mobileContainer : ''} ${props.className ?? ''}`}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      data-loom-component="catalog-picker"
      data-mobile-stage={isMobile ? mobileStage : undefined}
    >
      {/* 顶部标准 Dialog Header */}
      {props.title && (
        <header className={styles.dialogHeader}>
          <h2 className={styles.dialogTitle}>{props.title}</h2>
          {props.onClose && (
            <button
              type="button"
              className={styles.dialogCloseButton}
              onClick={props.onClose}
              aria-label="关闭"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </header>
      )}
      {/* 移动端详情顶部返回条 */}
      {isMobile && mobileStage === 'detail' && (
        <header className={styles.mobileDetailHeader}>
          <button
            type="button"
            className={styles.mobileBackButton}
            onClick={() => setMobileStage('master')}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span>返回列表</span>
          </button>
          <span className={styles.mobileDetailTitle}>{focusedItem?.title}</span>
          {props.onClose && (
            <button
              type="button"
              className={styles.mobileCloseButton}
              onClick={props.onClose}
              aria-label="关闭"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </header>
      )}

      <div className={styles.body}>
        {/* 1. Category / Provider Sidebar (左侧分类导航) */}
        {(!isMobile || mobileStage === 'master') && props.categories && props.categories.length > 0 && (
          <aside className={styles.rail} aria-label="来源与分类导航">
            {/* 顶部的“全部”按钮 */}
            <button
              type="button"
              className={styles.railButton}
              data-active={activeCategory === 'all' || undefined}
              title="全部来源"
              aria-label="全部来源"
              onClick={() => setCategory('all')}
            >
              <span className={styles.railIcon}><Layers size={14} /></span>
              <span className={styles.railText}>全部</span>
            </button>

            {/* 顶部的“常用星标”按钮 */}
            <button
              type="button"
              className={styles.railButton}
              data-active={activeCategory === 'favorites' || undefined}
              title="常用星标"
              aria-label="常用星标"
              onClick={() => setCategory('favorites')}
            >
              <span className={styles.railIcon}><Star size={14} /></span>
              <span className={styles.railText}>星标</span>
            </button>

            <div className={styles.railDivider} />

            {/* 各来源 / 扩展 / Provider 图标与文字 */}
            {props.categories.map(cat => {
              if (cat.id === 'all' || cat.id === 'favorites') return null
              const isActive = activeCategory === cat.id
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={styles.railButton}
                  data-active={isActive || undefined}
                  title={cat.label}
                  aria-label={cat.label}
                  onClick={() => setCategory(cat.id)}
                >
                  {cat.icon ? <span className={styles.railIcon}>{cat.icon}</span> : null}
                  <span className={styles.railText}>{cat.label}</span>
                </button>
              )
            })}
          </aside>
        )}

        {/* 2. Master Column (主选择列表) */}
        {(!isMobile || mobileStage === 'master') && (
          <section className={styles.master}>
            <div className={styles.searchHeader}>
              <SearchField
                autoFocus
                value={query}
                placeholder={props.searchPlaceholder ?? '搜索名称、ID 或标签…'}
                aria-label="搜索"
                clearLabel="清除"
                onChange={event => setQuery(event.target.value)}
                onClear={() => setQuery('')}
              />
            </div>

            <div className={styles.itemList} role="listbox">
              {filteredItems.length === 0 ? (
                <div className={styles.emptyState}>
                  {props.emptyMessage ?? '未找到匹配的项'}
                </div>
              ) : (
                groupedSections.map((section, sectionIdx) => {
                  const showHeader = Boolean(section.category && (activeCategory === 'all' || query || activeCategory === 'favorites'))
                  return (
                    <div key={section.category?.id ?? `group-${sectionIdx}`} className={styles.sectionGroup}>
                      {showHeader && (
                        <div className={styles.groupHeader}>
                          <div className={styles.groupHeaderLeft}>
                            {section.category?.icon && (
                              <span className={styles.groupIcon}>{section.category.icon}</span>
                            )}
                            <span className={styles.groupTitle}>{section.category?.label}</span>
                          </div>
                          <div className={styles.groupHeaderRight}>
                            {section.category?.action && (
                              <button
                                type="button"
                                className={styles.groupActionButton}
                                disabled={section.category.action.disabled}
                                onClick={section.category.action.onClick}
                              >
                                {section.category.action.label}
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      <div className={styles.groupItems}>
                        {section.items.map(item => {
                          const isFocused = focusedItemId === item.id
                          const isPinned = pinnedIds.has(item.id)
                          return (
                            <div
                              key={item.id}
                              role="option"
                              tabIndex={0}
                              aria-selected={isFocused}
                              data-focused={isFocused || undefined}
                              data-selected={item.selected || undefined}
                              aria-disabled={item.disabled}
                              className={styles.item}
                              onMouseEnter={() => !isMobile && setFocusedItemId(item.id)}
                              onClick={() => handleItemClick(item)}
                            >
                              {item.icon && <span className={styles.itemIcon}>{item.icon}</span>}
                              <div className={styles.itemInfo}>
                                <div className={styles.itemTitle}>{item.title}</div>
                                {item.subtitle && <div className={styles.itemSubtitle}>{item.subtitle}</div>}
                              </div>
                              <div className={styles.itemMeta}>
                                {item.shortcut && !isMobile && (
                                  <span className={styles.shortcut}>{item.shortcut}</span>
                                )}
                                <button
                                  type="button"
                                  className={styles.pinButton}
                                  data-pinned={isPinned || undefined}
                                  title={isPinned ? '取消收藏' : '设为常用'}
                                  aria-label={isPinned ? '取消收藏' : '设为常用'}
                                  onClick={e => togglePin(item.id, e)}
                                >
                                  <Star size={13} fill={isPinned ? 'currentColor' : 'none'} />
                                </button>
                                {item.selected && (
                                  <span className={styles.selectedBadge} title="当前已选">
                                    <Check size={16} aria-hidden="true" />
                                  </span>
                                )}
                                {isMobile && props.renderDetail && (
                                  <ChevronRight size={16} className={styles.mobileChevron} />
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </section>
        )}

        {/* 3. Detail Column (详情面板与操作) */}
        {(!isMobile || mobileStage === 'detail') && props.renderDetail && (
          <aside className={styles.detail} aria-label="详细信息与配置">
            {focusedItem ? (
              props.renderDetail(focusedItem)
            ) : (
              <div className={styles.detailEmpty}>请选择一项查看详情</div>
            )}

            {isMobile && mobileStage === 'detail' && focusedItem && (
              <div className={styles.mobileConfirmBar}>
                <button
                  type="button"
                  className={styles.mobileConfirmButton}
                  onClick={() => props.onSelect(focusedItem)}
                >
                  确认选用 {focusedItem.title}
                </button>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
