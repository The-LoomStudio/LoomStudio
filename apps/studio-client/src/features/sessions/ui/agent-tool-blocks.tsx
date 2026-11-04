import { useState, type ReactNode } from 'react'
import { AlertCircle, XCircle, PauseCircle, BookOpen, RefreshCw, CheckCircle2, ChevronDown, ChevronRight, FileCode, Globe, Search, Terminal } from 'lucide-react'
import type { Translator } from '../../../shared/i18n/index.js'
import { StreamingViewport } from '../../../shared/ui/streaming-viewport/streaming-viewport.js'
import type { StepToolItem } from '../model/transcript-render-items.js'
import styles from './agent-tool-blocks.module.scss'
export function ToolCollapse(props: {
  open: boolean
  id?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div
      id={props.id}
      className={`${styles.toolCollapse} ${props.className ?? ''}`}
      data-open={props.open}
      aria-hidden={!props.open}
      inert={!props.open}
    >
      <div className={styles.toolCollapseInner}>{props.children}</div>
    </div>
  )
}

export type RowExpansion = {
  isOpen(id: string, initial?: boolean): boolean
  toggle(id: string, initial?: boolean): void
}

export function AgentToolActionItem(props: StepToolItem & { defaultOpen?: boolean; expansion?: RowExpansion; t?: Translator; followWork?: boolean; onInspect?(): void }) {
  const [localOpen, setLocalOpen] = useState(props.defaultOpen ?? false)
  const open = props.expansion?.isOpen(props.id, props.defaultOpen) ?? localOpen
  const duplicateResult = Boolean(props.errorContent && props.resultContent?.trim() === props.errorContent.trim())

  const renderIcon = () => {
    switch (props.iconType) {
      case 'file':
        return <BookOpen aria-hidden="true" />
      case 'search':
        return <Search aria-hidden="true" />
      case 'web':
        return <Globe aria-hidden="true" />
      case 'terminal':
        return <Terminal aria-hidden="true" />
      case 'edit':
        return <FileCode aria-hidden="true" />
      default:
        return <Terminal aria-hidden="true" />
    }
  }

  const detail = (
        <div className={styles.toolDetailCard}>
          {props.inputs.map((input, index) => (
            <div className={styles.toolDetailSection} key={`${input.label}-${index}`}>
              <span className={styles.toolDetailTag}>{input.label}</span>
              <pre className={styles.toolDetailCode}>{input.content}</pre>
            </div>
          ))}
          {props.errorContent ? (
            <div className={styles.toolDetailSection}>
              <span className={styles.toolDetailTag}>{props.t ? props.t('agent.tool.error') : '错误'}</span>
              <pre className={`${styles.toolDetailCode} ${styles.toolDetailError}`}>{props.errorContent}</pre>
            </div>
          ) : null}
          {props.resultContent !== undefined && !duplicateResult && (props.resultContent || !props.errorContent) ? (
            <div className={styles.toolDetailSection}>
              <span className={styles.toolDetailTag}>{props.t ? props.t('agent.tool.result') : '结果'}</span>
              <pre className={styles.toolDetailCode}>{props.resultContent || (props.t ? props.t('agent.tool.noOutput') : '无输出')}</pre>
            </div>
          ) : null}
          <div
            className={styles.toolDetailFooter}
            data-status={props.status ?? 'running'}
          >
            {props.status === 'error' ? (
              <>
                <AlertCircle aria-hidden="true" />
                <span>{props.t ? props.t('agent.tool.failed') : '失败'}</span>
              </>
            ) : props.status === 'interrupted' ? (
              <>
                <AlertCircle aria-hidden="true" />
                <span>{props.t ? props.t('agent.tool.interrupted') : '已中断'}</span>
              </>
            ) : props.status === 'preparing' ? (
              <><RefreshCw aria-hidden="true" /><span>{props.t ? props.t('agent.tool.preparing') : '正在准备参数，尚未执行'}</span></>
            ) : props.status === 'running' ? (
              <>
                <RefreshCw aria-hidden="true" />
                <span>{props.t ? props.t('agent.tool.running') : '执行中'}</span>
              </>
            ) : (
              <>
                <CheckCircle2 aria-hidden="true" />
                <span>{props.t ? props.t('agent.tool.success') : '成功'}</span>
              </>
            )}
          </div>
        </div>
  )

  return (
    <div className={styles.toolItem}>
      <button
        type="button"
        className={styles.toolItemHeader}
        onClick={() => { if (!open) props.onInspect?.(); if (props.expansion) props.expansion.toggle(props.id, props.defaultOpen); else setLocalOpen(prev => !prev) }}
        aria-expanded={open}
      >
        <span className={styles.toolItemIcon}>{renderIcon()}</span>
        <span className={styles.toolItemLabel}>{props.label}</span>
        {props.status && <span className={styles.toolStatus} data-status={props.status} role="img"
          aria-label={{ success: '执行成功', error: '执行失败', interrupted: '执行中断', preparing: '准备参数中', running: '执行中' }[props.status]}
          title={{ success: '执行成功', error: '执行失败', interrupted: '执行中断', preparing: '准备参数中', running: '执行中' }[props.status]}>
          {props.status === 'success' ? <CheckCircle2 aria-hidden="true" /> : props.status === 'error' ? <XCircle aria-hidden="true" /> : props.status === 'interrupted' ? <PauseCircle aria-hidden="true" /> : <RefreshCw className={styles.toolSpinner} aria-hidden="true" />}
        </span>}
        {open ? (
          <ChevronDown className={styles.toolItemChevron} aria-hidden="true" />
        ) : (
          <ChevronRight className={styles.toolItemChevron} aria-hidden="true" />
        )}
      </button>

      <ToolCollapse open={open}>
        {props.followWork ? <StreamingViewport showLatest={false} label="工具参数与结果" active={open} streaming={props.status === 'preparing' || props.status === 'running'} onInspect={props.onInspect}>{detail}</StreamingViewport> : detail}
      </ToolCollapse>
    </div>
  )
}

