import type { ClientJsonValue } from '@loom-studio/client-bridge'
import { useEffect, useState, type FormEvent } from 'react'
import type {
  AiCapabilityProfile,
  AiGatewayCapabilityDefinition,
  AiGatewayFieldDefinition,
  AiGatewayInvokeInput,
  AiGatewayInvokeResult,
  ProviderAccount,
  RegisteredAiGatewayProvider,
} from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import styles from './model-panel.module.scss'

type AiCapabilityLabProps = {
  providers: RegisteredAiGatewayProvider[]
  providerAccounts: ProviderAccount[]
  profiles: AiCapabilityProfile[]
  onCreateProviderAccount(input: {
    providerExtensionId: string
    displayName: string
    config: Record<string, ClientJsonValue>
    credential?: Record<string, string>
  }): Promise<string | undefined>
  onCreateProfile(input: {
    providerProfileId: string
    capabilityId: string
    displayName: string
    config: Record<string, ClientJsonValue>
  }): Promise<string | undefined>
  onUpdateProviderAccount(input: {
    providerProfileId: string
    displayName: string
    config: Record<string, ClientJsonValue>
    credential?: Record<string, string>
  }): Promise<void>
  onUpdateProfile(input: {
    profileId: string
    displayName: string
    config: Record<string, ClientJsonValue>
  }): Promise<void>
  onInvoke(input: Omit<AiGatewayInvokeInput, 'signal' | 'caller'>): Promise<AiGatewayInvokeResult>
  onRefresh(): Promise<void>
  t: Translator
}

type FieldDraft = Record<string, string | boolean>

export function AiCapabilityLab(props: AiCapabilityLabProps) {
  const [providerId, setProviderId] = useState('')
  const [capabilityId, setCapabilityId] = useState('')
  const [providerProfileId, setProviderProfileId] = useState('')
  const [profileId, setProfileId] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string>()
  const provider = props.providers.find(item => item.id === providerId) ?? props.providers[0]
  const capability = provider?.capabilities.find(item => item.id === capabilityId) ?? provider?.capabilities[0]
  const accounts = provider ? props.providerAccounts.filter(account => account.providerExtensionId === provider.id) : []
  const profiles = provider && capability
    ? props.profiles.filter(profile => (
        profile.providerExtensionId === provider.id
        && profile.capabilityId === capability.id
        && accounts.some(account => account.id === profile.providerProfileId)
      ))
    : []

  useEffect(() => {
    if (!provider) return
    if (provider.id !== providerId) setProviderId(provider.id)
    if (!provider.capabilities.some(item => item.id === capabilityId)) {
      setCapabilityId(provider.capabilities[0]?.id ?? '')
    }
  }, [capabilityId, provider, providerId])

  useEffect(() => {
    if (!accounts.some(account => account.id === providerProfileId)) setProviderProfileId(accounts[0]?.id ?? '')
  }, [accounts, providerProfileId])

  useEffect(() => {
    if (!profiles.some(profile => profile.id === profileId)) setProfileId(profiles[0]?.id ?? '')
  }, [profileId, profiles])

  if (!provider || !capability) return <p className={styles.empty}>{props.t('provider.aiLabEmpty')}</p>

  return (
    <section className={styles.aiLab}>
      <header className={styles.sectionHeader}>
        <h2>{props.t('provider.aiLabTitle')}</h2>
        <div className={styles.aiLabHeaderMeta}>
          <span>{props.providers.length}</span>
          <button
            disabled={refreshing}
            type="button"
            onClick={() => {
              setRefreshing(true)
              setRefreshError(undefined)
              void props.onRefresh()
                .catch(error => setRefreshError(error instanceof Error ? error.message : String(error)))
                .finally(() => setRefreshing(false))
            }}
          >
            {refreshing ? props.t('provider.aiLabRefreshing') : props.t('provider.aiLabRefresh')}
          </button>
        </div>
      </header>
      {refreshError ? <p className={styles.aiLabError}>{refreshError}</p> : null}
      <div className={styles.aiLabSelectors}>
        <SelectField
          label={props.t('provider.aiLabProvider')}
          value={provider.id}
          options={props.providers.map(item => ({ value: item.id, label: item.displayName }))}
          onChange={setProviderId}
        />
        <SelectField
          label={props.t('provider.aiLabCapability')}
          value={capability.id}
          options={provider.capabilities.map(item => ({ value: item.id, label: item.displayName }))}
          onChange={setCapabilityId}
        />
      </div>
      <small className={styles.extensionId}>{provider.id} / {capability.id}</small>
      {capability.description ? <p className={styles.aiLabDescription}>{capability.description}</p> : null}

      <CreateAccountForm
        key={`account:${provider.id}`}
        provider={provider}
        onCreated={setProviderProfileId}
        onCreate={props.onCreateProviderAccount}
        onUpdate={props.onUpdateProviderAccount}
        t={props.t}
      />

      {accounts.length > 0 ? (
        <SelectField
          label={props.t('provider.aiLabAccount')}
          value={providerProfileId}
          options={accounts.map(account => ({ value: account.id, label: account.displayName }))}
          onChange={setProviderProfileId}
        />
      ) : <p className={styles.empty}>{props.t('provider.aiLabNoAccount')}</p>}

      {providerProfileId ? (
        <CreateAccountForm
          key={`account:update:${providerProfileId}`}
          account={accounts.find(account => account.id === providerProfileId)}
          provider={provider}
          onCreate={props.onCreateProviderAccount}
          onUpdate={props.onUpdateProviderAccount}
          t={props.t}
        />
      ) : null}

      {providerProfileId ? (
        <CreateProfileForm
          key={`profile:${provider.id}:${capability.id}:${providerProfileId}`}
          capability={capability}
          providerProfileId={providerProfileId}
          onCreated={setProfileId}
          onCreate={props.onCreateProfile}
          onUpdate={props.onUpdateProfile}
          t={props.t}
        />
      ) : null}

      {profiles.length > 0 ? (
        <SelectField
          label={props.t('provider.aiLabProfile')}
          value={profileId}
          options={profiles.map(profile => ({
            value: profile.id,
            label: `${profile.displayName}${profile.available ? '' : ` · ${props.t('provider.aiLabUnavailable')}`}`,
          }))}
          onChange={setProfileId}
        />
      ) : providerProfileId ? <p className={styles.empty}>{props.t('provider.aiLabNoProfile')}</p> : null}

      {profileId ? (
        <CreateProfileForm
          key={`profile:update:${profileId}`}
          capability={capability}
          profile={profiles.find(profile => profile.id === profileId)}
          providerProfileId={providerProfileId}
          onCreate={props.onCreateProfile}
          onUpdate={props.onUpdateProfile}
          t={props.t}
        />
      ) : null}

      {profileId ? (
        <InvocationForm
          key={`invoke:${profileId}`}
          capability={capability}
          profileId={profileId}
          onInvoke={props.onInvoke}
          t={props.t}
        />
      ) : null}
    </section>
  )
}

