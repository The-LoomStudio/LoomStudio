import { useState } from 'react'
import type { CardDirectoryAttachment, OpenCardDirectoryResult } from '@loom-studio/shared'
import { createTranslator } from '../../shared/i18n/index.js'
import { CardResourceSummary } from '../../widgets/character-panel/card-resource-overview.js'

const t = createTranslator('zh-CN')
const overview: OpenCardDirectoryResult = {
  token: 'preview',
  name: '四方世界', directory: '/data/characters/example-world', artifactId: 'example-world',
  totalBytes: 12_430_001, files: [], promptResources: [], scriptCount: 3, payloadCount: 1,
  attachments: [
    { path: 'assets/avatar.png', label: 'avatar', kind: 'image', sizeBytes: 5_850_000 },
    { path: 'README.md', label: 'README', kind: 'document', sizeBytes: 4_201 },
  ],
}
const api = {
  async attachment(_directory: string, path: string): Promise<CardDirectoryAttachment> {
    return path === 'README.md'
      ? { kind: 'document', content: '# 四方世界\n\n这里是作者附带的说明。\n\n## 更新记录\n\n- 新增港口与群岛。\n- 调整角色初始化数据。' }
      : { kind: 'image', content: '/images/default-card.png' }
  },
}

export function CardResourcesPreview() {
  const [empty, setEmpty] = useState(false)
  return <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}><h2 style={{ fontSize: 18 }}>资源与附件</h2><label><input type="checkbox" checked={empty} onChange={event => setEmpty(event.target.checked)} /> 空附件</label></header>
    <CardResourceSummary key={String(empty)} overview={empty ? { ...overview, attachments: [] } : overview} api={api} t={t} />
  </main>
}
