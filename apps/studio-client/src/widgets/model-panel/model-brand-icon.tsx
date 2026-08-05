import { Bot } from 'lucide-react'
import anthropic from '@lobehub/icons-static-svg/icons/anthropic.svg'
import deepseek from '@lobehub/icons-static-svg/icons/deepseek-color.svg'
import gemini from '@lobehub/icons-static-svg/icons/gemini-color.svg'
import grok from '@lobehub/icons-static-svg/icons/grok.svg'
import meta from '@lobehub/icons-static-svg/icons/meta-color.svg'
import mistral from '@lobehub/icons-static-svg/icons/mistral-color.svg'
import ollama from '@lobehub/icons-static-svg/icons/ollama.svg'
import openai from '@lobehub/icons-static-svg/icons/openai.svg'
import openrouter from '@lobehub/icons-static-svg/icons/openrouter-color.svg'
import qwen from '@lobehub/icons-static-svg/icons/qwen-color.svg'
import type { ModelBrand } from '../../features/provider-settings/model/model-brand.js'
import styles from './model-panel.module.scss'

const icons: Record<ModelBrand, string> = { anthropic, deepseek, gemini, grok, meta, mistral, ollama, openai, openrouter, qwen }

export function ModelBrandIcon({ brand }: { brand: ModelBrand | null }) {
  return brand
    ? <img alt="" aria-hidden="true" className={styles.brandIcon} src={icons[brand]} />
    : <Bot aria-hidden="true" className={styles.brandIconFallback} />
}
