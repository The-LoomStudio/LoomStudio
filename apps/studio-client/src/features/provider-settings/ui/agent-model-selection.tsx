import { Bot, ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@loom-studio/ui'
import { AgentModelPicker } from './agent-model-picker.js'
import { ModelBrandIcon } from './model-brand-icon.js'
import { resolveModelBrand } from '../model/model-brand.js'
import type { ModelProfile, ProviderAccount, ProviderModelSelection } from '../../../entities/index.js'
import type { Translator } from '../../../shared/i18n/index.js'
import pickerStyles from './agent-model-picker.module.scss'

export function AgentModelSelection(props: {
  model?: ProviderModelSelection; pending: boolean; open: boolean; error?: string
  onOpen(): void; onClose(): void
  onSelect(model: ProviderModelSelection | undefined, enable?: boolean): Promise<void>
  modelProfiles: ModelProfile[]; providerAccounts: ProviderAccount[]; t: Translator
  onListModels(accountId: string): Promise<string[]>
}) {
  const { pending, open, error } = props
  const current = { model: props.model }
  const account = props.providerAccounts.find(provider => provider.id === current.model?.providerProfileId)
  const modelLabel = current.model
    ? `${account?.displayName ?? current.model.providerProfileId} / ${current.model.modelId}`
    : props.t('agent.model.unbound')
  const brand = current.model ? resolveModelBrand(current.model.modelId) : null

  return (
    <DropdownMenu open={open} onOpenChange={isOpen => { if (isOpen) props.onOpen(); else props.onClose() }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={props.t('agent.profile.selectModel')}
          aria-haspopup="dialog"
          disabled={pending}
          className={pickerStyles.selectionTrigger}
          onClick={props.onOpen}
        >
          {brand ? (
            <ModelBrandIcon brand={brand} className={pickerStyles.selectionIcon} fallback={<Bot size={20} />} />
          ) : (
            <Bot size={20} className={pickerStyles.selectionIcon} aria-hidden="true" />
          )}
          <span className={pickerStyles.selectionText}>{modelLabel}</span>
          <ChevronDown size={14} className={pickerStyles.selectionArrow} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="bottom"
        align="start"
        sideOffset={6}
        className={pickerStyles.popoverContent}
      >
        <AgentModelPicker
          asPopover
          open={open}
          pending={pending}
          current={current.model}
          modelProfiles={props.modelProfiles}
          providerAccounts={props.providerAccounts}
          t={props.t}
          error={error}
          onClose={props.onClose}
          onListModels={props.onListModels}
          onSelect={props.onSelect}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
