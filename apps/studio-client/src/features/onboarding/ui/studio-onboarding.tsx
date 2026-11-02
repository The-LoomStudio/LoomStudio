import studioLogoUrl from '../../../shared/assets/logo.png'
import { useRef, useState } from 'react'
import { Button, TextInput } from '@loom-studio/ui'
import type { AgentPreset, ProviderAccount, ProviderModelSelection } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import { localeLabels, supportedLocales, type Locale } from '../../../shared/i18n/index.js'
import { normalizeOpenAICompatibleBaseUrl } from '../../provider-settings/model/provider-base-url.js'
import { onboardingCopy } from '../model/onboarding-copy.js'
import { OnboardingView } from './onboarding-view.js'
import styles from './studio-onboarding.module.scss'

export function StudioOnboarding(props: {
  api: StudioApi
  locale: Locale
  localePending?: boolean
  onLocale(locale: Locale): void
  accounts: ProviderAccount[]
  accountsLoaded: boolean
  assistant?: AgentPreset
  onRefresh(): Promise<void>
  onFinish(guided: boolean): void
}) {
  const copy = onboardingCopy[props.locale]
  const [step, setStep] = useState(0)
  const [available, setAvailable] = useState(0)
  const [accountId, setAccountId] = useState('')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [model, setModel] = useState('')
  const [selection, setSelection] = useState<ProviderModelSelection>()
  const createdAccount = useRef<ProviderAccount | undefined>(undefined)
  const boundModel = useRef<string | undefined>(undefined)
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const account = props.accounts.find(item => item.id === accountId)
  const move = (next: number) => { setStep(next); setAvailable(current => Math.max(current, next)); setError('') }

  async function run(action: () => Promise<void>) {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try { await action() }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { pending.current = false; setBusy(false) }
  }

  async function saveModel(next: (step: number) => void) {
    if (!model.trim()) throw new Error(copy.missing)
    let saved = accountId ? account ?? (createdAccount.current?.id === accountId ? createdAccount.current : undefined) : undefined
    if (!saved) {
      const result = await props.api.providerAccounts.create({
        providerExtensionId: 'official.openai-compatible', displayName: name.trim(),
        config: { baseUrl: normalizeOpenAICompatibleBaseUrl(url) }, enabledModelIds: [model.trim()],
        ...(key.trim() ? { credential: { apiKey: key.trim() } } : {}),
      })
      saved = result.providerProfile
      createdAccount.current = saved
      setAccountId(saved.id)
      setKey('')
    } else if (!saved.enabledModelIds.includes(model.trim())) {
      const result = await props.api.providerAccounts.update({
        providerProfileId: saved.id, expectedVersion: saved.version,
        enabledModelIds: [...saved.enabledModelIds, model.trim()],
      })
      saved = result.providerProfile
      if (createdAccount.current?.id === saved.id) createdAccount.current = saved
    }
    setSelection({ providerProfileId: saved.id, modelId: model.trim() })
    await props.onRefresh()
    next(2)
  }

  async function finish(guided: boolean) {
    if (selection && props.assistant) {
      const binding = JSON.stringify([props.assistant.id, selection.providerProfileId, selection.modelId])
      if (boundModel.current !== binding && (props.assistant.model?.providerProfileId !== selection.providerProfileId || props.assistant.model.modelId !== selection.modelId)) {
        await props.api.agentPresets.update({ agentPresetId: props.assistant.id, expectedVersion: props.assistant.version, model: selection })
        boundModel.current = binding
      }
      await props.onRefresh()
    }
    props.onFinish(guided)
  }

  return <OnboardingView locale={props.locale} busy={busy} step={step} availableStep={available}
    completedSteps={[...(available > 0 ? [0] : []), ...(selection ? [1] : [])]}
    onStepChange={move} onBack={step ? () => move(step - 1) : undefined}
    title={copy.titles[step]} description={copy.descriptions[step]}
    actions={next => step === 0 ? <Button onClick={() => next(1)}>{copy.next} →</Button> : step === 1 ? <>
      <Button disabled={busy} onClick={() => { setSelection(undefined); next(2) }}>{copy.skip}</Button>
      <Button type="submit" form="onboarding-model" disabled={busy || !props.accountsLoaded}>{busy ? copy.saving : copy.save} →</Button>
    </> : <><Button disabled={busy} onClick={() => void run(() => finish(false))}>{copy.explore}</Button><Button disabled={busy || !props.assistant} onClick={() => void run(() => finish(true))}>{busy ? copy.saving : copy.chat} →</Button></>}>
    {next => <>
    {step === 0 ? <fieldset className={styles.languages} disabled={props.localePending} aria-busy={props.localePending}><legend>{copy.language}</legend>{supportedLocales.map(locale => <label key={locale}><input type="radio" name="onboarding-language" checked={props.locale === locale} onChange={() => props.onLocale(locale)} />{localeLabels[locale]}</label>)}</fieldset> : null}
    {step === 1 ? <form id="onboarding-model" className={styles.form} onSubmit={event => { event.preventDefault(); void run(() => saveModel(next)) }}>
      {!props.accountsLoaded ? <p role="status">{copy.loading} <Button onClick={() => void run(props.onRefresh)}>{copy.retry}</Button></p> : null}
      <fieldset disabled={busy || !props.accountsLoaded}>
        <label>{copy.account}<select value={accountId} onChange={event => { setAccountId(event.target.value); setSelection(undefined); setModel(props.accounts.find(item => item.id === event.target.value)?.enabledModelIds[0] ?? '') }}>
          <option value="">{copy.newAccount}</option>{props.accounts.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}
        </select></label>
        {!accountId ? <><label>{copy.name}<TextInput required value={name} onChange={e => setName(e.target.value)} /></label><label>{copy.url}<input type="url" required value={url} placeholder="https://…/v1" onChange={e => setUrl(e.target.value)} /></label><label>{copy.key}<input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} /></label></> : null}
        <label>{copy.model}<TextInput required value={model} list="onboarding-models" onChange={e => { setModel(e.target.value); setSelection(undefined) }} /><datalist id="onboarding-models">{account?.enabledModelIds.map(id => <option key={id} value={id} />)}</datalist></label>
      </fieldset>
      <p className={styles.note}>{copy.modelNote}</p>{selection ? <p role="status" className={styles.note}>{copy.saved}</p> : null}
    </form> : null}
    {step === 2 ? <div className={styles.assistant}><img src={studioLogoUrl} alt="" /><div><h2>Loom Assistant</h2><p>{copy.quote}</p><span className={styles.note}>{copy.builtin}</span>{!props.assistant ? <p role="status">{copy.unavailable} <Button disabled={busy} onClick={() => void run(props.onRefresh)}>{copy.retry}</Button></p> : null}</div></div> : null}
    {error ? <p role="alert">{error}</p> : null}
    </>}
  </OnboardingView>
}
