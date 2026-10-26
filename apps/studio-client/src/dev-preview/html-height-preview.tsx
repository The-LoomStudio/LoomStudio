import { useEffect, useRef, useState } from 'react'
import { Button } from '@loom-studio/ui'
import { StartupReady } from '../app/startup-curtain.js'
import { MessageContent } from '../features/message-content/ui/message-content.js'
import { useSmoothFollow } from '../shared/ui/streaming-viewport/use-smooth-follow.js'

const labels = { copy: '复制', copied: '已复制', copyFailed: '复制失败', enableWrap: '自动换行', disableWrap: '关闭换行' }
const documentHtml = `<html><body style="font:16px/1.7 system-ui;padding:20px;color:#314358;background:#edf3fa;box-sizing:border-box">
<h2>钟楼下的来信</h2><p>完整 HTML 已就绪。下面的内容会延迟展开，再收起。</p>
<button onclick="document.getElementById('extra').hidden=!document.getElementById('extra').hidden">展开／收起信件</button>
<div id="extra" hidden>${Array.from({ length: 12 }, (_, index) => `<p>第 ${index + 1} 段：雨水顺着钟楼的石阶流下，那封信里还藏着没有说完的故事。</p>`).join('')}</div>
<script>setTimeout(()=>document.getElementById('extra').hidden=false,1800);setTimeout(()=>document.getElementById('extra').hidden=true,4800)</script>
</body></html>`
const source = `[letter]${documentHtml}[/letter]`
type Sample = 'direct' | 'replacement' | 'delayed'

function Playback({ sample }: { sample: Sample }) {
  const [length, setLength] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const follow = useSmoothFollow({ scrollRef, contentRef })
  const input = sample === 'replacement' ? source : `\`\`\`html\n${documentHtml}\n\`\`\``
  const complete = sample === 'delayed' || length >= input.length
  useEffect(() => {
    if (complete) return
    const timer = window.setTimeout(() => setLength(current => Math.min(input.length, current + 48)), 32)
    return () => window.clearTimeout(timer)
  }, [length, input, complete])
  const raw = complete ? input : input.slice(0, length)
  // Fixture only: mimic the complete-match Display result; no business transform API.
  const value = sample === 'replacement'
    ? raw.replace(/\[letter\]([\s\S]*)\[\/letter\]/g, '```html\n$1\n```')
    : raw
  return <>
    <p role="status">{complete ? '输出完成' : '正在输出'} · {follow.following ? '跟随最新' : '阅读位置已保留'}</p>
    <Button size="small" onClick={follow.resume}>回到最新</Button>
    <div ref={scrollRef} tabIndex={0} aria-label="HTML 高度预览阅读区"
      style={{ height: '65dvh', overflowY: 'auto', overflowAnchor: 'none', marginTop: 12, border: '1px solid var(--loom-color-border)', borderRadius: 12 }}>
      <div ref={contentRef} style={{ padding: 24 }}>
        {Array.from({ length: 20 }, (_, index) => <p key={index}>历史段落 {index + 1}：可以向上翻阅，观察下方 HTML 高度改变时是否抢回滚动。</p>)}
        <MessageContent role="assistant" value={sample === 'delayed' ? documentHtml : value} streaming={!complete} codeBlockLabels={labels} />
        <p>信件之后的正文：高度调整结束后，这一段应自然接续。</p>
      </div>
    </div>
  </>
}

/** Local samples only; consumes the same MessageContent and follow controller as production. */
export function HtmlHeightPreview() {
  const [sample, setSample] = useState<Sample>('direct')
  const [epoch, setEpoch] = useState(0)
  return <main style={{ maxWidth: 920, margin: '24px auto', padding: '0 24px' }}>
    <h1>HTML 高度过渡</h1>
    <p>直接 HTML 等边界闭合后挂载；正则样例等完整匹配后替换。挂载后均会延迟增高、收起，也可手动展开。</p>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <select aria-label="HTML 样例" value={sample} onChange={event => setSample(event.target.value as Sample)}>
        <option value="direct">AI 直接输出 HTML</option>
        <option value="replacement">完整正则替换 HTML</option>
        <option value="delayed">已挂载 iframe 延迟增高</option>
      </select>
      <Button size="small" onClick={() => setEpoch(current => current + 1)}>重播</Button>
    </div>
    <Playback key={`${sample}-${epoch}`} sample={sample} />
    <StartupReady />
  </main>
}
