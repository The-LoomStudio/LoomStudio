import type { ContextAssetNode } from '../../../../entities/index.js'
import type { Translator } from '../../../../shared/i18n/index.js'
import styles from './ContextAssetDetail.module.css'

type ContextAssetDetailProps = {
  node: ContextAssetNode
  onChangeNode: (partial: Partial<ContextAssetNode>) => void
  t: Translator
}

export function ContextAssetDetail(props: ContextAssetDetailProps) {
  const isTextLike = props.node.kind === 'entry' || props.node.kind === 'script'
  const isEntry = props.node.kind === 'entry'
  const body = props.node.body ?? ''
  const readOnly = isReadOnlyDetailNode(props.node)

  function updateProjection(partial: Partial<NonNullable<ContextAssetNode['projection']>>) {
    if (!props.node.projection) return
    props.onChangeNode({ projection: { ...props.node.projection, ...partial } })
  }

  return (
    <div className={styles.detailBody}>
      <section className={styles.configGrid} aria-label={props.t('context.configLabel')}>
        <div>
          <dt>Label</dt>
          <dd>
            <input
              className={styles.inlineInput}
              disabled={readOnly}
              value={props.node.label}
              onChange={event => props.onChangeNode({ label: event.target.value })}
            />
          </dd>
        </div>
        <div>
          <dt>Meta</dt>
          <dd>
            <input
              className={styles.inlineInput}
              disabled={readOnly}
              value={props.node.meta ?? ''}
              onChange={event => props.onChangeNode({ meta: event.target.value })}
            />
          </dd>
        </div>
      </section>

      {props.node.configRows?.length ? (
        <section className={styles.configGrid} aria-label={props.t('context.configLabel')}>
          {props.node.configRows.map(row => (
            <div key={`${props.node.id}:${row.label}`}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </section>
      ) : null}

      {isEntry ? (
        <section className={styles.configGrid} aria-label={props.t('context.configLabel')}>
          <div>
            <dt>Enabled</dt>
            <dd>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={props.node.enabled !== false}
                  onChange={event => props.onChangeNode({ enabled: event.target.checked })}
                />
                {props.node.enabled !== false ? 'Active' : 'Inactive'}
              </label>
            </dd>
          </div>
          <div>
            <dt>Injection Zone</dt>
            <dd>
              <input
                className={styles.inlineInput}
                list="builtin-zones"
                disabled={readOnly}
                value={props.node.projection?.zone ?? ''}
                onChange={event => updateProjection({ zone: event.target.value })}
                placeholder="Enter or select a zone..."
              />
              <datalist id="builtin-zones">
                <option value="StablePrefix" />
                <option value="NarrativeContext" />
                <option value="LowerContext" />
                <option value="CurrentTurn" />
                <option value="FreshTail" />
              </datalist>
            </dd>
          </div>
          <div>
            <dt>Order Hint</dt>
            <dd>
              <input
                className={styles.inlineInput}
                disabled={readOnly}
                type="number"
                value={props.node.projection?.entryOrder ?? 0}
                onChange={event => updateProjection({ entryOrder: parseInt(event.target.value, 10) || 0 })}
              />
            </dd>
          </div>
          <div>
            <dt>Injection Group</dt>
            <dd>
              <input
                className={styles.inlineInput}
                disabled={readOnly}
                value={props.node.projection?.group ?? ''}
                onChange={event => updateProjection({ group: event.target.value })}
              />
            </dd>
          </div>
          <div>
            <dt>Slot Key</dt>
            <dd>
              <input
                className={styles.inlineInput}
                disabled={readOnly}
                value={props.node.projection?.slotKey ?? ''}
                onChange={event => updateProjection({ slotKey: event.target.value })}
              />
            </dd>
          </div>
          <div>
            <dt>Lifecycle</dt>
            <dd>
              <select
                className={styles.inlineInput}
                disabled={readOnly}
                value={props.node.projection?.lifecycle ?? 'always'}
                onChange={event => updateProjection({ lifecycle: event.target.value })}
              >
                <option value="always">always</option>
                <option value="keyword">keyword</option>
                <option value="manual">manual</option>
                <option value="current-turn">current-turn</option>
              </select>
            </dd>
          </div>
          <div>
            <dt>Anchor</dt>
            <dd>
              <select
                className={styles.inlineInput}
                disabled={readOnly}
                value={props.node.projection?.anchor ?? 'inside'}
                onChange={event => updateProjection({ anchor: event.target.value as 'before' | 'inside' | 'after' })}
              >
                <option value="before">before</option>
                <option value="inside">inside</option>
                <option value="after">after</option>
              </select>
            </dd>
          </div>
        </section>
      ) : null}

      <label className={styles.editorBlock}>
        <span>{isTextLike ? props.t('context.contentLabel') : props.t('context.notesLabel')}</span>
        <textarea
          className={styles.editorTextarea}
          disabled={readOnly}
          value={body}
          onChange={event => props.onChangeNode({ body: event.target.value })}
          spellCheck={false}
        />
      </label>

      {props.node.projection ? (
        <footer className={styles.detailFooter}>
          <span>{props.node.projection.zone}</span>
          <span>{props.node.projection.group}</span>
        </footer>
      ) : null}
    </div>
  )
}

function isReadOnlyDetailNode(node: ContextAssetNode): boolean {
  return node.category === 'runtime'
    || node.category === 'history'
    || node.projection?.sourceKind === 'virtual'
    || node.id.startsWith('history-')
}
