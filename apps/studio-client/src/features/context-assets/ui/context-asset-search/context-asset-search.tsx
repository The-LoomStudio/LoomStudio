import { FileText, Folder, Package, Search, X } from 'lucide-react'
import { useDeferredValue, useMemo, type ReactNode } from 'react'
import type { ContextAssetNode } from '../../../../entities/index.js'
import type { Translator } from '../../../../shared/i18n/index.js'
import { buildContextAssetSearchIndex, searchContextAssets } from '../../model/context-asset-search.js'
import styles from './context-asset-search.module.scss'

type ContextAssetSearchProps = {
  children: ReactNode
  nodes: ContextAssetNode[]
  onQueryChange(query: string): void
  onSelect(node: ContextAssetNode): void
  query: string
  t: Translator
}

export function ContextAssetSearch(props: ContextAssetSearchProps) {
  const deferredQuery = useDeferredValue(props.query)
  const index = useMemo(() => buildContextAssetSearchIndex(props.nodes), [props.nodes])
  const results = useMemo(() => searchContextAssets(index, deferredQuery), [deferredQuery, index])
  const searching = props.query.trim().length > 0

  return (
    <div className={styles.explorerSearch} data-loom-component="context-asset-search">
      <div className={styles.searchField}>
        <Search aria-hidden="true" />
        <input
          aria-label={props.t('context.search.label')}
          placeholder={props.t('context.search.placeholder')}
          type="search"
          value={props.query}
          onChange={event => props.onQueryChange(event.target.value)}
        />
        {props.query ? (
          <button aria-label={props.t('context.search.clear')} type="button" onClick={() => props.onQueryChange('')}>
            <X aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className={styles.searchBody}>
        {searching ? (
          results.length > 0 ? (
            <div aria-label={props.t('context.search.results')} className={styles.results} role="list">
              {results.map(result => (
                <div key={result.id} role="listitem">
                  <button className={styles.result} type="button" onClick={() => props.onSelect(result.node)}>
                    <span className={styles.resultIcon}>{renderResultIcon(result.kind)}</span>
                    <span className={styles.resultText}>
                      <strong>{highlightText(result.label, deferredQuery)}</strong>
                      <small>{highlightText(result.path, deferredQuery)}</small>
                      {result.excerpt ? <span>{highlightText(result.excerpt, deferredQuery)}</span> : null}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>{props.t('context.search.empty')}</div>
          )
        ) : props.children}
      </div>
    </div>
  )
}

function renderResultIcon(kind: ContextAssetNode['kind']) {
  if (kind === 'module') return <Package aria-hidden="true" />
  if (kind === 'folder') return <Folder aria-hidden="true" />
  return <FileText aria-hidden="true" />
}

function highlightText(value: string, rawQuery: string): ReactNode {
  const tokens = [...new Set(rawQuery.trim().split(/\s+/).filter(Boolean))]
  if (tokens.length === 0) return value
  const matcher = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'giu')
  return value.split(matcher).map((part, index) => (
    tokens.some(token => token.toLocaleLowerCase() === part.toLocaleLowerCase())
      ? <mark key={`${part}-${index}`}>{part}</mark>
      : part
  ))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
