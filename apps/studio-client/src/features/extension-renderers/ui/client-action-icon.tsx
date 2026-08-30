import type { ClientHostIconName } from '@loom-studio/extension-sdk'
import { Image, RefreshCw, Settings, Sparkles } from 'lucide-react'

export function ClientActionIcon(props: { name?: ClientHostIconName }) {
  if (props.name === 'image') return <Image aria-hidden="true" />
  if (props.name === 'refresh') return <RefreshCw aria-hidden="true" />
  if (props.name === 'settings') return <Settings aria-hidden="true" />
  if (props.name === 'sparkles') return <Sparkles aria-hidden="true" />
  return null
}