function CreateAccountForm(props: {
  account?: ProviderAccount
  provider: RegisteredAiGatewayProvider
  onCreate: AiCapabilityLabProps['onCreateProviderAccount']
  onUpdate: AiCapabilityLabProps['onUpdateProviderAccount']
  onCreated?(id: string): void
  t: Translator
}) {
  const [displayName, setDisplayName] = useState(props.account?.displayName ?? props.provider.displayName)
  const [account, setAccount] = useState(() => createDraft(props.provider.accountFields ?? [], props.account?.config))
  const [credential, setCredential] = useState(() => createDraft(props.provider.credentialFields ?? []))
  const [rawAccount, setRawAccount] = useState(() => JSON.stringify(props.account?.config ?? {}, null, 2))
  const [rawCredential, setRawCredential] = useState('{}')
  const [error, setError] = useState<string>()
  const [creating, setCreating] = useState(false)
  const credentialRequired = (props.provider.credentialFields ?? []).some(field => field.required)
    || (Array.isArray(props.provider.credentialSchema?.required) && props.provider.credentialSchema.required.length > 0)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setCreating(true)
    setError(undefined)
    try {
      const credentialValue = readCredentialValue(props.provider.credentialFields ?? [], credential, rawCredential)
      const values = {
        displayName: displayName.trim(),
        config: readObjectValue(props.provider.accountFields ?? [], account, rawAccount),
        ...(Object.keys(credentialValue).length > 0 ? { credential: credentialValue } : {}),
      }
      if (props.account) {
        await props.onUpdate({ providerProfileId: props.account.id, ...values })
        setCredential(createDraft(props.provider.credentialFields ?? []))
        setRawCredential('{}')
      } else {
        const id = await props.onCreate({ providerExtensionId: props.provider.id, ...values })
        if (id) {
          setCredential(createDraft(props.provider.credentialFields ?? []))
          setRawCredential('{}')
          props.onCreated?.(id)
        }
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError))
    } finally {
      setCreating(false)
    }
  }

  return (
    <details className={styles.createAccount}>
      <summary>{props.t(props.account ? 'provider.aiLabConfigureAccount' : 'provider.aiLabCreateAccount')}</summary>
      <form className={styles.aiLabForm} onSubmit={submit}>
        <label>
          <span>{props.t('provider.name')}</span>
          <input required value={displayName} onChange={event => setDisplayName(event.target.value)} />
        </label>
        <ConfigEditor
          fields={props.provider.accountFields ?? []}
          schema={props.provider.accountSchema}
          label={props.t('provider.aiLabAccountConfig')}
          values={account}
          raw={rawAccount}
          onChange={setAccount}
          onRawChange={setRawAccount}
        />
        <ConfigEditor
          fields={props.provider.credentialFields ?? []}
          schema={props.provider.credentialSchema}
          label={props.t('provider.aiLabCredential')}
          values={credential}
          raw={rawCredential}
          onChange={setCredential}
          onRawChange={setRawCredential}
          optional={!credentialRequired || props.account?.credential.configured === true}
        />
        <button disabled={creating} type="submit">
          {props.t(props.account ? 'provider.aiLabSave' : 'provider.aiLabCreateAccount')}
        </button>
        {error ? <p className={styles.aiLabError}>{error}</p> : null}
      </form>
    </details>
  )
}

