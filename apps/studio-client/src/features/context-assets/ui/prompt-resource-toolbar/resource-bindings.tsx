import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PromptResource } from '../../../../entities/index.js'
import type { StudioApi } from '../../../../shared/api/studio-api.js'
import type { Translator } from '../../../../shared/i18n/index.js'
import styles from './prompt-resource-toolbar.module.scss'

export type ResourceBindingsSource = {
  api: Pick<StudioApi['promptResources'], 'getBindings'>
  endpoint: string
}

export function ResourceBindings(props: ResourceBindingsSource & {
  resourceId: string
  resources: PromptResource[]
  t: Translator
}) {
  const [open, setOpen] = useState(false)
  const query = useQuery({
    queryKey: ['prompt-resources', props.endpoint, 'bindings', props.resourceId],
    queryFn: () => props.api.getBindings(props.resourceId),
    enabled: open,
  })
  return (
    <details className={styles.bindings} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>{props.t('promptResource.bindings')}</summary>
      {open ? query.isFetching ? <p role="status">{props.t('promptResource.bindingsLoading')}</p>
        : query.error ? <p role="alert">{query.error.message}</p>
          : query.data ? (
            <ul>
              {query.data.cards.map(card => (
                <li key={`card:${card.id}`}>{props.t('promptResource.bindingCard', { name: card.name })}</li>
              ))}
              {query.data.settingMounts.map(mount => (
                <li key={mount.id}>
                  {mount.source.kind === 'manual'
                    ? props.t('promptResource.bindingGlobal')
                    : props.t('promptResource.bindingPreset', {
                      name: props.resources.find(resource => resource.id === mount.source.id)?.rootNode.label ?? mount.source.id,
                    })}
                </li>
              ))}
              {!query.data.cards.length && !query.data.settingMounts.length
                ? <li>{props.t('promptResource.bindingsEmpty')}</li> : null}
            </ul>
          ) : null : null}
    </details>
  )
}
