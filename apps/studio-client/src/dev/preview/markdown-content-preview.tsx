import { useState } from 'react'
import { MarkdownContent } from '../../shared/ui/markdown-content/markdown-content.js'

export function MarkdownContentPreview() {
  const [revision, setRevision] = useState(0)
  const [updated, setUpdated] = useState(false)
  return (
    <main style={{ padding: 24 }}>
      <nav>
        <button onClick={() => setRevision(value => value + 1)}>更新父组件</button>
        <button onClick={() => setUpdated(value => !value)}>更新正文</button>
        <output aria-label="父组件更新次数">{revision}</output>
      </nav>
      <MarkdownContent
        value={`\`\`\`javascript\n${updated ? 'const revised = 2;' : 'const original = 1;'}\n\`\`\``}
        codeBlockLabels={{
          copy: '复制代码', copied: '已复制代码', copyFailed: '复制失败',
          enableWrap: '开启换行', disableWrap: '关闭换行',
        }}
      />
    </main>
  )
}
