import { isPromptMessageSequence } from '@loom-studio/shared'
import { buildSearchMatchPattern, searchRevealKey, type SearchReveal } from '../../../../shared/lib/search-match.js'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Anchor, Bot, Braces, ChevronDown, Equal, Info, KeyRound, ListFilter, RefreshCw, Settings2, Zap } from 'lucide-react'
import type { ContextAssetNode, PromptResource } from '../../../../entities/index.js'
import type { Translator } from '../../../../shared/i18n/index.js'
import { LongTextEditor, type LongTextEditorHandle } from '../../../../shared/ui/long-text-editor/long-text-editor.js'
import { type LongTextEditorMode } from '../../../../shared/ui/long-text-editor/long-text-editor-model.js'
import { DEFAULT_PRESET_ANCHOR_IDS } from '../../model/preset-anchor-options.js'
import {
  buildActivationUpdate,
  normalizeKeywords,
  readActivationDraft,
  updateActivationDraft,
  type ActivationConditionPreset,
  type ActivationConditionValue,
  type ActivationEditorMode,
} from '../../model/activation-editor.js'
import styles from './context-asset-detail.module.scss'
import { PresetAnchorPicker } from './preset-anchor-picker.js'

type ContextAssetDetailProps = {
  headerExtra?: ReactNode
  activationEditable?: boolean
  allowTargetAnchor?: boolean
  compactVirtualNotes?: boolean
  editorMode: LongTextEditorMode
  revealMatch?: SearchReveal
  metadataOpen: boolean
  node: ContextAssetNode
  inheritedDisabled?: boolean
  presets?: PromptResource[]
  onChangeNode: (partial: Partial<ContextAssetNode>) => void
  onCommitNode: (partial: Partial<ContextAssetNode>) => void
  onEditorModeChange(mode: LongTextEditorMode): void
  onMetadataOpenChange(open: boolean): void
  t: Translator
}

