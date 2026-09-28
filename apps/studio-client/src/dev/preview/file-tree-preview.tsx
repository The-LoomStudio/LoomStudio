import { useState } from 'react'
import { FileTree, type FileTreeNode } from '../../shared/ui/file-tree/file-tree.js'

const nodes: FileTreeNode[] = [
  { id: 'selected', label: '已选条目', kind: 'entry' },
  { id: 'message', label: '消息块', kind: 'message', children: [] },
  { id: 'next', label: '下一条目', kind: 'entry' },
]

function PreviewTree(props: { virtualized: boolean }) {
  const [selectedId, setSelectedId] = useState('selected')
  const [expandedIds, setExpandedIds] = useState<string[]>([])
  const label = props.virtualized ? '虚拟树' : '普通树'
  return (
    <section style={{ minWidth: 0 }}>
      <h2>{label}</h2>
      <FileTree
        ariaLabel={label}
        nodes={nodes}
        selectedId={selectedId}
        expandedIds={expandedIds}
        onExpandedIdsChange={setExpandedIds}
        onSelect={node => setSelectedId(node.id)}
        virtualized={props.virtualized}
        getDisclosureLabel={(node, expanded) => `${expanded ? '收起' : '展开'}${node.label}`}
        getDragLabel={node => `拖动${node.label}`}
        moreActionsLabel="更多操作"
      />
    </section>
  )
}

export function FileTreePreview() {
  return (
    <main style={{ padding: 24, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 24 }}>
      <PreviewTree virtualized={false} />
      <PreviewTree virtualized />
    </main>
  )
}
