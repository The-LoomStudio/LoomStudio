import { ChevronRight, type LucideIcon } from 'lucide-react'
import type { PromptResource } from '../../../../entities/index.js'
import type { Translator } from '../../../../shared/i18n/index.js'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../../shared/ui/dropdown-menu/dropdown-menu.js'
import styles from './context-asset-header.module.scss'

export type ContextAssetPathSegment = {
  id: string
  label: string
  options?: Array<{ id: string; label: string }>
  onSelect?(id: string): void
}

type ContextAssetHeaderProps = {
  breadcrumbs?: ContextAssetPathSegment[]
  Icon: LucideIcon
  title: string
  resources: PromptResource[]
  selectedResourceId?: string
  t: Translator
  onSelectResource(resourceId: string): void
}

export function ContextAssetHeader(props: ContextAssetHeaderProps) {
  const Icon = props.Icon
  const selectedResource = props.resources.find(r => r.id === props.selectedResourceId) ?? props.resources[0]

  return (
    <div className={styles.headerWrapper} data-loom-component="context-asset-header">
      <div className={styles.headerIdentity}>
        <div className={styles.headerTitle}>
          <Icon aria-hidden="true" />
          <span>{props.title}</span>
        </div>
      </div>
      <div className={styles.headerPath}>
        {props.resources.length > 0 ? (
          <>
            <ChevronRight aria-hidden="true" className={styles.pathSeparator} />
            <HeaderPathMenu
              aria-label={props.t('promptResource.select')}
              label={readResourceLabel(selectedResource, props.t)}
              options={props.resources.map(resource => ({
                id: resource.id,
                label: readResourceLabel(resource, props.t),
              }))}
              value={selectedResource?.id ?? ''}
              onSelect={props.onSelectResource}
            />
          </>
        ) : null}
        {props.breadcrumbs?.map((segment, index) => (
          <span className={styles.breadcrumb} key={`${index}-${segment.id}`}>
            <ChevronRight aria-hidden="true" className={styles.pathSeparator} />
            {segment.options && segment.options.length > 0 ? (
              <HeaderPathMenu
                aria-label={segment.label}
                label={segment.label}
                options={segment.options}
                value={segment.id}
                onSelect={id => segment.onSelect?.(id)}
              />
            ) : <span>{segment.label}</span>}
          </span>
        ))}
      </div>
    </div>
  )
}

function readResourceLabel(resource: PromptResource | undefined, t: Translator): string {
  if (!resource) return 'Resource'
  return `${resource.rootNode?.label ?? 'Resource'}${resource.origin?.kind === 'builtin' ? ` · ${t('promptResource.official')}` : ''}`
}

function HeaderPathMenu(props: {
  'aria-label': string
  label: string
  options: Array<{ id: string; label: string }>
  value: string
  onSelect(value: string): void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label={props['aria-label']} className={styles.pathTrigger} type="button">
          <span>{props.label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={styles.pathMenu} sideOffset={6}>
        {props.options.map(option => {
          const current = option.id === props.value
          return (
            <DropdownMenuItem
              aria-current={current ? 'page' : undefined}
              className={styles.pathMenuItem}
              data-current={current ? '' : undefined}
              key={option.id}
              onSelect={() => props.onSelect(option.id)}
            >
              {option.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
