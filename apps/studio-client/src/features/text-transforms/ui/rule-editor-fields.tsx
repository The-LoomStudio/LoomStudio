import type { TextTransformRuleDraft } from '../../../entities/text-transform.js'
import type { Translator } from '../../../shared/i18n/index.js'
import styles from './text-transform-panel.module.scss'

type RuleEditorValue = Omit<TextTransformRuleDraft, 'orderIndex'> & { orderIndex: number | null }

export function readRuleEditorValue(text: string): RuleEditorValue {
  const value = JSON.parse(text)
  if (!value || typeof value.name !== 'string' || typeof value.enabled !== 'boolean'
    || !(value.orderIndex === null || typeof value.orderIndex === 'number')
    || value.matcher?.kind !== 'regex' || typeof value.matcher.pattern !== 'string'
    || typeof value.matcher.flags !== 'string'
    || !Array.isArray(value.targets) || !Array.isArray(value.phases)
    || !['replace', 'mark', 'promote-reasoning'].includes(value.effect?.kind)
    || (value.effect.kind === 'replace' && typeof value.effect.replacement !== 'string')) {
    throw new Error('Unsupported rule structure')
  }
  return value
}

export function RuleEditorFields({ value, disabled, onChange, t }: {
  value: RuleEditorValue
  disabled: boolean
  onChange(value: RuleEditorValue): void
  t: Translator
}) {
  const effect = value.effect
  return <fieldset className={styles.ruleFields} disabled={disabled}>
    <label>{t('textTransform.name')}<input value={value.name} onChange={event => onChange({ ...value, name: event.target.value })} /></label>
    <div className={styles.fieldRow}>
      <label className={styles.checkField}><input type="checkbox" checked={value.enabled} onChange={event => onChange({ ...value, enabled: event.target.checked })} />{t('textTransform.enabled')}</label>
      <label>{t('textTransform.order')}<input type="number" step="1" value={value.orderIndex ?? ''} onChange={event => onChange({ ...value, orderIndex: event.target.value === '' ? null : Number(event.target.value) })} /></label>
    </div>
    <label>{t('textTransform.pattern')}<textarea rows={3} spellCheck={false} value={value.matcher.pattern}
      onChange={event => onChange({ ...value, matcher: { ...value.matcher, pattern: event.target.value } })} /></label>
    <fieldset className={styles.optionFields}><legend>{t('textTransform.flags')}</legend>
      {['d', 'g', 'i', 'm', 's', 'u', 'v', 'y'].map(flag => <label key={flag} className={styles.checkField}><input type="checkbox" checked={value.matcher.flags.includes(flag)}
        onChange={event => onChange({ ...value, matcher: { ...value.matcher, flags: event.target.checked ? value.matcher.flags + flag : value.matcher.flags.replaceAll(flag, '') } })} />{flag}</label>)}
    </fieldset>
    <label>{t('textTransform.effect')}<select value={effect.kind} onChange={event => {
      const kind = event.target.value as typeof effect.kind
      onChange({ ...value, effect: kind === 'replace' ? { kind, replacement: '' } : kind === 'mark' ? { kind } : { kind, visibility: 'collapsed', replay: 'omit' } })
    }}>
      <option value="replace">{t('textTransform.replace')}</option><option value="mark">{t('textTransform.mark')}</option><option value="promote-reasoning">{t('textTransform.promoteReasoning')}</option>
    </select></label>
    {effect.kind === 'replace' ? <label>{t('textTransform.replacement')}<textarea className={styles.replacementInput} spellCheck={false} value={effect.replacement}
      onChange={event => onChange({ ...value, effect: { ...effect, replacement: event.target.value } })} /></label> : null}
    {effect.kind === 'mark' ? <label>{t('textTransform.markerType')}<input value={effect.markerType ?? ''}
      onChange={event => onChange({ ...value, effect: { ...effect, markerType: event.target.value || undefined } })} /></label> : null}
    {effect.kind === 'promote-reasoning' ? <>
      <label>{t('textTransform.contentGroup')}<input value={effect.contentGroup ?? ''} onChange={event => {
        const group = event.target.value
        onChange({ ...value, effect: { ...effect, contentGroup: group === '' ? undefined : /^\d+$/.test(group) ? Number(group) : group } })
      }} /></label>
      <div className={styles.fieldRow}>
        <label>{t('textTransform.visibility')}<select value={effect.visibility} onChange={event => onChange({ ...value, effect: { ...effect, visibility: event.target.value as typeof effect.visibility } })}>
          {(['collapsed', 'hidden', 'visible'] as const).map(option => <option key={option} value={option}>{t(`textTransform.${option}`)}</option>)}
        </select></label>
        <label>{t('textTransform.replay')}<select value={effect.replay} onChange={event => onChange({ ...value, effect: { ...effect, replay: event.target.value as typeof effect.replay } })}>
          <option value="omit">{t('textTransform.omit')}</option><option value="assistant-content">{t('textTransform.assistantContent')}</option>
        </select></label>
      </div>
      <label>{t('textTransform.dialect')}<input value={effect.dialect ?? ''} onChange={event => onChange({ ...value, effect: { ...effect, dialect: event.target.value || undefined } })} /></label>
    </> : null}
    <fieldset className={styles.optionFields}><legend>{t('textTransform.targets')}</legend>
      {(['narrative', 'agent-session'] as const).map(target => <label key={target} className={styles.checkField}><input type="checkbox" checked={value.targets.includes(target)}
        onChange={event => onChange({ ...value, targets: event.target.checked ? [...value.targets, target] : value.targets.filter(item => item !== target) })} />{t(`textTransform.target.${target}`)}</label>)}
    </fieldset>
    <fieldset className={styles.optionFields}><legend>{t('textTransform.phases')}</legend>
      {(['classify', 'prompt', 'display'] as const).map(phase => <label key={phase} className={styles.checkField}><input type="checkbox" checked={value.phases.includes(phase)}
        onChange={event => onChange({ ...value, phases: event.target.checked ? [...value.phases, phase] : value.phases.filter(item => item !== phase) })} />{t(`textTransform.phase.${phase}`)}</label>)}
    </fieldset>
    <div className={styles.fieldRow}>{(['minDepth', 'maxDepth'] as const).map(key => <label key={key}>{t(`textTransform.${key}`)}
      <input type="number" min="0" step="1" value={value.range?.[key] ?? ''} onChange={event => onChange({ ...value, range: { ...value.range, [key]: event.target.value === '' ? undefined : Number(event.target.value) } })} />
    </label>)}</div>
  </fieldset>
}
