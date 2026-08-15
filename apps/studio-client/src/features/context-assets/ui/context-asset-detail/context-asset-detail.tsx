import { useRef } from 'react'
import { Braces, Equal, Info, KeyRound, ListFilter, ListOrdered, MapPin, RefreshCw, Settings2, Tag, Zap } from 'lucide-react'
import type { ContextAssetNode } from '../../../../entities/index.js'
import type { Translator } from '../../../../shared/i18n/index.js'
import { LongTextEditor, type LongTextEditorHandle } from '../../../../shared/ui/long-text-editor/long-text-editor.js'
import type { LongTextEditorMode } from '../../../../shared/ui/long-text-editor/long-text-editor-model.js'
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
  editorMode: LongTextEditorMode
  metadataOpen: boolean
  node: ContextAssetNode
  onChangeNode: (partial: Partial<ContextAssetNode>) => void
  onCommitNode: (partial: Partial<ContextAssetNode>) => void
  onEditorModeChange(mode: LongTextEditorMode): void
  onMetadataOpenChange(open: boolean): void
  t: Translator
}

export function ContextAssetDetail(props: ContextAssetDetailProps) {
  const editorRef = useRef<LongTextEditorHandle>(null)
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
    <div
      className={`${styles.detailBody} ${isEntry && props.node.enabled === false ? styles.detailBodyMuted : ''}`}
      onKeyDownCapture={event => {
        if (event.key !== 'Escape' || !props.metadataOpen) return
        event.preventDefault()
        event.stopPropagation()
        props.onMetadataOpenChange(false)
        queueMicrotask(() => editorRef.current?.focus())
      }}
    >
      <div
        aria-hidden={!props.metadataOpen}
        className={`${styles.metadataPanel} ${props.metadataOpen ? styles.metadataPanelOpen : ''} loom-underlined-fields`}
        data-state={props.metadataOpen ? 'open' : 'closed'}
      >
        <span className={styles.metadataHandle} aria-hidden="true" />
        <div className={styles.metadataScroller}>
          <section className={styles.configGrid} aria-label={props.t('context.configLabel')}>
        <div>
            <dt><Tag aria-hidden="true" />Label</dt>
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
            <dt><Info aria-hidden="true" />Meta</dt>
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
              <dt><Settings2 aria-hidden="true" />{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
            </section>
          ) : null}

          {canShowActivation ? (
            <section className={styles.configGrid} aria-label={props.t('context.activation.label')}>
          <div>
            <dt><Zap aria-hidden="true" />{props.t('context.activation.mode')}</dt>
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
              <dt><KeyRound aria-hidden="true" />{props.t('context.activation.keywords')}</dt>
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
                <dt><Braces aria-hidden="true" />{props.t('context.activation.fact')}</dt>
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
                <dt>
                  {activationDraft.conditionPreset === 'agent.mode' ? <Equal aria-hidden="true" /> : <ListFilter aria-hidden="true" />}
                  {activationDraft.conditionPreset === 'agent.mode' ? props.t('context.activation.equals') : props.t('context.activation.includes')}
                </dt>
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
              <dt><Settings2 aria-hidden="true" />{props.t('context.activation.custom')}</dt>
              <dd>{props.t('context.activation.customHint')}</dd>
            </div>
          ) : null}
            </section>
          ) : null}

          {isEntry ? (
            <section className={styles.configGrid} aria-label={props.t('context.configLabel')}>
          <div>
            <dt><MapPin aria-hidden="true" />Zone ID</dt>
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
            <dt><ListOrdered aria-hidden="true" />Order Hint</dt>
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
            <dt><KeyRound aria-hidden="true" />Slot Key</dt>
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
            <dt><RefreshCw aria-hidden="true" />Lifecycle</dt>
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
        </div>
      </div>

      <div className={`${styles.editorScroller} ${props.metadataOpen ? styles.editorScrollerMetadataOpen : ''}`}>
        <LongTextEditor
          key={props.node.id}
          ref={editorRef}
          clearLabel={props.t('longTextEditor.clear')}
          clearedLabel={props.t('longTextEditor.cleared')}
          copiedLabel={props.t('longTextEditor.copied')}
          copyFailedLabel={props.t('longTextEditor.copyFailed')}
          copyLabel={props.t('longTextEditor.copy')}
          disableCodeWrapLabel={props.t('markdown.code.disableWrap')}
          disabled={readOnly}
          enableCodeWrapLabel={props.t('markdown.code.enableWrap')}
          label={isTextLike ? props.t('context.contentLabel') : props.t('context.notesLabel')}
          mode={props.editorMode}
          previewEmptyLabel={props.t('longTextEditor.previewEmpty')}
          previewModeLabel={props.t('longTextEditor.previewMode')}
          restoreInitialLabel={props.t('longTextEditor.restoreInitial')}
          placeholder={isTextLike ? props.t('context.contentPlaceholder') : props.t('context.notesPlaceholder')}
          spellCheck={false}
          sourceModeLabel={props.t('longTextEditor.sourceMode')}
          undoEditLabel={props.t('longTextEditor.undoEdit')}
          undoLabel={props.t('longTextEditor.undoClear')}
          value={body}
          onChange={value => props.onChangeNode({ body: value })}
          onCommit={value => props.onCommitNode({ body: value })}
          onModeChange={props.onEditorModeChange}
        />
      </div>
    </div>
  )
}

function isReadOnlyDetailNode(node: ContextAssetNode): boolean {
  return node.readOnly === true
    || node.category === 'runtime'
    || node.category === 'history'
    || node.projection?.sourceKind === 'virtual'
    || node.id.startsWith('history-')
}
