import styles from './master-detail-editor.module.scss'

export type MasterDetailItem = {
  id: string
  title: string
  subtitle: string
  meta: string
}

type MasterDetailEditorProps = {
  body: string
  detailLabel: string
  emptyText: string
  items: MasterDetailItem[]
  onChangeBody: (value: string) => void
  onSelectItem: (id: string) => void
  selectedId?: string
  title: string
  treeLabel: string
}

export function MasterDetailEditor(props: MasterDetailEditorProps) {
  const selectedItem = props.items.find(item => item.id === props.selectedId)

  return (
    <section className={styles.shell} data-loom-component="master-detail-editor">
      <aside className={styles.treePane} data-loom-component="master-tree">
        <header className={styles.treeHeader}>
          <p>{props.treeLabel}</p>
          <h2>{props.title}</h2>
        </header>
        <div className={styles.treeList} role="tree" aria-label={props.treeLabel}>
          {props.items.map(item => (
            <button
              aria-selected={item.id === props.selectedId}
              className={item.id === props.selectedId ? `${styles.treeItem} ${styles.selected}` : styles.treeItem}
              key={item.id}
              role="treeitem"
              type="button"
              onClick={() => props.onSelectItem(item.id)}
            >
              <span>{item.title}</span>
              <small>{item.subtitle}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className={styles.detailStage} data-loom-component="detail-stage">
        <div className={styles.editorColumn} data-loom-component="detail-editor">
          <header className={styles.editorHeader}>
            <p>{props.detailLabel}</p>
            <h1>{selectedItem?.title ?? props.emptyText}</h1>
            <span>{selectedItem?.meta ?? '-'}</span>
          </header>

          <textarea
            aria-label={props.detailLabel}
            className={styles.editorTextarea}
            disabled={!selectedItem}
            value={selectedItem ? props.body : ''}
            onChange={event => props.onChangeBody(event.target.value)}
            placeholder={props.emptyText}
            spellCheck={false}
          />

          <footer className={styles.editorFooter}>
            <span>{selectedItem?.id ?? '-'}</span>
            <span>{props.body.length} chars</span>
          </footer>
        </div>
      </section>
    </section>
  )
}
