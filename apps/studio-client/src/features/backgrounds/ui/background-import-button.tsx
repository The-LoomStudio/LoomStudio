import { useRef } from 'react'
import { Button } from '@loom-studio/ui'
import { ImagePlus } from 'lucide-react'
import type { Translator } from '../../../shared/i18n/index.js'

export function BackgroundImportButton(props: { t: Translator; disabled?: boolean; onImport(files: File[]): void }) {
  const input = useRef<HTMLInputElement>(null)
  return <>
    <Button disabled={props.disabled} onClick={() => input.current?.click()}><ImagePlus aria-hidden="true" size={15} />{props.t('appearance.importBackground')}</Button>
    <input ref={input} hidden type="file" multiple accept="image/png,image/apng,image/jpeg,image/webp,image/gif,image/avif" onChange={event => {
      const files = Array.from(event.currentTarget.files ?? [])
      event.currentTarget.value = ''
      if (files.length) props.onImport(files)
    }} />
  </>
}
