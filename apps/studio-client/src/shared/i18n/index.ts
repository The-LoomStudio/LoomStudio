import { enUS } from './en-us.js'
import { zhCN } from './zh-cn.js'

type MessageKey = keyof typeof zhCN
type Messages = Record<MessageKey, string>
export type Locale = 'zh-CN' | 'en-US'
export type Translator = (key: MessageKey, params?: Record<string, string | number>) => string

const resources = {
  'zh-CN': zhCN,
  'en-US': enUS,
} satisfies Record<Locale, Messages>

export const localeLabels: Record<Locale, string> = {
  'zh-CN': '中文',
  'en-US': 'English',
}

export const supportedLocales = Object.keys(resources) as Locale[]

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  return createTranslator('zh-CN')(key, params)
}

export function createTranslator(locale: Locale): Translator {
  return (key, params) => {
    const template = resources[locale][key] ?? resources['zh-CN'][key]
    if (!params) return template

    let result: string = template
    for (const [name, value] of Object.entries(params)) {
      result = result.replaceAll(`{{${name}}}`, String(value))
    }
    return result
  }
}