export function ContextAssetDetail(props: ContextAssetDetailProps) {
  const editorRef = useRef<LongTextEditorHandle>(null)
  const compactNotesRef = useRef<HTMLInputElement>(null)
  const revealedCompactRequestRef = useRef<string | undefined>(undefined)
  const isTextLike = props.node.kind === 'entry' || props.node.kind === 'script'
  const isEntry = props.node.kind === 'entry'
  const muted = props.inheritedDisabled || props.node.enabled === false
  const allowTargetAnchor = props.allowTargetAnchor ?? true
  const body = props.node.body ?? ''
  const readOnly = isReadOnlyDetailNode(props.node)
  const activationDraft = readActivationDraft(props.node)
  const anchorDatalistId = useId()
  const [keywordsText, setKeywordsText] = useState(activationDraft.keywords)
  const [anchorPickerOpen, setAnchorPickerOpen] = useState(false)
  const keywordsSourceRef = useRef({ nodeId: props.node.id, value: activationDraft.keywords })

  useEffect(() => {
    const reveal = props.revealMatch
    const input = compactNotesRef.current
    if (!reveal) { revealedCompactRequestRef.current = undefined; return }
    const key = JSON.stringify([props.node.id, searchRevealKey(reveal)])
    if (!input || revealedCompactRequestRef.current === key) return
    revealedCompactRequestRef.current = key
    const pattern = buildSearchMatchPattern(reveal.query)
    const match = pattern ? new RegExp(pattern, 'i').exec(body) : null
    if (!match) return
    input.setSelectionRange(match.index, match.index + match[0].length)
    input.scrollIntoView({ block: 'center' })
  }, [props.revealMatch?.requestId, props.revealMatch?.query, props.node.id, body])

  const previousKeywords = keywordsSourceRef.current
  if (previousKeywords.nodeId !== props.node.id || previousKeywords.value !== activationDraft.keywords) {
    keywordsSourceRef.current = { nodeId: props.node.id, value: activationDraft.keywords }
    if (previousKeywords.nodeId !== props.node.id || keywordsText === previousKeywords.value) {
      setKeywordsText(activationDraft.keywords)
    }
  }

  if (isPromptMessageSequence(props.node)) {
    return <div className={`${styles.detailBody} ${muted ? styles.detailBodyMuted : ''}`}>
      <p>{props.t('context.messageSequence.description')}</p>
      <p>{props.t('context.messageSequence.placement')}</p>
      <code>@chat.session</code>
    </div>
  }

  const canShowActivation = Boolean(props.activationEditable && (props.node.kind === 'module' || props.node.kind === 'folder' || props.node.kind === 'entry'))

  function updateCapabilities(partial: Partial<NonNullable<ContextAssetNode['capabilities']>>, commit = false) {
    const update = { capabilities: { ...props.node.capabilities, ...partial } }
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
      className={`${styles.detailBody} ${muted ? styles.detailBodyMuted : ''} ${props.compactVirtualNotes && props.node.kind === 'virtual' ? styles.compactNotes : ''}`}
      onKeyDownCapture={event => {
        if (event.key !== 'Escape' || !props.metadataOpen || anchorPickerOpen) return
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
        {props.node.kind === 'message' ? (
          <div>
            <dt><Bot aria-hidden="true" />Role</dt>
            <dd>
              <select
                className={styles.inlineInput}
                disabled={readOnly}
                value={props.node.capabilities?.roleHint ?? 'system'}
                onChange={event => {
                  const role = event.target.value as 'system' | 'user' | 'assistant'
                  const update = { capabilities: { ...props.node.capabilities, roleHint: role } }
                  props.onChangeNode(update)
                  props.onCommitNode(update)
                }}
              >
                <option value="system">System</option>
                <option value="user">User</option>
                <option value="assistant">Assistant</option>
              </select>
            </dd>
          </div>
        ) : null}
        {props.node.kind === 'virtual' ? (
          <div>
            <dt><Anchor aria-hidden="true" />{props.t('context.metadata.anchorId')}</dt>
            <dd>
              <input
                className={styles.inlineInput}
                disabled={readOnly}
                list={anchorDatalistId}
                value={props.node.capabilities?.targetAnchorId !== undefined ? props.node.capabilities.targetAnchorId : (props.node.label.startsWith('@') ? props.node.label : '')}
                placeholder={props.t('context.metadata.anchorIdPlaceholder')}
                onChange={event => updateCapabilities({ targetAnchorId: event.target.value })}
                onBlur={event => updateCapabilities({ targetAnchorId: event.target.value.trim() }, true)}
                onKeyDown={event => {
                  if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
                  if (event.key === 'Enter') {
                    event.currentTarget.blur()
                  }
                }}
              />
              <datalist id={anchorDatalistId}>
                {DEFAULT_PRESET_ANCHOR_IDS.map(id => (
                  <option key={id} value={id} />
                ))}
              </datalist>
            </dd>
          </div>
        ) : null}
        <div>
            <dt><Info aria-hidden="true" />{props.t('context.metadata.meta')}</dt>
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
                onChange={event => {
                  const mode = event.target.value as ActivationEditorMode
                  if (mode === 'keyword') {
                    setKeywordsText(activationDraft.keywords)
                  }
                  updateActivation({ mode }, true)
                }}
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
                  value={keywordsText}
                  onChange={event => setKeywordsText(event.target.value)}
                  onBlur={() => {
                    const normalized = normalizeKeywords(keywordsText)
                    setKeywordsText(normalized.join(', '))
                    updateActivation({ keywords: keywordsText }, true)
                  }}
                  onKeyDown={event => {
                    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
                    if (event.key === 'Enter') {
                      event.currentTarget.blur()
                    }
                  }}
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
          {allowTargetAnchor ? (
            <div>
              <dt><Anchor aria-hidden="true" />{props.t('context.metadata.targetAnchor') || '目标锚点'}</dt>
              <dd>
                <button
                  type="button"
                  className={styles.anchorTrigger}
                  aria-haspopup="dialog"
                  disabled={readOnly}
                  onClick={() => setAnchorPickerOpen(true)}
                >
                  <span>{props.node.capabilities?.targetAnchorId || props.t('context.anchorPicker.unselected')}</span>
                  <ChevronDown aria-hidden="true" />
                </button>
              </dd>
            </div>
          ) : null}
          <div>
            <dt><RefreshCw aria-hidden="true" />{props.t('context.metadata.lifecycle')}</dt>
            <dd>
              <select
                className={styles.inlineInput}
                disabled={readOnly}
                value={props.node.capabilities?.lifecycle?.lifecycle ?? 'always'}
                onChange={event => updateCapabilities({ lifecycle: { lifecycle: event.target.value } }, true)}
              >
                <option value="always">{props.t('context.activation.always')}</option>
                <option value="conditional">{props.t('context.activation.condition')}</option>
                <option value="fresh">{props.t('context.metadata.lifecycleFresh') || '新鲜'}</option>
              </select>
            </dd>
          </div>
            </section>
          ) : null}
        </div>
      </div>
      {anchorPickerOpen ? <PresetAnchorPicker
        key={props.node.id}
        presets={props.presets ?? []}
        selectedAnchorId={props.node.capabilities?.targetAnchorId}
        t={props.t}
        onClose={() => setAnchorPickerOpen(false)}
        onSelect={id => {
          updateCapabilities({ targetAnchorId: id }, true)
          setAnchorPickerOpen(false)
        }}
      /> : null}

      <div className={`${styles.editorScroller} ${props.metadataOpen ? styles.editorScrollerMetadataOpen : ''}`}>
        {props.compactVirtualNotes && props.node.kind === 'virtual' ? (
          <>
          {props.headerExtra}
          <input className={`${styles.inlineInput} loom-underlined-field`} aria-label={props.t('context.notesLabel')}
            ref={compactNotesRef}
            value={body} disabled={readOnly} placeholder={props.t('context.notesPlaceholder')}
            onChange={event => props.onChangeNode({ body: event.target.value })}
            onBlur={event => props.onCommitNode({ body: event.target.value })} />
          </>
        ) : <LongTextEditor
          headerExtra={props.headerExtra}
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
          revealMatch={props.revealMatch}
          previewEmptyLabel={props.t('longTextEditor.previewEmpty')}
          previewModeLabel={props.t('longTextEditor.previewMode')}
          restoreInitialLabel={props.t('longTextEditor.restoreInitial')}
          diffLabel={props.t('longTextEditor.diff')}
          diffTitle={props.t('longTextEditor.diffTitle')}
          t={props.t}
          placeholder={isTextLike ? props.t('context.contentPlaceholder') : props.t('context.notesPlaceholder')}
          spellCheck={false}
          sourceModeLabel={props.t('longTextEditor.sourceMode')}
          undoEditLabel={props.t('longTextEditor.undoEdit')}
          undoLabel={props.t('longTextEditor.undoClear')}
          value={body}
          onChange={value => props.onChangeNode({ body: value })}
          onCommit={value => props.onCommitNode({ body: value })}
          onModeChange={props.onEditorModeChange}
        />}
      </div>
    </div>
  )
}

export function isReadOnlyDetailNode(node: ContextAssetNode): boolean {
  return node.readOnly === true
    || node.category === 'runtime'
    || node.category === 'history'
    || node.projection?.sourceKind === 'virtual'
    || node.id.startsWith('history-')
}
