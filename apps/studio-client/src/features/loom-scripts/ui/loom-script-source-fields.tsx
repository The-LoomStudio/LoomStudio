import { Button } from '@loom-studio/ui'
import { parseLoomScriptSource, resolveLoomScriptSettings, resolveTextExtractorContribution, resolveTextTransformContributionRule } from '@loom-studio/shared/loom-scripts'
import { useMemo, useRef, useState } from 'react'
import { LongTextEditor, type LongTextEditorHandle } from '../../../shared/ui/long-text-editor/long-text-editor.js'
import type { Translator } from '../../../shared/i18n/index.js'
import styles from './loom-script-source-fields.module.scss'

export type ScriptPreviewInput = { source: string; text: string; phase: 'display' | 'prompt' | 'classify' }
export type ScriptPreviewResult = {
  output: string
  matches: Array<{ ruleId: string; match: string }>
  diagnostics: Array<{ message: string }>
  extractions?: Array<{ extractorId: string; values: unknown[]; diagnostics: Array<{ message: string }> }>
}

export function LoomScriptSourceFields(props: {
  fileName: string
  source: string
  disabled?: boolean
  onFileNameChange(value: string): void
  onSourceChange(value: string): void
  onPreview?(input: ScriptPreviewInput): Promise<ScriptPreviewResult>
  t: Translator
}) {
  const editorRef = useRef<LongTextEditorHandle>(null)
  const requestRef = useRef(0)
  const [sample, setSample] = useState('')
  const [phase, setPhase] = useState<ScriptPreviewInput['phase']>('display')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ source: string; text: string; phase: string; value?: ScriptPreviewResult; error?: string }>()
  const parsed = useMemo(() => {
    try { return { metadata: parseLoomScriptSource(props.source) } }
    catch (cause) { return { error: cause instanceof Error ? cause.message : String(cause) } }
  }, [props.source])
  const rules = parsed.metadata?.contributions.filter(contribution => contribution.kind !== 'renderer') ?? []
  const currentResult = result?.source === props.source && result.text === sample && result.phase === phase ? result : undefined

  async function testRules() {
    if (!props.onPreview || testing) return
    const request = ++requestRef.current
    const input = { source: props.source, text: sample, phase }
    setTesting(true)
    try {
      const value = await props.onPreview(input)
      if (request === requestRef.current) setResult({ ...input, value })
    } catch (cause) {
      if (request === requestRef.current) setResult({ ...input, error: cause instanceof Error ? cause.message : String(cause) })
    } finally { if (request === requestRef.current) setTesting(false) }
  }

  return <section className={styles.inspectionSection}>
    <h4>{props.t('textTransform.source')}</h4>
    <p className={styles.metaLine}>保存只更新源码；已启动的实例需单独刷新。</p>
    <input aria-label={props.t('textTransform.scriptFileName')} className={styles.inlineInput}
      disabled={props.disabled} value={props.fileName} onChange={event => props.onFileNameChange(event.target.value)} />
    <p className={styles.metaLine}>顶部声明描述脚本能力；日常参数请在“运行与授权”的配置区域修改。</p>
    {parsed.error ? <p role="status" className={styles.error}>{parsed.error}</p> : null}
    {rules.length > 0 && <div className={styles.summary} aria-label="规则摘要">
      <h4>规则摘要 · {rules.length}</h4>
      {rules.map(contribution => {
        const settings = resolveLoomScriptSettings(parsed.metadata?.settings)
        const definition = contribution.kind === 'text-transform' ? resolveTextTransformContributionRule(contribution, settings) : resolveTextExtractorContribution(contribution, settings)
        return <article className={styles.ruleCard} key={contribution.id}>
          <div className={styles.ruleHeading}><strong>{definition.name}</strong><Button size="small" variant="ghost" onClick={() => editorRef.current?.revealLine(contributionLine(props.source, contribution.id))}>定位声明</Button></div>
          <small>{'phases' in definition ? `文本规则 · ${definition.phases.join(' / ')}` : '文本提取器'} · {definition.enabled ? '启用' : '关闭'}{contribution.requiresCode ? ' · 依赖代码' : ''}</small>
          <code>/{definition.matcher.pattern}/{definition.matcher.flags}</code>
        </article>
      })}
    </div>}
    <div className={styles.editor}>
      <LongTextEditor ref={editorRef} sourceOnly mode="source" language="loom-script" label={props.t('textTransform.source')}
        disabled={props.disabled} spellCheck={false} minHeight={360} value={props.source}
        onChange={props.onSourceChange} onCommit={() => {}}
        clearLabel="清空源码" clearedLabel="源码已清空，可撤销" copyLabel="复制完整脚本" copiedLabel="已复制" copyFailedLabel="复制失败"
        restoreInitialLabel="恢复本次打开时的源码" undoEditLabel="撤销编辑" undoLabel="撤销清空" />
    </div>
    {rules.length > 0 && props.onPreview && <details className={styles.testing}>
      <summary>规则测试</summary>
      <p className={styles.metaLine}>使用当前源码和配置默认值测试，不保存脚本、不执行 JavaScript。</p>
      <label>处理阶段<select value={phase} onChange={event => setPhase(event.target.value as ScriptPreviewInput['phase'])}>
        <option value="display">显示</option><option value="prompt">提示词</option><option value="classify">分类</option>
      </select></label>
      <label>样本文本<textarea aria-label="规则测试样本文本" className={styles.rawJsonTextarea} value={sample} onChange={event => setSample(event.target.value)} /></label>
      <Button size="small" disabled={testing || props.disabled || Boolean(parsed.error)} onClick={() => void testRules()}>{testing ? '测试中…' : '测试规则'}</Button>
      {currentResult?.error && <p role="alert" className={styles.error}>{currentResult.error}</p>}
      {currentResult?.value && <div aria-live="polite">{rules.some(contribution => contribution.kind === 'text-transform') && <><p className={styles.metaLine}>命中 {currentResult.value.matches.length} 次</p><pre className={styles.output}>{currentResult.value.output}</pre></>}
        {currentResult.value.diagnostics.map((diagnostic, index) => <p className={styles.error} key={index}>{diagnostic.message}</p>)}
        {currentResult.value.extractions?.map(extraction => <section key={extraction.extractorId}>
          <h4>提取结果 · {extraction.extractorId}</h4><pre className={styles.output}>{JSON.stringify(extraction.values, null, 2)}</pre>
          {extraction.diagnostics.map((diagnostic, index) => <p className={styles.error} key={index}>{diagnostic.message}</p>)}
        </section>)}
      </div>}
    </details>}
  </section>
}

function contributionLine(source: string, id: string): number {
  const lines = source.split('\n')
  let declarationLine = 1
  let inContribution = false
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    if (/^\/\/\s*@/.test(line)) {
      inContribution = /^\/\/\s*@contribution\s/.test(line)
      if (inContribution) declarationLine = index + 1
    }
    if (inContribution && line.includes('"id"') && line.includes(JSON.stringify(id))) return declarationLine
  }
  return declarationLine
}
