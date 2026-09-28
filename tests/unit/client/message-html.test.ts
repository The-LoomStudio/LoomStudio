import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseMessageSegments } from '../../../apps/studio-client/src/features/message-content/model/message-segments.js'
import { buildHtmlDocument, HTML_PREVIEW_CSP, readHtmlHeight } from '../../../apps/studio-client/src/features/message-content/model/html-document.js'
import { MarkdownContent } from '../../../apps/studio-client/src/shared/ui/markdown-content/markdown-content.js'
import { MessageContent } from '../../../apps/studio-client/src/features/message-content/ui/message-content.js'
import { displayText } from '../../../apps/studio-client/src/features/message-content/model/use-display-projection.js'
import { projectHistoryEntries } from '@loom-studio/application-runtime'
import { messageHtmlExamples, nextPreviewStreamOffset } from '../../../apps/studio-client/src/dev/archive/message-html/message-html-examples.js'

const labels = { copy: 'Copy', copied: 'Copied', copyFailed: 'Failed', enableWrap: 'Wrap', disableWrap: 'Unwrap' }
const html = (value: string, safeHtml = true) => renderToStaticMarkup(createElement(MarkdownContent, { value, safeHtml, codeBlockLabels: labels }))

describe('message HTML classification', () => {
  it('keeps capture replacements as an inline fragment', () => {
    const source = { kind: 'agent-session', sessionId: 'test' } as const
    const raw = '<Status>\n姓名:青\n年龄:25\n</Status>'
    const snapshot = projectHistoryEntries({
      source, phase: 'display',
      entries: [{ id: '1', source, sequence: 0, text: raw }],
      rules: [{
        id: 'status', version: 1, name: 'Status', owner: { kind: 'workspace' }, enabled: true, orderIndex: 0,
        matcher: { kind: 'regex', pattern: '<Status>\\n姓名:(.*?)\\n年龄:(.*?)\\n</Status>', flags: 's' },
        effect: { kind: 'replace', replacement: '<details><summary>$1</summary><small>$2</small></details>' },
        targets: ['agent-session'], phases: ['display'], createdAt: '', updatedAt: '',
      }],
    })
    const value = displayText({ entries: new Map(snapshot.entries.map(entry => [entry.id, entry])), pending: false }, '1', raw)!
    expect(snapshot.entries[0]?.originalText).toBe(raw)
    expect(parseMessageSegments(value)).toEqual([{ kind: 'fragment', value, start: 0 }])
    expect(html(value)).toContain('<details><summary>青</summary><small>25</small></details>')
  })

  it('preserves a non-fenced nested document including blank lines and JS macros', () => {
    const document = '<div>\n<style>.x {color:red}</style>\n\n<div class="x">A</div>\n<script>const x = "{{name}}";</script>\n</div>'
    const parts = parseMessageSegments(`Before\n\n${document}\n\nAfter`)
    expect(parts.map(part => part.kind)).toEqual(['markdown', 'document', 'markdown'])
    expect(parts[1]?.value).toBe(document)
  })

  it('groups adjacent CSS, HTML and scripts in a single preview', () => {
    const value = '<style>body{color:red}</style>\n\n<div>UI</div>\n<script>document.body.dataset.ready="yes"</script>'
    expect(parseMessageSegments(value)).toEqual([{ kind: 'document', value, start: 0 }])
  })

  it('keeps adjacent fenced interfaces as independent frames', () => {
    const first = '<html><body>Quick Reply</body></html>'
    const second = '<html><body>Status</body></html>'
    const parts = parseMessageSegments(`\`\`\`html\n${first}\n\`\`\`\n\n\`\`\`html\n${second}\n\`\`\``)
    expect(parts.filter(part => part.kind === 'document').map(part => part.value)).toEqual([first, second])
  })

  it('does not absorb an independent safe fragment into a later HTML document', () => {
    const parts = parseMessageSegments('<details><summary>A</summary>B</details>\n\n<div><script>1</script></div>')
    expect(parts.filter(part => part.kind !== 'markdown').map(part => part.kind)).toEqual(['fragment', 'document'])
  })

  it('recognizes bare complete HTML documents and keeps prose outside', () => {
    const document = '<!DOCTYPE html><html><head><title>A</title></head><body><button>A</button></body></html>'
    const parts = parseMessageSegments(document + '\n\nAfter')
    expect(parts[0]).toEqual({ kind: 'document', value: document, start: 0 })
    expect(parts[1]?.value).toBe('\n\nAfter')
  })

  it('recognizes minified documents with source-map lines, but honors an explicit text fence', () => {
    const document = '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"/><script type="module">const ready=true;\n//# sourceMappingURL=index.js.map</script><style>:root{color:black}\n\n/*# sourceMappingURL=main.css.map*/</style></head><body><div>UI</div></body></html>'
    expect(parseMessageSegments(document)).toEqual([{ kind: 'document', value: document, start: 0 }])
    expect(parseMessageSegments(`\`\`\`html\n${document}\n\`\`\``)[0]?.kind).toBe('document')
    const text = `\`\`\`text\n${document}\n\`\`\``
    expect(parseMessageSegments(text)).toEqual([{ kind: 'markdown', value: text, start: 0 }])
  })

  it('requires a real closing fence, including matching fence length and character', () => {
    expect(parseMessageSegments('```html\n<button>UI</button>', true).some(part => part.kind === 'document')).toBe(false)
    expect(parseMessageSegments('````html\n<p>A</p>\n```', true).some(part => part.kind === 'document')).toBe(false)
    expect(parseMessageSegments('~~~html\n<p>A</p>\n```', true).some(part => part.kind === 'document')).toBe(false)
    expect(parseMessageSegments('```html\n<p>A</p>\n```', true)[0]?.kind).toBe('document')
    expect(parseMessageSegments('~~~html\n<p>A</p>\n~~~', true)[0]?.kind).toBe('document')
  })

  it('preserves HTML on the opening fence line without executing inline or text code', () => {
    const document = '<!doctype html><html><body>UI</body></html>'
    expect(parseMessageSegments(`\`\`\`html ${document}\n\`\`\``))
      .toEqual([{ kind: 'document', value: document + '\n', start: 0 }])
    expect(parseMessageSegments('```html <html>\n<body>UI</body></html>\n```')[0])
      .toMatchObject({ kind: 'document', value: '<html>\n<body>UI</body></html>' })
    for (const source of [`\`\`\`text ${document}\n\`\`\``, `\`\`\`html ${document}\`\`\``]) {
      expect(parseMessageSegments(source).some(part => part.kind === 'document')).toBe(false)
    }
    expect(parseMessageSegments(`\`\`\`html ${document}`, true)[0]?.kind).toBe('pending')
    expect(parseMessageSegments('```html title="demo"\n<div>UI</div>\n```')[0]?.value).toBe('<div>UI</div>')
  })

  it('renders a closed bare container during streaming but holds incomplete markup', () => {
    expect(parseMessageSegments('<div><script>1</script></div>', true)[0]?.kind).toBe('document')
    expect(parseMessageSegments('<div><script>1</script>', true)[0]?.kind).toBe('pending')
    expect(parseMessageSegments('<style>body{color:red}</style>\n<div>', true)[0]?.kind).toBe('pending')
    const rendered = renderToStaticMarkup(createElement(MessageContent, {
      value: '<div><style>body{color:red}</style><script>secretCode()',
      streaming: true, role: 'assistant', codeBlockLabels: labels,
    }))
    expect(rendered).toContain('HTML 正在生成')
    expect(rendered).not.toContain('secretCode')
    expect(rendered).not.toContain('color:red')
  })

  it.each(messageHtmlExamples('data:' + 'image/png;base64,AAAA').filter(item => ['status', 'fenced', 'gallery'].includes(item.id)))(
    'replays $id through completion without exposing scripts as Markdown or restarting a completed block',
    example => {
      let offset = 0
      let completedDocument: string | undefined
      let steps = 0
      while (offset < example.value.length) {
        offset = nextPreviewStreamOffset(example.value, offset)
        const parts = parseMessageSegments(example.value.slice(0, offset), offset < example.value.length)
        for (const part of parts.filter(item => item.kind === 'markdown')) {
          expect(part.value).not.toMatch(/document\.getElementById|box-sizing|<script>|<\/style>/)
        }
        const document = parts.find(part => part.kind === 'document')
        if (completedDocument) expect(document?.value).toBe(completedDocument)
        if (document) completedDocument = document.value
        expect(++steps).toBeLessThan(200)
      }
      expect(completedDocument).toBeTruthy()
    },
  )

  it('leaves ordinary Markdown streaming unchanged', () => {
    expect(parseMessageSegments('正文继续输出 **尚未闭合', true)).toEqual([
      { kind: 'markdown', value: '正文继续输出 **尚未闭合', start: 0 },
    ])
  })

  it('leaves business tags, escaped HTML and other code languages as text', () => {
    for (const value of ['<Status>姓名:青</Status>', '`<div>example</div>`', '&lt;html&gt;Example', '```js\n"<html>"\n```']) {
      expect(parseMessageSegments(value).every(part => part.kind === 'markdown')).toBe(true)
      expect(renderToStaticMarkup(createElement(MessageContent, { value, role: 'assistant', codeBlockLabels: labels }))).not.toContain('<iframe')
    }
  })
})

