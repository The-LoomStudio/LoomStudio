import { Server } from 'lucide-react'
import type { ReactNode } from 'react'
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
import zhipu from '@lobehub/icons-static-svg/icons/zhipu-color.svg'
import moonshot from '@lobehub/icons-static-svg/icons/moonshot.svg'
import siliconcloud from '@lobehub/icons-static-svg/icons/siliconcloud-color.svg'
import minimax from '@lobehub/icons-static-svg/icons/minimax-color.svg'
import doubao from '@lobehub/icons-static-svg/icons/doubao-color.svg'
import stepfun from '@lobehub/icons-static-svg/icons/stepfun-color.svg'
import type { ModelBrand } from '../../features/provider-settings/model/model-brand.js'
import styles from './model-panel.module.scss'

const icons: Record<ModelBrand, string> = {
  anthropic,
  deepseek,
  gemini,
  grok,
  meta,
  mistral,
  ollama,
  openai,
  openrouter,
  qwen,
  zhipu,
  moonshot,
  siliconcloud,
  minimax,
  doubao,
  stepfun,
}

export function ModelBrandIcon({
  brand,
  className,
  fallback,
}: {
  brand: ModelBrand | null
  className?: string
  fallback?: ReactNode
}) {
  if (brand && icons[brand]) {
    return <img alt="" aria-hidden="true" className={className ?? styles.brandIcon} src={icons[brand]} />
  }
  return fallback ?? <Server aria-hidden="true" className={className ?? styles.brandIconFallback} />
}
