import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog, IconButton } from '@loom-studio/ui'
import { Download, PackagePlus, RefreshCw, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { notify } from '../../../shared/notifications/index.js'
import type { OfficialContentPackage } from '../../../entities/official-content.js'
import { subscribeDataCommits } from '../../../shared/api/data-commit-events.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import { downloadBase64 } from '../../../shared/browser/download.js'
import { confirm } from '../../../shared/ui/confirm-dialog/index.js'
import type { Translator } from '../../../shared/i18n/index.js'
import styles from './official-content-dialog.module.scss'

const EMPTY_PACKAGES: OfficialContentPackage[] = []
const apiScopeIds = new WeakMap<StudioApi['officialContent'], number>()
let nextApiScopeId = 1

function getApiScopeId(api: StudioApi['officialContent']): number {
  let id = apiScopeIds.get(api)
  if (id === undefined) {
    id = nextApiScopeId++
    apiScopeIds.set(api, id)
  }
  return id
}

function readError(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

export function OfficialContentDialog(props: {
  api: StudioApi['officialContent']
  onInstalled(): Promise<void>
  onClose(): void
  t: Translator
}) {
  const queryClient = useQueryClient()
  const apiScope = getApiScopeId(props.api)
  const queryKey = useMemo(() => ['official-content', apiScope, 'list'] as const, [apiScope])
  const listQuery = useQuery({
    queryKey,
    queryFn: () => props.api.list(),
  })
  const [operating, setOperating] = useState(false)
  const [actionError, setActionError] = useState<string>()
  const active = useRef(false)
  const pending = useRef(false)

  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  useEffect(() => {
    return subscribeDataCommits(
      operations => {
        const hasRelevantChange = operations.some(op =>
          op.entityType === 'extension.official-setup'
          || op.entityType === 'prompt-resource'
          || op.entityType.startsWith('airp.'),
        )
        if (!hasRelevantChange) return
        void queryClient.invalidateQueries({ exact: true, queryKey })
      },
      () => {
        void queryClient.invalidateQueries({ exact: true, queryKey })
      },
    )
  }, [queryClient, queryKey])

  const packages = listQuery.data?.packages ?? EMPTY_PACKAGES
  const busy = operating || listQuery.isPending
  const error = actionError ?? (listQuery.error ? readError(listQuery.error) : undefined)

  async function run(operation: () => Promise<void>) {
    if (pending.current || listQuery.isPending) return
    pending.current = true
    setOperating(true)
    setActionError(undefined)
    try {
      await operation()
    } catch (caught) {
      const message = readError(caught)
      if (active.current) setActionError(message)
      notify.failure(props.t('official.operationFailed'), message)
    } finally {
      pending.current = false
      if (active.current) setOperating(false)
    }
  }

  async function reload() {
    const result = await listQuery.refetch()
    if (result.error) throw result.error
  }

  async function install(content: OfficialContentPackage) {
    if (pending.current || listQuery.isPending || !await confirm({ title: props.t('official.installTitle'), message: props.t('official.installConfirm') })) return
    void run(async () => {
      const result = await props.api.install({ packageId: content.id, digest: content.digest })
      if (!active.current) return
      await queryClient.invalidateQueries({ exact: true, queryKey })
      if (!active.current) return
      await props.onInstalled()
      if (active.current) notify.success(props.t(result.resources.some(resource => resource.created) ? 'official.installed' : 'official.unchanged'))
    })
  }

  function exportContent(content: OfficialContentPackage) {
    void run(async () => {
      const result = await props.api.export({ packageId: content.id, digest: content.digest })
      if (active.current) {
        downloadBase64(result.base64, result.fileName, 'application/zip')
        notify.success(props.t('notify.success.exported'))
      }
    })
  }

  return (
    <Dialog open title={props.t('official.builtin')} onClose={props.onClose}
      showCloseButton={false} headerActions={<IconButton aria-label={props.t('character.cancel')} title={props.t('character.cancel')} onClick={props.onClose}><X aria-hidden="true" /></IconButton>}>
      <div className={styles.content} aria-busy={busy}>
        <div className={styles.toolbar}>
          <button aria-label={props.t('official.refresh')} title={props.t('official.refresh')} disabled={busy} type="button" onClick={() => void run(reload)}>
            <RefreshCw aria-hidden="true" size={16} />
          </button>
        </div>
        {error ? <p role="alert">{error}</p> : null}
        {packages.length === 0 ? <p role="status">{props.t(busy ? 'official.loading' : 'official.empty')}</p> : null}
        {packages.map(content => {
          const complete = content.resources.every(resource => resource.available)
          return (
            <article key={content.id} className={styles.package}>
              <header>
                <div><h3>{content.name}</h3><small>{content.id}</small></div>
                <div className={styles.actions}>
                  <button aria-label={props.t('official.export')} title={props.t('official.export')} disabled={busy} type="button" onClick={() => exportContent(content)}>
                    <Download aria-hidden="true" size={16} />
                  </button>
                  <button disabled={busy || complete} type="button" onClick={() => install(content)}>
                    <PackagePlus aria-hidden="true" size={16} /><span>{props.t(complete ? 'official.available' : 'official.install')}</span>
                  </button>
                </div>
              </header>
              <dl>
                {content.resources.map(resource => (
                  <div key={resource.id}>
                    <dt>{resource.name}</dt>
                    <dd>{resource.resourceKind} · {props.t(resource.available ? 'official.available' : 'official.notInstalled')}</dd>
                  </div>
                ))}
              </dl>
            </article>
          )
        })}
      </div>
    </Dialog>
  )
}