function CreateProfileForm(props: {
  capability: AiGatewayCapabilityDefinition
  profile?: AiCapabilityProfile
  providerProfileId: string
  onCreate: AiCapabilityLabProps['onCreateProfile']
  onUpdate: AiCapabilityLabProps['onUpdateProfile']
  onCreated?(id: string): void
  t: Translator
}) {
  const [displayName, setDisplayName] = useState(props.profile?.displayName ?? props.capability.displayName)
  const [config, setConfig] = useState(() => createDraft(props.capability.profileFields ?? [], props.profile?.config))
  const [rawConfig, setRawConfig] = useState(() => JSON.stringify(props.profile?.config ?? {}, null, 2))
  const [error, setError] = useState<string>()
  const [creating, setCreating] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setCreating(true)
    setError(undefined)
    try {
      const values = {
        displayName: displayName.trim(),
        config: readObjectValue(props.capability.profileFields ?? [], config, rawConfig),
      }
      if (props.profile) {
        await props.onUpdate({ profileId: props.profile.id, ...values })
      } else {
        const id = await props.onCreate({
          providerProfileId: props.providerProfileId,
          capabilityId: props.capability.id,
          ...values,
        })
        if (id) props.onCreated?.(id)
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError))
    } finally {
      setCreating(false)
    }
  }

  return (
    <details className={styles.createAccount}>
      <summary>{props.t(props.profile ? 'provider.aiLabConfigureProfile' : 'provider.aiLabCreateProfile')}</summary>
      <form className={styles.aiLabForm} onSubmit={submit}>
        <label>
          <span>{props.t('provider.name')}</span>
          <input required value={displayName} onChange={event => setDisplayName(event.target.value)} />
        </label>
        <ConfigEditor
          fields={props.capability.profileFields ?? []}
          schema={props.capability.profileSchema}
          label={props.t('provider.aiLabProfileConfig')}
          values={config}
          raw={rawConfig}
          onChange={setConfig}
          onRawChange={setRawConfig}
        />
        <button disabled={creating} type="submit">
          {props.t(props.profile ? 'provider.aiLabSave' : 'provider.aiLabCreateProfile')}
        </button>
        {error ? <p className={styles.aiLabError}>{error}</p> : null}
      </form>
    </details>
  )
}

function InvocationForm(props: {
  capability: AiGatewayCapabilityDefinition
  profileId: string
  onInvoke: AiCapabilityLabProps['onInvoke']
  t: Translator
}) {
  const [input, setInput] = useState(() => createDraft(props.capability.inputFields ?? []))
  const [rawInput, setRawInput] = useState('{}')
  const [output, setOutput] = useState<AiGatewayInvokeResult>()
  const [error, setError] = useState<string>()
  const [running, setRunning] = useState(false)

  async function invoke(event: FormEvent) {
    event.preventDefault()
    setRunning(true)
    setError(undefined)
    try {
      setOutput(await props.onInvoke({
        profileId: props.profileId,
        input: readObjectValue(props.capability.inputFields ?? [], input, rawInput),
      }))
    } catch (invokeError) {
      setOutput(undefined)
      setError(invokeError instanceof Error ? invokeError.message : String(invokeError))
    } finally {
      setRunning(false)
    }
  }

  return (
    <form className={styles.aiLabForm} onSubmit={invoke}>
      <ConfigEditor
        fields={props.capability.inputFields ?? []}
        schema={props.capability.inputSchema}
        label={props.t('provider.aiLabInput')}
        values={input}
        raw={rawInput}
        onChange={setInput}
        onRawChange={setRawInput}
      />
      <button disabled={running} type="submit">
        {running ? props.t('provider.aiLabRunning') : props.t('provider.aiLabRun')}
      </button>
      {error ? <p className={styles.aiLabError}>{error}</p> : null}
      {output ? <pre className={styles.aiLabOutput}>{JSON.stringify(output, null, 2)}</pre> : null}
    </form>
  )
}

