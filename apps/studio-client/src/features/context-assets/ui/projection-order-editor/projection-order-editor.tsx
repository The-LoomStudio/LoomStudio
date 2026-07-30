import { GripVertical } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Translator } from '../../../../shared/i18n/index.js'
import {
  buildProjectionRows,
  type ProjectionOrderEntry,
} from '../../model/projection-order.js'
import { readSlotEntrySummary, readSlotKey } from '../../model/projection-slot.js'
import styles from './projection-order-editor.module.scss'

type ProjectionOrderEditorProps = {
  entries: ProjectionOrderEntry[]
  onReorder: (draggedId: string, targetId: string) => void
  selectedId?: string
  t: Translator
}

const zones = ['preset.system', 'setting.stable', 'chat.history', 'setting.lower', 'chat.before', 'chat.inside', 'chat.after', 'fresh.tail']

export function ProjectionOrderEditor(props: ProjectionOrderEditorProps) {
  const [draggingId, setDraggingId] = useState<string>()
  const rows = useMemo(() => buildProjectionRows(props.entries), [props.entries])

  return (
    <div className={styles.orderEditor} data-loom-component="projection-order-editor">
      <div className={styles.orderSummary}>
        <span>{props.t('context.orderProfileLabel')}</span>
        <strong>{props.t('context.orderCount', { count: rows.length })}</strong>
      </div>
      {zones.map(zone => {
        const zoneRows = rows.filter(row => row.zoneId === zone)

        return (
          <section className={styles.zone} key={zone}>
            <h3>{zone}</h3>
            {zoneRows.length ? zoneRows.map(row => (
              <article
                className={row.entries.some(entry => entry.node.id === props.selectedId) ? `${styles.projectionItem} ${styles.projectionItemActive}` : styles.projectionItem}
                draggable
                key={row.id}
                onDragEnd={() => setDraggingId(undefined)}
                onDragOver={event => event.preventDefault()}
                onDragStart={() => setDraggingId(row.primary.node.id)}
                onDrop={() => {
                  if (draggingId && draggingId !== row.primary.node.id) props.onReorder(draggingId, row.primary.node.id)
                }}
              >
                <div className={styles.projectionItemHead}>
                  <GripVertical aria-hidden="true" absoluteStrokeWidth size={14} strokeWidth={1.5} />
                  <span>{String(row.primary.position).padStart(2, '0')}</span>
                  <strong>{row.label}</strong>
                  <em data-loom-source-kind={row.primary.sourceKind}>
                    {row.primary.sourceKind === 'virtual' ? props.t('context.sourceVirtual') : props.t('context.sourceActual')}
                  </em>
                </div>
                <span>{row.primary.zoneId}</span>
                <small>{props.t('context.projectionMeta', {
                  lifecycle: row.primary.node.projection?.lifecycle ?? '-',
                  order: row.type === 'slot' ? readSlotEntrySummary(row.entries) : row.primary.node.projection?.order ?? '-',
                })}</small>
                <small>{props.t('context.sortMeta', {
                  entry: row.primary.entryOrder,
                  slot: row.primary.slotOrder,
                })}</small>
                <small>{row.type === 'slot' ? readSlotKey(row.primary.node) : row.primary.node.projection?.reason ?? props.t('context.reasonDefault')}</small>
                {row.type === 'slot' ? (
                  <ul className={styles.projectionChildren}>
                    {row.entries.map(entry => (
                      <li key={entry.node.id}>{entry.node.label}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            )) : <p>{props.t('context.zoneEmpty')}</p>}
          </section>
        )
      })}
    </div>
  )
}