/**
 * 连续工具聚合块 (Tool Group Block)
 * 只要有工具连在一起，就是一个单独的滚动区间 (上限 260px)
 * 若仅有单工具，直接展示单工具项，避免形式主义套壳
 */
export function AgentToolGroupBlock(props: {
  id?: string
  label: string
  tools: StepToolItem[]
  followWork?: boolean
  onInspect?(): void
  isInitiallyOpen?(id: string): boolean
  defaultOpen?: boolean
  expansion?: RowExpansion
  t?: Translator
}) {
  const [localOpen, setLocalOpen] = useState(props.defaultOpen ?? false)
  const open = props.id && props.expansion ? props.expansion.isOpen(props.id, props.defaultOpen) : localOpen

  return (
    <div className={styles.toolGroupBlock}>
      {props.tools.length > 1 ? <button
        type="button"
        className={styles.toolGroupHeader}
        onClick={() => props.id && props.expansion ? props.expansion.toggle(props.id, props.defaultOpen) : setLocalOpen(prev => !prev)}
        aria-expanded={open}
      >
        <span className={styles.toolItemIcon}>
          <BookOpen aria-hidden="true" />
        </span>
        <span>{props.label}</span>
        {open ? (
          <ChevronDown className={styles.toolGroupChevron} aria-hidden="true" />
        ) : (
          <ChevronRight className={styles.toolGroupChevron} aria-hidden="true" />
        )}
      </button> : null}

      <ToolCollapse open={props.tools.length === 1 || open}>
        <div className={styles.toolGroupViewport}>
          {props.tools.map((tool, index) => (
            <AgentToolActionItem
              key={tool.id}
              {...tool}
              followWork={props.followWork}
              expansion={props.expansion}
              defaultOpen={props.followWork ? props.isInitiallyOpen?.(tool.id) : index === 0 && props.defaultOpen}
              onInspect={props.onInspect}
              t={props.t}
            />
          ))}
        </div>
      </ToolCollapse>
    </div>
  )
}

