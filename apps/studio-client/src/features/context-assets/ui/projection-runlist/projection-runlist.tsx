import { ChevronDown, ChevronRight, Diamond, GripVertical } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Translator } from '../../../../shared/i18n/index.js'
import { buildProjectionZones, type ProjectionOrderEntry, type ProjectionOrderRow, type ProjectionZoneDefinition } from '../../model/projection-order.js'
import { readSlotEntrySummary } from '../../model/projection-slot.js'
import styles from './projection-runlist.module.scss'

type DragTarget = { id: string; type: 'row' | 'zone' }

type ProjectionRunlistProps = {
  entries: ProjectionOrderEntry[]
  onReorder?: (draggedId: string, targetId: string) => void
  onReorderZone?: (draggedZoneId: string, targetZoneId: string) => void
  onSelect?: (id: string) => void
  selectedId?: string
  selectedZoneId?: string
  showSummary?: boolean
  t: Translator
  zoneDefinitions?: ProjectionZoneDefinition[]
  onSelectZone?: (zoneId: string) => void
}

export function ProjectionRunlist(props: ProjectionRunlistProps) {
  const zones = useMemo(() => buildProjectionZones(props.entries, props.zoneDefinitions), [props.entries, props.zoneDefinitions])
  const [collapsedIds, setCollapsedIds] = useState(() => new Set<string>())
  const [dragging, setDragging] = useState<DragTarget>()

  function toggle(id: string) {
    setCollapsedIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function drop(target: DragTarget) {
    if (!dragging || dragging.type !== target.type || dragging.id === target.id) return
    if (target.type === 'zone') props.onReorderZone?.(dragging.id, target.id)
    else props.onReorder?.(dragging.id, target.id)
  }

  return (
    <div className={styles.runlist} data-loom-component="projection-runlist">
      {props.showSummary ? (
        <div className={styles.summary}>
          <span>{props.t('context.orderProfileLabel')}</span>
          <strong>{props.t('context.orderCount', { count: props.entries.length })}</strong>
        </div>
      ) : null}

      <div className={styles.zones} role="list">
        {zones.map(zone => {
          const collapsed = collapsedIds.has(zone.id)
          return (
            <section
              className={`${styles.zone} ${props.selectedZoneId === zone.id ? styles.selectedZone : ''}`}
              draggable={Boolean(props.onReorderZone)}
              key={zone.id}
              role="listitem"
              onDragEnd={() => setDragging(undefined)}
              onDragOver={event => event.preventDefault()}
              onDragStart={() => setDragging({ id: zone.id, type: 'zone' })}
              onDrop={() => drop({ id: zone.id, type: 'zone' })}
            >
              <div className={styles.zoneHeader}>
                {props.onReorderZone ? <GripVertical className={styles.dragHandle} aria-hidden="true" /> : null}
                <span className={styles.positionSpacer} aria-hidden="true" />
                <span className={collapsed ? styles.zoneCollapsed : styles.zoneStart} aria-hidden="true" />
                <button
                  aria-expanded={!collapsed}
                  aria-label={props.t(collapsed ? 'context.tree.expand' : 'context.tree.collapse', { label: zone.id })}
                  className={styles.disclosure}
                  type="button"
                  onClick={() => toggle(zone.id)}
                >
                  {collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                </button>
                <Diamond className={styles.zoneIcon} aria-hidden="true" />
                {props.onSelectZone ? (
                  <button className={styles.zoneLabel} type="button" onClick={() => props.onSelectZone?.(zone.id)}>
                    <strong>{zone.displayName}</strong>
                    <small>{zone.id}</small>
                  </button>
                ) : <strong>{zone.displayName}</strong>}
                <span className={styles.zoneCount}>{zone.rows.length}</span>
                <span className={styles.zoneDivider} aria-hidden="true" />
              </div>

              {!collapsed ? (
                <div className={styles.zoneRows}>
                  {zone.rows.map((row, index) => (
                    <ProjectionRow
                      collapsedIds={collapsedIds}
                      isLast={index === zone.rows.length - 1}
                      key={row.id}
                      row={row}
                      selectedId={props.selectedId}
                      t={props.t}
                      toggle={toggle}
                      onDragEnd={() => setDragging(undefined)}
                      onDragStart={id => setDragging({ id, type: 'row' })}
                      onDrop={id => drop({ id, type: 'row' })}
                      onSelect={props.onSelect}
                      reorderable={Boolean(props.onReorder)}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function ProjectionRow(props: {
  collapsedIds: Set<string>
  isLast: boolean
  onDragEnd(): void
  onDragStart(id: string): void
  onDrop(id: string): void
  onSelect?: (id: string) => void
  reorderable: boolean
  row: ProjectionOrderRow
  selectedId?: string
  t: Translator
  toggle(id: string): void
}) {
  const slotCollapsed = props.collapsedIds.has(props.row.id)
  const selected = props.row.entries.some(entry => entry.node.id === props.selectedId)
  const primary = props.row.primary

  return (
    <div className={styles.rowGroup}>
      <div
        className={`${styles.row} ${selected ? styles.selected : ''}`}
        draggable={props.reorderable}
        onDragEnd={event => {
          event.stopPropagation()
          props.onDragEnd()
        }}
        onDragOver={event => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onDragStart={event => {
          event.stopPropagation()
          props.onDragStart(primary.node.id)
        }}
        onDrop={event => {
          event.stopPropagation()
          props.onDrop(primary.node.id)
        }}
      >
        {props.reorderable ? <GripVertical className={styles.dragHandle} aria-hidden="true" /> : null}
        {props.row.type === 'slot'
          ? <span className={styles.positionSpacer} aria-hidden="true" />
          : <span className={styles.position}>{String(primary.position).padStart(2, '0')}</span>}
        <span className={props.isLast ? styles.guideEnd : styles.guideBranch} aria-hidden="true" />
        {props.row.type === 'slot' ? (
          <button
            aria-expanded={!slotCollapsed}
            aria-label={props.t(slotCollapsed ? 'context.tree.expand' : 'context.tree.collapse', { label: props.row.label })}
            className={`${styles.disclosure} ${styles.slotDisclosure}`}
            type="button"
            onClick={() => props.toggle(props.row.id)}
          >
            {slotCollapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          </button>
        ) : null}
        {props.onSelect ? (
          <button className={styles.rowLabel} type="button" onClick={() => props.onSelect?.(primary.node.id)}>
            <strong>{props.row.label}</strong>
            <small>{props.row.type === 'slot' ? readSlotEntrySummary(props.row.entries) : primary.node.meta}</small>
          </button>
        ) : (
          <span className={styles.rowLabel}>
            <strong>{props.row.label}</strong>
            <small>{props.row.type === 'slot' ? readSlotEntrySummary(props.row.entries) : primary.node.meta}</small>
          </span>
        )}
        <span className={styles.source} data-loom-source-kind={primary.sourceKind}>
          {primary.sourceKind === 'virtual' ? props.t('context.sourceVirtual') : props.t('context.sourceActual')}
        </span>
      </div>

      {props.row.type === 'slot' && !slotCollapsed ? (
        <div className={styles.slotEntries}>
          {props.row.entries.map((entry, index) => (
            <div
              className={`${styles.row} ${styles.slotEntry} ${entry.node.id === props.selectedId ? styles.selected : ''}`}
              draggable={props.reorderable}
              key={entry.node.id}
              onDragEnd={event => {
                event.stopPropagation()
                props.onDragEnd()
              }}
              onDragOver={event => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onDragStart={event => {
                event.stopPropagation()
                props.onDragStart(entry.node.id)
              }}
              onDrop={event => {
                event.stopPropagation()
                props.onDrop(entry.node.id)
              }}
            >
              {props.reorderable ? <GripVertical className={styles.dragHandle} aria-hidden="true" /> : null}
              <span className={styles.position}>{String(entry.position).padStart(2, '0')}</span>
              <span className={props.isLast ? styles.guideEmpty : styles.guidePass} aria-hidden="true" />
              <span className={index === props.row.entries.length - 1 ? styles.guideEnd : styles.guideBranch} aria-hidden="true" />
              {props.onSelect ? (
                <button className={styles.rowLabel} type="button" onClick={() => props.onSelect?.(entry.node.id)}>
                  <strong>{entry.node.label}</strong>
                  <small>{entry.node.meta}</small>
                </button>
              ) : (
                <span className={styles.rowLabel}>
                  <strong>{entry.node.label}</strong>
                  <small>{entry.node.meta}</small>
                </span>
              )}
              <span className={styles.source} data-loom-source-kind={entry.sourceKind}>
                {entry.sourceKind === 'virtual' ? props.t('context.sourceVirtual') : props.t('context.sourceActual')}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
