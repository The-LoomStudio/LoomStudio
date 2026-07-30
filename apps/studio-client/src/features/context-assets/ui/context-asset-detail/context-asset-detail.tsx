import type { ContextAssetNode } from '../../../../entities/index.js'
import type { Translator } from '../../../../shared/i18n/index.js'
import {
  buildActivationUpdate,
  readActivationDraft,
  updateActivationDraft,
  type ActivationConditionPreset,
  type ActivationConditionValue,
  type ActivationEditorMode,
} from '../../model/activation-editor.js'
import styles from './context-asset-detail.module.scss'

type ContextAssetDetailProps = {
  activationEditable?: boolean
  node: ContextAssetNode
  onChangeNode: (partial: Partial<ContextAssetNode>) => void
  onCommitNode: (partial: Partial<ContextAssetNode>) => void
  t: Translator
}

export function ContextAssetDetail(props: ContextAssetDetailProps) {
  const isTextLike = props.node.kind === 'entry' || props.node.kind === 'script'
  const isEntry = props.node.kind === 'entry'
  const body = props.node.body ?? ''
  const readOnly = isReadOnlyDetailNode(props.node)
  const activationDraft = readActivationDraft(props.node)
  const canShowActivation = Boolean(props.activationEditable && (props.node.kind === 'module' || props.node.kind === 'folder' || props.node.kind === 'entry'))

  function updateProjection(partial: Partial<NonNullable<ContextAssetNode['projection']>>, commit = false) {
    if (!props.node.projection) return
    const update = { projection: { ...props.node.projection, ...partial } }
    props.onChangeNode(update)
    if (commit) props.onCommitNode(update)
  }

  function updateActivation(partial: Partial<ReturnType<typeof readActivationDraft>>, commit = false) {
    const draft = updateActivationDraft(activationDraft, partial)
    const update = buildActivationUpdate({ draft, node: props.node })
    props.onChangeNode(update)
    if (commit) props.onCommitNode(update)
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
              onBlur={event => props.onCommitNode({ label: event.target.value })}
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
              onBlur={event => props.onCommitNode({ meta: event.target.value })}
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

      {canShowActivation ? (
        <section className={styles.configGrid} aria-label={props.t('context.activation.label')}>
          <div>
            <dt>{props.t('context.activation.mode')}</dt>
            <dd>
              <select
                className={styles.inlineInput}
                disabled={readOnly}
                value={activationDraft.mode}
                onChange={event => updateActivation({ mode: event.target.value as ActivationEditorMode }, true)}
              >
                <option value="always">{props.t('context.activation.always')}</option>
                <option value="manual">{props.t('context.activation.manual')}</option>
                <option value="keyword">{props.t('context.activation.keyword')}</option>
                <option value="condition">{props.t('context.activation.condition')}</option>
                {activationDraft.mode === 'custom' ? <option value="custom">{props.t('context.activation.custom')}</option> : null}
              </select>
            </dd>
          </div>
          {activationDraft.mode === 'keyword' ? (
            <div>
              <dt>{props.t('context.activation.keywords')}</dt>
              <dd>
                <input
                  className={styles.inlineInput}
                  disabled={readOnly}
                  value={activationDraft.keywords}
                  onChange={event => updateActivation({ keywords: event.target.value })}
                  onBlur={event => updateActivation({ keywords: event.target.value }, true)}
                  placeholder={props.t('context.activation.keywordsPlaceholder')}
                />
              </dd>
            </div>
          ) : null}
          {activationDraft.mode === 'condition' ? (
            <>
              <div>
                <dt>{props.t('context.activation.fact')}</dt>
                <dd>
                  <select
                    className={styles.inlineInput}
                    disabled={readOnly}
                    value={activationDraft.conditionPreset}
                    onChange={event => {
                      const conditionPreset = event.target.value as ActivationConditionPreset
                      updateActivation({
                        conditionPreset,
                        conditionValue: conditionPreset === 'agent.mode' ? 'draft' : 'scene:combat',
                      }, true)
                    }}
                  >
                    <option value="agent.mode">agent.mode</option>
                    <option value="tags">tags</option>
                  </select>
                </dd>
              </div>
              <div>
                <dt>{activationDraft.conditionPreset === 'agent.mode' ? props.t('context.activation.equals') : props.t('context.activation.includes')}</dt>
                <dd>
                  <select
                    className={styles.inlineInput}
                    disabled={readOnly}
                    value={activationDraft.conditionValue}
                    onChange={event => updateActivation({ conditionValue: event.target.value as ActivationConditionValue }, true)}
                  >
                    {activationDraft.conditionPreset === 'agent.mode' ? (
                      <>
                        <option value="draft">draft</option>
                        <option value="finalize">finalize</option>
                      </>
                    ) : (
                      <>
                        <option value="scene:combat">scene:combat</option>
                        <option value="style:cinematic">style:cinematic</option>
                      </>
                    )}
                  </select>
                </dd>
              </div>
            </>
          ) : null}
          {activationDraft.mode === 'custom' ? (
            <div>
              <dt>{props.t('context.activation.custom')}</dt>
              <dd>{props.t('context.activation.customHint')}</dd>
            </div>
          ) : null}
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
                  onChange={event => {
                    const update = { enabled: event.target.checked }
                    props.onChangeNode(update)
                    props.onCommitNode(update)
                  }}
                />
                {props.node.enabled !== false ? 'Active' : 'Inactive'}
              </label>
            </dd>
          </div>
          <div>
            <dt>Zone ID</dt>
            <dd>
              <input
                className={styles.inlineInput}
                list="builtin-zones"
                disabled={readOnly}
                value={props.node.projection?.zoneId ?? ''}
                onChange={event => updateProjection({ zoneId: event.target.value })}
                onBlur={event => updateProjection({ zoneId: event.target.value }, true)}
                placeholder="Enter or select a zone..."
              />
              <datalist id="builtin-zones">
                <option value="preset.system" />
                <option value="setting.stable" />
                <option value="chat.history" />
                <option value="setting.lower" />
                <option value="chat.before" />
                <option value="chat.inside" />
                <option value="chat.after" />
                <option value="fresh.tail" />
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
                onBlur={event => updateProjection({ entryOrder: parseInt(event.target.value, 10) || 0 }, true)}
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
                onBlur={event => updateProjection({ slotKey: event.target.value }, true)}
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
                onChange={event => updateProjection({ lifecycle: event.target.value }, true)}
              >
                <option value="always">always</option>
                <option value="keyword">keyword</option>
                <option value="manual">manual</option>
                <option value="current-turn">current-turn</option>
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
          onBlur={event => props.onCommitNode({ body: event.target.value })}
          spellCheck={false}
        />
      </label>

      {props.node.projection ? (
        <footer className={styles.detailFooter}>
          <span>{props.node.projection.zoneId}</span>
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
