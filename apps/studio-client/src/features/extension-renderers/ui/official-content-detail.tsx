import { Download, PackagePlus, UserPlus } from 'lucide-react'
import { useState } from 'react'
import type { ModelProfile, ProviderModelSelection } from '../../../entities/index.js'
import type { OfficialContentPackage } from '../../../entities/official-content.js'
import type { Translator } from '../../../shared/i18n/index.js'
import styles from './renderer-workspace-panel.module.scss'

export function OfficialContentDetail(props: {
  content: OfficialContentPackage
  models: ModelProfile[]
  busy: boolean
  t: Translator
  onInstall(): void
  onExport(): void
  onCreateAgent(input: { name: string; presetId: string; model: ProviderModelSelection }): void
}) {
  const [modelId, setModelId] = useState('')
  const model = props.models.find(item => item.id === modelId)
  const complete = props.content.resources.every(resource => resource.available)
  return (
    <article className={styles.resourceDetail} data-loom-component="official-content-detail">
      <header>
        <div><h3>{props.content.name}</h3><small>{props.content.id} · {props.content.version}</small></div>
        <div className={styles.actions}>
          <button type="button" disabled={props.busy} title={props.t('official.export')} onClick={props.onExport}><Download aria-hidden="true" /></button>
          <button type="button" disabled={props.busy || complete} onClick={props.onInstall}>
            <PackagePlus aria-hidden="true" /><span>{props.t(complete ? 'official.available' : 'official.install')}</span>
          </button>
        </div>
      </header>
      <dl className={styles.detailFacts}>
        {props.content.resources.map(resource => (
          <div key={resource.id}><dt>{resource.resourceKind}</dt><dd>{resource.name} · {props.t(resource.available ? 'official.available' : 'official.notInstalled')}</dd></div>
        ))}
      </dl>
      {props.content.agents.length > 0 ? (
        <section className={styles.officialAgents}>
          <h4>{props.t('official.agentTemplates')}</h4>
          <label className="loom-underlined-fields">
            <span>{props.t('agent.profile.model')}</span>
            <select value={modelId} disabled={props.busy} onChange={event => setModelId(event.target.value)}>
              <option value="">{props.t('agent.profile.selectModel')}</option>
              {props.models.map(item => <option key={item.id} value={item.id}>{item.providerModelId}</option>)}
            </select>
          </label>
          {props.content.agents.map(agent => (
            <div className={styles.officialAgent} key={agent.id}>
              <span>{agent.name}</span>
              <div className={styles.actions}>
                <button
                  type="button"
                  disabled={props.busy || !model || !props.content.resources.some(resource => resource.id === agent.presetId && resource.available)}
                  onClick={() => {
                    if (model) props.onCreateAgent({ name: agent.name, presetId: agent.presetId, model: { providerProfileId: model.providerAccountId, modelId: model.providerModelId } })
                  }}
                ><UserPlus aria-hidden="true" /><span>{props.t('official.createAgent')}</span></button>
              </div>
            </div>
          ))}
        </section>
      ) : null}
    </article>
  )
}
