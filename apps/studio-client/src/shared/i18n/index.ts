import { zhCN } from './zh-cn.js'

type MessageKey = keyof typeof zhCN
type Messages = Record<MessageKey, string>
export type Locale = 'zh-CN' | 'en-US' | 'ja-JP' | 'ko-KR'
export type Translator = (key: MessageKey, params?: Record<string, string | number>) => string

const resources: Partial<Record<Locale, Messages>> = {
  'zh-CN': zhCN,
}

const localeLoaders = {
  'en-US': async () => (await import('./en-us.js')).enUS,
  'ja-JP': async () => (await import('./ja-jp.js')).jaJP,
  'ko-KR': async () => (await import('./ko-kr.js')).koKR,
} satisfies Record<Exclude<Locale, 'zh-CN'>, () => Promise<Messages>>

/** Load before creating a translator or committing a locale change. */
export async function loadLocale(locale: Locale): Promise<void> {
  if (locale === 'zh-CN' || resources[locale]) return
  resources[locale] = await localeLoaders[locale]()
}

export const localeLabels: Record<Locale, string> = {
  'zh-CN': '中文',
  'en-US': 'English',
  'ja-JP': '日本語',
  'ko-KR': '한국어',
}

export const supportedLocales = Object.keys(localeLabels) as Locale[]

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  return createTranslator('zh-CN')(key, params)
}

export function createTranslator(locale: Locale): Translator {
  const messages = resources[locale]
  if (!messages) throw new Error(`Locale ${locale} has not been loaded`)
  return (key, params) => {
    const template = messages[key] ?? zhCN[key]
    if (!params) return template

    let result: string = template
    for (const [name, value] of Object.entries(params)) {
      result = result.replaceAll(`{{${name}}}`, String(value))
    }
    return result
  }
}

export * from './format.js'