function SelectField(props: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange(value: string): void
}) {
  return (
    <label>
      <span>{props.label}</span>
      <select value={props.value} onChange={event => props.onChange(event.target.value)}>
        {props.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

function ConfigEditor(props: {
  fields: AiGatewayFieldDefinition[]
  schema?: Record<string, ClientJsonValue>
  label: string
  values: FieldDraft
  raw: string
  onChange(value: FieldDraft): void
  onRawChange(value: string): void
  optional?: boolean
}) {
  if (props.fields.length > 0) {
    return (
      <FieldGroup
        fields={props.fields}
        legend={props.label}
        optional={props.optional}
        values={props.values}
        onChange={props.onChange}
      />
    )
  }
  if (props.optional && !props.schema) return null
  return (
    <label className={styles.aiLabRawJson}>
      <span>{props.label}</span>
      <textarea required={!props.optional} value={props.raw} onChange={event => props.onRawChange(event.target.value)} />
      {props.schema ? <small>{JSON.stringify(props.schema)}</small> : null}
    </label>
  )
}

function FieldGroup(props: {
  fields: AiGatewayFieldDefinition[]
  legend: string
  values: FieldDraft
  optional?: boolean
  onChange(value: FieldDraft): void
}) {
  return (
    <fieldset className={styles.aiLabFields}>
      <legend>{props.legend}</legend>
      {props.fields.map(field => (
        <label key={field.key}>
          <span>{field.label}</span>
          <FieldInput
            field={field}
            optional={props.optional}
            value={props.values[field.key] ?? (field.type === 'boolean' ? false : '')}
            onChange={value => props.onChange({ ...props.values, [field.key]: value })}
          />
          {field.description ? <small>{field.description}</small> : null}
        </label>
      ))}
    </fieldset>
  )
}

function FieldInput(props: {
  field: AiGatewayFieldDefinition
  optional?: boolean
  value: string | boolean
  onChange(value: string | boolean): void
}) {
  const { field } = props
  if (field.type === 'boolean') {
    return <input checked={props.value === true} type="checkbox" onChange={event => props.onChange(event.target.checked)} />
  }
  if (field.type === 'select') {
    return (
      <select required={field.required && !props.optional} value={String(props.value)} onChange={event => props.onChange(event.target.value)}>
        {field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    )
  }
  if (field.type === 'json') {
    return <textarea required={field.required && !props.optional} value={String(props.value)} onChange={event => props.onChange(event.target.value)} />
  }
  return (
    <input
      autoComplete={field.type === 'secret' ? 'new-password' : 'off'}
      name={`loom-ai-field-${field.key}`}
      required={field.required && !props.optional}
      type={field.type === 'number' ? 'number' : field.type === 'secret' ? 'password' : 'text'}
      value={String(props.value)}
      onChange={event => props.onChange(event.target.value)}
    />
  )
}

function createDraft(
  fields: AiGatewayFieldDefinition[],
  source?: Record<string, ClientJsonValue>,
): FieldDraft {
  return Object.fromEntries(fields.map(field => [field.key, source?.[field.key] === undefined
    ? draftValue(field)
    : field.type === 'boolean'
      ? source[field.key] === true
      : field.type === 'json'
        ? JSON.stringify(source[field.key], null, 2)
        : String(source[field.key])]))
}

function draftValue(field: AiGatewayFieldDefinition): string | boolean {
  if (field.defaultValue === undefined) return field.type === 'boolean' ? false : ''
  if (field.type === 'boolean') return field.defaultValue === true
  if (field.type === 'json') return JSON.stringify(field.defaultValue, null, 2)
  return String(field.defaultValue)
}

function readDraft(fields: AiGatewayFieldDefinition[], draft: FieldDraft): Record<string, ClientJsonValue> {
  const result: Record<string, ClientJsonValue> = {}
  for (const field of fields) {
    const value = draft[field.key]
    if (field.type !== 'boolean' && value === '') continue
    if (field.type === 'boolean') result[field.key] = value === true
    else if (field.type === 'number') result[field.key] = Number(value)
    else if (field.type === 'json') result[field.key] = JSON.parse(String(value)) as ClientJsonValue
    else result[field.key] = String(value)
  }
  return result
}

function readObjectValue(
  fields: AiGatewayFieldDefinition[],
  draft: FieldDraft,
  raw: string,
): Record<string, ClientJsonValue> {
  if (fields.length > 0) return readDraft(fields, draft)
  const value = JSON.parse(raw) as ClientJsonValue
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object')
  return value as Record<string, ClientJsonValue>
}

function readCredentialValue(
  fields: AiGatewayFieldDefinition[],
  draft: FieldDraft,
  raw: string,
): Record<string, string> {
  const value = fields.length > 0 ? readDraft(fields, draft) : readObjectValue(fields, draft, raw)
  const entries = Object.entries(value)
  if (entries.some(([, item]) => typeof item !== 'string')) throw new Error('Credential values must be strings')
  return Object.fromEntries(entries) as Record<string, string>
}
