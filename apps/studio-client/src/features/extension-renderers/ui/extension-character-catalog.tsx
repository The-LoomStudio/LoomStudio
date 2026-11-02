import { useEffect, useState } from 'react'
import { Button, Dialog } from '@loom-studio/ui'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import styles from './extension-character-catalog.module.scss'

type Api = StudioApi['extensions']
type Character = Awaited<ReturnType<Api['listCharacters']>>['characters'][number]
type Preview = Awaited<ReturnType<Api['previewCharacter']>>

export function ExtensionCharacterCatalog(props: {
  packageId: string; api: Api; t: Translator
  onImported(): Promise<unknown>
  onOpen(cardId: string): void
}) {
  const [characters, setCharacters] = useState<Character[]>([])
  const [preview, setPreview] = useState<Preview>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    let active = true
    void props.api.listCharacters(props.packageId).then(result => {
      if (active) setCharacters(result.characters)
    }, reason => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [props.api, props.packageId])

  async function prepare(characterId: string) {
    setBusy(true); setError(undefined)
    try { setPreview(await props.api.previewCharacter(props.packageId, characterId)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  async function importCharacter() {
    if (!preview) return
    setBusy(true); setError(undefined)
    try {
      const result = await props.api.importCharacter({ packageId: props.packageId, characterId: preview.characterId,
        digest: preview.digest, allowDuplicate: preview.importedCards.length > 0 })
      // Once committed, close confirmation before refreshing so a failed refresh cannot repeat import.
      setPreview(undefined)
      await props.onImported()
      props.onOpen(result.cardId)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  if (!characters.length && !error) return null
  return <section className={styles.catalog}>
    <h4>{props.t('renderer.characters.title')}</h4>
    {error ? <p role="alert">{error}</p> : null}
    <p>{props.t('renderer.characters.description')}</p>
    {characters.map(character => <article className={styles.character} key={character.id}>
      {character.previewUrl ? <img src={character.previewUrl} alt="" loading="lazy" /> : null}
      <div className={styles.content}>
        <strong>{character.name}</strong>
        {character.description ? <p>{character.description}</p> : null}
        <div className={styles.actions}>
          {character.importedCards.map(card => <Button key={card.id} disabled={busy} onClick={() => props.onOpen(card.id)}>{props.t('renderer.characters.open', { name: card.name })}</Button>)}
          <Button disabled={busy} onClick={() => void prepare(character.id)}>{props.t(character.importedCards.length ? 'renderer.characters.addAnother' : 'renderer.characters.add')}</Button>
        </div>
      </div>
    </article>)}
    {preview ? <Dialog open title={props.t('renderer.characters.confirmTitle')} dismissible={!busy} onClose={() => setPreview(undefined)} actions={<>
      <Button disabled={busy} onClick={() => setPreview(undefined)}>{props.t('renderer.remote.cancel')}</Button>
      <Button disabled={busy || preview.blockers.length > 0} onClick={() => void importCharacter()}>{props.t(preview.importedCards.length ? 'renderer.characters.addAnother' : 'renderer.characters.add')}</Button>
    </>}>
      <p>{preview.name}</p>
      <p>{props.t('renderer.characters.importHint')}</p>
      {preview.dependencies.length ? <><h4>{props.t('renderer.characters.dependencies')}</h4><ul>{preview.dependencies.map(dependency => <li key={dependency.id}>{dependency.id} · {dependency.version}</li>)}</ul></> : null}
      {preview.embeddedPackages.length ? <><h4>{props.t('renderer.characters.embedded')}</h4><ul>{preview.embeddedPackages.map(item => <li key={item.packageId}>{item.packageId} · {item.version}</li>)}</ul></> : null}
      {preview.blockers.map((blocker, index) => <p role="alert" key={index}>{blocker}</p>)}
      {error ? <p role="alert">{error}</p> : null}
    </Dialog> : null}
  </section>
}
