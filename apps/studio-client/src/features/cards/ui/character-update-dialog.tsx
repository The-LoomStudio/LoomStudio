import { useEffect, useRef, useState } from 'react'
import { Button, Dialog } from '@loom-studio/ui'
import { ArrowUpCircle, Download, Loader2, SquareArrowRightEnter } from 'lucide-react'
import type { CharacterCardSummary } from '../model/character-card-summary.js'
import type { ResourceDownloadsClient } from '../../../shared/api/resource-downloads-client.js'
import type { ResourceDownloadTask } from '../../../../../studio-server/src/resource-downloads/types.js'
import { t as defaultT, type Translator } from '../../../shared/i18n/index.js'
import styles from './character-update-dialog.module.scss'

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.includes(',') ? result.split(',')[1] : result
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function CharacterUpdateDialog(props: {
  open: boolean
  card: CharacterCardSummary
  downloadsApi: ResourceDownloadsClient
  t?: Translator
  onClose(): void
  onSelectTask(taskId: string): void
}) {
  const t = props.t ?? defaultT
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tasks, setTasks] = useState<ResourceDownloadTask[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!props.open) return
    setError('')
    void props.downloadsApi.list().then(list => {
      setTasks(list.filter(item => item.kind === 'card' && item.status === 'ready'))
    }).catch(() => undefined)
  }, [props.open, props.downloadsApi])

  if (!props.open) return null

  async function handleFile(file: File) {
    setBusy(true)
    setError('')
    try {
      const base64 = await fileToBase64(file)
      const task = await props.downloadsApi.stageUpload({
        fileName: file.name,
        base64,
        kind: 'card',
      })
      props.onSelectTask(task.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function handleRemoteResolve() {
    if (!url.trim()) return
    setBusy(true)
    setError('')
    try {
      const result = await props.downloadsApi.resolve({ url: url.trim(), kind: 'card' })
      const candidate = result.candidates.find(item => item.recommended) ?? result.candidates[0]
      if (!candidate) {
        throw new Error(t('character.update.noCandidate'))
      }
      const task = await props.downloadsApi.start({ candidateId: candidate.id })
      let currentTask = task
      while (currentTask.status === 'downloading' || currentTask.status === 'queued') {
        await new Promise(r => setTimeout(r, 1000))
        const list = await props.downloadsApi.list()
        const found = list.find(item => item.id === task.id)
        if (found) currentTask = found
        if (found?.status === 'failed' || found?.status === 'cancelled') {
          throw new Error(found.error || t('character.update.downloadFailed'))
        }
      }
      if (currentTask.status === 'ready') {
        props.onSelectTask(currentTask.id)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      title={t('character.update.title', { name: props.card.name })}
      dismissible={!busy}
      onClose={props.onClose}
      actions={
        <Button variant="ghost" disabled={busy} onClick={props.onClose}>
          {t('character.cancel')}
        </Button>
      }
    >
      <div className={styles.updateDialog}>
        {error ? <div className={styles.errorNotice} role="alert">{error}</div> : null}

        <section className={styles.section}>
          <h4>{t('character.update.localSection')}</h4>
          <p>{t('character.update.localDesc')}</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.loomcard,.zip"
            className={styles.fileInput}
            onChange={event => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void handleFile(file)
            }}
          />
          <div
            className={styles.dropArea}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={event => event.preventDefault()}
            onDrop={event => {
              event.preventDefault()
              const file = event.dataTransfer.files?.[0]
              if (file) void handleFile(file)
            }}
          >
            {busy ? <Loader2 className="animate-spin" size={24} /> : <SquareArrowRightEnter size={24} />}
            <span>{t('character.update.dropPrompt')}</span>
            <small>{t('character.update.dropHint')}</small>
          </div>
        </section>

        <section className={styles.section}>
          <h4>{t('character.update.remoteSection')}</h4>
          <p>{t('character.update.remoteDesc')}</p>
          <div className={styles.remoteForm}>
            <input
              type="url"
              placeholder="https://..."
              value={url}
              disabled={busy}
              onChange={event => setUrl(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleRemoteResolve()
                }
              }}
            />
            <Button disabled={busy || !url.trim()} onClick={() => void handleRemoteResolve()}>
              {busy ? <Loader2 className="animate-spin" size={14} /> : <Download size={14} />}
              <span>{t('character.update.fetchAndDetect')}</span>
            </Button>
          </div>
        </section>

        {tasks.length > 0 ? (
          <section className={styles.section}>
            <h4>{t('character.update.stagedSection')}</h4>
            <div className={styles.existingTasks}>
              {tasks.map(task => (
                <button
                  key={task.id}
                  type="button"
                  className={styles.taskItem}
                  disabled={busy}
                  onClick={() => props.onSelectTask(task.id)}
                >
                  <div>
                    <strong>{task.name}</strong>
                    <small>{task.version ?? t('character.update.versionUndeclared')}</small>
                  </div>
                  <ArrowUpCircle size={16} />
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </Dialog>
  )
}