describe('safe in-message fragments', () => {
  it('allows details and constrained typography but strips active content and unsafe CSS', () => {
    const rendered = html('<details open><summary style="font-size:12px;position:fixed;background:url(https://bad);color:red" onclick="alert(1)">A</summary><script>alert(1)</script><iframe src="https://bad"></iframe><a href="javascript:alert(1)">B</a></details>')
    expect(rendered).toContain('<details open="">')
    expect(rendered).toContain('font-size:12px;color:red')
    expect(rendered).not.toMatch(/onclick|<script|<iframe|position:fixed|url\(|javascript:/)
  })

  it('preserves unknown tags inside safe fragments as visible text', () => {
    expect(html('<div><Status>姓名:青</Status></div>')).toContain('&lt;Status&gt;姓名:青&lt;/Status&gt;')
  })

  it('does not enable HTML globally', () => {
    expect(html('<details><summary>A</summary>B</details>', false)).not.toContain('<details>')
  })
})

describe('isolated HTML document', () => {
  it('places CSP before user scripts and preserves source script text', () => {
    const value = buildHtmlDocument('<html><head><script>window.example="{{raw}}";</script></head><body><button onclick="this.textContent=2">1</button></body></html>', 'token')
    expect(value.indexOf('Content-Security-Policy')).toBeLessThan(value.indexOf('window.example'))
    expect(value).toContain('window.example="{{raw}}";')
    expect(value).toContain('onclick="this.textContent=2"')
    expect(HTML_PREVIEW_CSP).toContain("connect-src 'none'")
    expect(HTML_PREVIEW_CSP).toContain("frame-src 'none'")
  })

  it('removes refresh navigation and base URLs', () => {
    const value = buildHtmlDocument('<meta http-equiv="refresh" content="0;url=https://bad"><base href="https://bad"><p>A</p>', 'token')
    expect(value).not.toContain('https://bad')
  })

  it('validates resize messages and bounds their effect on the parent layout', () => {
    expect(readHtmlHeight({ type: 'loom-html-height', token: 'a', height: 123.5 }, 'a')).toBe(124)
    expect(readHtmlHeight({ type: 'loom-html-height', token: 'b', height: 123 }, 'a')).toBeUndefined()
    expect(readHtmlHeight({ type: 'loom-html-height', token: 'a', height: Infinity }, 'a')).toBeUndefined()
    expect(readHtmlHeight({ type: 'loom-html-height', token: 'a', height: 100000 }, 'a')).toBe(100000)
  })
})

describe('Display consumption', () => {
  const entry = { id: '1', text: '', originalText: 'raw', depth: 0, appliedRuleIds: [], promotedReasoning: [] }
  it('honors empty replacements without changing raw text', () => {
    expect(displayText({ entries: new Map([['1', entry]]), pending: false }, '1', 'raw')).toBe('')
    expect(entry.originalText).toBe('raw')
  })
  it('never displays stale, pending or failed projections as successful output', () => {
    expect(displayText({ entries: new Map([['1', entry]]), pending: false }, '1', 'edited')).toBeUndefined()
    expect(displayText({ entries: new Map([['1', entry]]), pending: true }, '1', 'raw')).toBeUndefined()
    expect(displayText({ entries: new Map([['1', entry]]), pending: false, error: 'failed' }, '1', 'raw')).toBeUndefined()
    expect(displayText(undefined, '1', 'raw')).toBe('raw')
    expect(displayText({ entries: new Map(), pending: true }, '1', 'partial', true)).toBe('partial')
  })
})
