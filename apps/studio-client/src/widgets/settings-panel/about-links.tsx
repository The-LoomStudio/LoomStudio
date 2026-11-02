import { useQuery } from '@tanstack/react-query'
import { BookOpen, Download, Code2, Globe, Blocks } from 'lucide-react'
import { useState } from 'react'
import type { Locale, Translator } from '../../shared/i18n/index.js'
import styles from './about-links.module.scss'

const website = 'https://loomstudio.pages.dev'
const entries = [
  { id: 'website', path: '/', icon: Globe },
  { id: 'docs', path: '/docs', icon: BookOpen },
  { id: 'download', path: '/download', icon: Download },
  { id: 'marketplace', path: '/marketplace', icon: Blocks },
  { id: 'github', path: '', icon: Code2 },
] as const

async function readOgImage(url: string, signal: AbortSignal): Promise<string | null> {
  const response = await fetch(url, { signal, credentials: 'omit' })
  if (!response.ok) throw new Error(`Website preview: ${response.status}`)
  const document = new DOMParser().parseFromString(await response.text(), 'text/html')
  const content = document.querySelector('meta[property="og:image"]')?.getAttribute('content')
  if (!content) return null
  const image = new URL(content, response.url)
  return image.protocol === 'https:' ? image.href : null
}

function LinkCard({ entry, locale, t }: { entry: typeof entries[number]; locale: Locale; t: Translator }) {
  const github = entry.id === 'github'
  const prefix = locale === 'zh-CN' ? '' : `/${locale === 'en-US' ? 'en' : locale === 'ja-JP' ? 'ja' : 'ko'}`
  const href = github ? 'https://github.com/The-LoomStudio/LoomStudio' : `${website}${prefix}${entry.path}`
  const query = useQuery({
    queryKey: ['about-og-image', href],
    queryFn: ({ signal }) => readOgImage(href, signal),
    enabled: !github,
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const image = github ? 'https://opengraph.githubassets.com/1/The-LoomStudio/LoomStudio' : query.data
  const [failedImage, setFailedImage] = useState<string>()
  const Icon = entry.icon
  return <a className={styles.card} href={href} target="_blank" rel="noopener noreferrer">
    <div className={styles.preview}>
      {image && image !== failedImage ? <img src={image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedImage(image)} /> : <Icon size={36} aria-hidden="true" />}
    </div>
    <div className={styles.copy}><span><Icon size={17} aria-hidden="true" /><strong>{t(`settings.links.${entry.id}`)}</strong></span><p>{t(`settings.links.${entry.id}Description`)}</p></div>
  </a>
}

export function AboutLinks(props: { locale: Locale; t: Translator }) {
  return <div className={styles.grid}>{entries.map(entry => <LinkCard key={entry.id} entry={entry} {...props} />)}</div>
}
