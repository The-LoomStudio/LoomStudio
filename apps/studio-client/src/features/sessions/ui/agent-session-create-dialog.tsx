import { ExtensionIcon, presetIconUrl, useExtensionIdentities } from '../../../shared/ui/extension-icon/extension-icon.js'
import { useState } from 'react'
import { Bot, Check, Plus, X } from 'lucide-react'
import { Button, Dialog, IconButton, SearchField } from '@loom-studio/ui'
import type { AgentPreset, AgentSession } from '../../../entities/index.js'
import { normalizeSearchText } from '../../../shared/lib/text.js'
import type { Translator } from '../../../shared/i18n/index.js'
import styles from './agent-session-picker.module.scss'

export function AgentSessionCreateDialog(props: {
  t: Translator
  presets: AgentPreset[]
  initialPresetId?: string
  onCreate(presetId: string): Promise<AgentSession | undefined>
  onCreated(session: AgentSession): void
  onClose(): void
}) {
  const identities = useExtensionIdentities()
  const [presetId, setPresetId] = useState(props.initialPresetId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const source = (preset: AgentPreset) => {
    const origin = preset.origin
    return origin?.kind === 'extension-package'
      ? props.t('agent.presetExtension', { name: identities.find(item => item.packageId === origin.packageId)?.displayName ?? origin.packageId })
      : props.t(origin?.kind === 'builtin' ? 'agent.presetOfficial' : 'agent.presetPersonal')
  }
  const search = normalizeSearchText(query)
  const presets = props.presets.filter(preset =>
    normalizeSearchText(`${preset.rootNode.label} ${source(preset)}`).includes(search))
  const selectedPreset = props.presets.find(preset => preset.id === presetId)

  async function create() {
    if (!selectedPreset || busy) return
    setBusy(true)
    setError('')
    try {
      const session = await props.onCreate(presetId)
      if (!session) return
      props.onCreated(session)
      props.onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return <Dialog open title={props.t('agent.createSession')} className={styles.dialog} dismissible={!busy}
    onClose={props.onClose}
    showCloseButton={false} headerActions={<IconButton aria-label={props.t('agent.closeCreateSession')} title={props.t('agent.close')} disabled={busy} onClick={props.onClose}>
      <X size={16} aria-hidden="true" />
    </IconButton>}
    actions={<>
    <Button disabled={busy} onClick={props.onClose}>{props.t('character.cancel')}</Button>
    <Button aria-label={props.t('agent.createSessionAction')} disabled={!selectedPreset || busy} onClick={() => void create()}>
      <Plus size={15} aria-hidden="true" />{props.t(busy ? 'agent.creatingSession' : 'agent.createSessionAction')}
    </Button>
  </>}>
    <div className={styles.pickerBody}>
      <SearchField aria-label={props.t('agent.searchPresets')} placeholder={props.t('agent.searchPresetPlaceholder')}
        value={query} onChange={event => setQuery(event.target.value)} clearLabel={props.t('agent.clearSearch')} onClear={() => setQuery('')} />
      <div className={styles.pickerList} role="group" aria-label={props.t('agent.presets')}>
        {presets.map(preset => <button key={preset.id} type="button"
          className={styles.presetChoice} aria-pressed={preset.id === presetId}
          aria-label={props.t('agent.selectPresetNamed', { name: preset.rootNode.label })} disabled={busy} onClick={() => setPresetId(preset.id)}>
          {presetIconUrl(preset, identities) || preset.origin?.kind === 'extension-package' ? <ExtensionIcon iconUrl={presetIconUrl(preset, identities)} size={18} /> : <Bot size={18} aria-hidden="true" />}
          <span className={styles.choiceText}><strong>{preset.rootNode.label}</strong><span>{source(preset)}</span></span>
          {preset.id === presetId ? <Check size={16} aria-hidden="true" /> : null}
        </button>)}
        {!presets.length ? <p className={styles.empty}>{props.t(query ? 'agent.noMatchingPresets' : 'agent.noPresets')}</p> : null}
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  </Dialog>
}
