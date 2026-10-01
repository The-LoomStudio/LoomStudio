import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, Bot, FileCode2, FileText, Image, Package, Settings2, Sparkles } from 'lucide-react'
import { FileTree, type FileTreeNode } from '../../../shared/ui/file-tree/file-tree.js'
import { MasterDetailWorkbench } from '../../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import styles from './package-resource-drilldown-preview.module.scss'

type Category = 'settings' | 'agents' | 'scripts' | 'attachments'
type Resource = { id: string; name: string; category: Category; packageId: string; body: string }
type Message = { id: string; role: 'system' | 'anchor' | 'user'; title: string; body: string }

const packages = [
  { id: 'island', name: '雾岛角色包', icon: Package },
  { id: 'image', name: '图像套件扩展', icon: Image },
]
const categories: Array<{ id: Category; name: string; icon: typeof FileText }> = [
  { id: 'settings', name: 'Settings', icon: Settings2 },
  { id: 'agents', name: 'Agent 预设', icon: Bot },
  { id: 'scripts', name: '脚本', icon: FileCode2 },
  { id: 'attachments', name: '附件', icon: FileText },
]
const resources: Resource[] = [
  { id: 'island-world', name: '雾岛世界书', category: 'settings', packageId: 'island', body: '雾岛常年被海雾包围。渡口与白塔是故事最初的两个地点。' },
  { id: 'island-guide', name: '游玩教程', category: 'settings', packageId: 'island', body: '从渡口进入故事。天黑之前，找到一位愿意交谈的旅人。' },
  { id: 'island-agent', name: '雾岛叙事 Agent', category: 'agents', packageId: 'island', body: '' },
  { id: 'island-script', name: '线索面板.loom.js', category: 'scripts', packageId: 'island', body: '// 线索面板\nexport function renderClues(clues) {\n  return clues\n}' },
  { id: 'island-note', name: '创作手记.md', category: 'attachments', packageId: 'island', body: '# 创作手记\n\n灯塔、海雾与陌生人，是故事的三个起点。' },
  { id: 'image-style', name: '构图与风格手册', category: 'settings', packageId: 'image', body: '先确定主体、场景和光线，再选择镜头距离。' },
  { id: 'image-agent', name: '生图 Agent', category: 'agents', packageId: 'image', body: '' },
  { id: 'image-script', name: 'image-tools.js', category: 'scripts', packageId: 'image', body: '// 图像工具\nexport async function generateImage(prompt) {\n  return prompt\n}' },
  { id: 'image-readme', name: 'README.md', category: 'attachments', packageId: 'image', body: '# 图像套件\n\n为当前场景生成或修改图片。' },
]
const initialMessages: Record<string, Message[]> = {
  'island-agent': [
    { id: 'island-system', role: 'system', title: '叙事约定', body: '以人物行动推进故事，不提前揭示白塔的秘密。' },
    { id: 'island-history', role: 'anchor', title: '历史锚点', body: '当前会话的叙事历史' },
    { id: 'island-user', role: 'user', title: '当前输入', body: '玩家的下一步行动' },
  ],
  'image-agent': [
    { id: 'image-system', role: 'system', title: '图像约定', body: '整理主体、场景、光线与镜头，再生成画面。' },
    { id: 'image-history', role: 'anchor', title: '历史锚点', body: '当前场景与人物外观' },
    { id: 'image-user', role: 'user', title: '当前输入', body: '本次画面描述' },
  ],
}

export function PackageResourceDrilldownPreview() {
  const [mode, setMode] = useState<'package' | 'domain'>('package')
  const [packageId, setPackageId] = useState('island')
  const [category, setCategory] = useState<Category>()
  const [resourceId, setResourceId] = useState<string>()
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(resources.map(item => [item.id, item.body])))
  const [enabled, setEnabled] = useState<Record<string, boolean>>({ 'island-world': true, 'image-style': true })
  const [messages, setMessages] = useState(initialMessages)
  const [mobilePane, setMobilePane] = useState<'master' | 'detail'>('detail')
  const [expandedIds, setExpandedIds] = useState<string[]>([])
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollByView = useRef<Record<string, number>>({})
  const current = resources.find(item => item.id === resourceId)
  const activePackage = packages.find(item => item.id === (mode === 'package' ? packageId : current?.packageId)) ?? packages[0]!
  const currentCategory = categories.find(item => item.id === (mode === 'domain' ? current?.category : category))
  const viewKey = `${mode}:${packageId}:${category ?? 'root'}:${resourceId ?? 'list'}`

  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = scrollByView.current[viewKey] ?? 0
  }, [viewKey])

  function navigate(action: () => void) {
    scrollByView.current[viewKey] = contentRef.current?.scrollTop ?? 0
    action()
    setMobilePane('detail')
  }

  function openResource(item: Resource) {
    navigate(() => { setPackageId(item.packageId); setCategory(item.category); setResourceId(item.id) })
  }

  function back() {
    if (mode === 'domain') navigate(() => { setMode('package'); setPackageId(current?.packageId ?? packageId) })
    else if (resourceId) navigate(() => setResourceId(undefined))
    else if (category) navigate(() => setCategory(undefined))
    else setMobilePane('master')
  }

  function updateMessage(id: string, body: string) {
    setMessages(previous => ({ ...previous, [resourceId!]: previous[resourceId!]!.map(item => item.id === id ? { ...item, body } : item) }))
  }

  function moveMessage(index: number, offset: number) {
    setMessages(previous => {
      const next = [...previous[resourceId!]!]
      ;[next[index], next[index + offset]] = [next[index + offset]!, next[index]!]
      return { ...previous, [resourceId!]: next }
    })
  }

  const domainResources = resources.filter(item => item.category === current?.category)
  const folderNodes: FileTreeNode[] = categories.map(item => ({
    id: item.id, label: item.name, kind: 'folder', meta: String(resources.filter(resource => resource.packageId === packageId && resource.category === item.id).length),
  }))
  const categoryResources = resources.filter(item => item.packageId === packageId && item.category === category)
  const categoryNodes: FileTreeNode[] = categoryResources.map(item => ({ id: item.id, label: item.name, kind: item.category }))

  return <main className={styles.root}>
    <header className={styles.topbar}>
      <span className={styles.brand}><Sparkles size={17} aria-hidden="true" />资源草稿</span>
      <nav aria-label="预览导航">
        <button type="button" className={mode === 'package' ? styles.active : ''} title="包视图" aria-label="包视图"
          onClick={() => navigate(() => setMode('package'))}><Package size={17} /></button>
        <button type="button" className={mode === 'domain' && current?.category === 'agents' ? styles.active : ''} title="Agent 面板" aria-label="Agent 面板"
          onClick={() => { const item = resources.find(value => value.category === 'agents' && value.packageId === packageId)!; navigate(() => { setResourceId(item.id); setCategory(item.category); setMode('domain') }) }}><Bot size={17} /></button>
        <button type="button" className={mode === 'domain' && current?.category === 'settings' ? styles.active : ''} title="Settings 面板" aria-label="Settings 面板"
          onClick={() => { const item = resources.find(value => value.category === 'settings' && value.packageId === packageId)!; navigate(() => { setResourceId(item.id); setCategory(item.category); setMode('domain') }) }}><Settings2 size={17} /></button>
      </nav>
    </header>
    <MasterDetailWorkbench masterWidth={238} masterMinWidth={190} mobilePane={mobilePane} onMobilePaneChange={setMobilePane}
      backLabel="返回列表" onBack={() => setMobilePane('master')}
      master={<aside className={styles.sidebar}>
        {mode === 'domain' ? <button type="button" className={styles.returnButton} onClick={() => navigate(() => setMode('package'))}>
          <ArrowLeft size={16} aria-hidden="true" />返回包视图
        </button> : null}
        <h2>{mode === 'package' ? '包' : currentCategory?.name}</h2>
        {mode === 'package' ? packages.map(item => {
          const Icon = item.icon
          return <button key={item.id} type="button" className={item.id === packageId ? styles.selected : ''}
            onClick={() => navigate(() => { setPackageId(item.id); setCategory(undefined); setResourceId(undefined) })}>
            <Icon size={18} aria-hidden="true" /><span>{item.name}</span>
          </button>
        }) : domainResources.map(item => <button key={item.id} type="button" className={item.id === resourceId ? styles.selected : ''}
          onClick={() => openResource(item)}><FileText size={17} aria-hidden="true" /><span>{item.name}</span></button>)}
      </aside>}
    >
      <div className={styles.content} ref={contentRef}>
        <nav className={styles.breadcrumbs} aria-label="当前位置">
          <button type="button" title="返回" aria-label="返回" onClick={back}><ArrowLeft size={17} /></button>
          <button type="button" onClick={() => navigate(() => { setMode('package'); setCategory(undefined); setResourceId(undefined) })}>{activePackage.name}</button>
          {category && <button type="button" onClick={() => navigate(() => { setMode('package'); setResourceId(undefined) })}>{currentCategory?.name}</button>}
          {current && <span>{current.name}</span>}
        </nav>
        {current ? <section className={styles.document} key={current.id}>
          <header className={styles.documentHeader}>
            <div><small>{currentCategory?.name}</small><h1>{current.name}</h1></div>
            {(current.category === 'agents' || current.category === 'settings') && <button type="button"
              className={styles.openDomain} title={`在 ${current.category === 'agents' ? 'Agent' : 'Settings'} 面板打开`}
              aria-label={`在 ${current.category === 'agents' ? 'Agent' : 'Settings'} 面板打开`}
              onClick={() => navigate(() => setMode('domain'))}>
              {current.category === 'agents' ? <Bot size={17} /> : <Settings2 size={17} />}
            </button>}
          </header>
          {current.category === 'settings' ? <div className={styles.editor}>
            <label className={styles.check}><input type="checkbox" checked={enabled[current.id] ?? false}
              onChange={event => setEnabled(previous => ({ ...previous, [current.id]: event.target.checked }))} />作者启用</label>
            <label htmlFor={`body-${current.id}`}>正文</label>
            <textarea id={`body-${current.id}`} value={drafts[current.id] ?? ''} rows={12}
              onChange={event => setDrafts(previous => ({ ...previous, [current.id]: event.target.value }))} />
          </div> : current.category === 'agents' ? <div className={styles.messages}>
            {(messages[current.id] ?? []).map((message, index, all) => <article key={message.id} className={styles.message}>
              <header><span>{message.role}</span><strong>{message.title}</strong>
                <div className={styles.order}>
                  <button type="button" title="上移" aria-label={`上移${message.title}`} disabled={index === 0}
                    onClick={() => moveMessage(index, -1)}><ArrowUp size={16} /></button>
                  <button type="button" title="下移" aria-label={`下移${message.title}`} disabled={index === all.length - 1}
                    onClick={() => moveMessage(index, 1)}><ArrowDown size={16} /></button>
                </div>
              </header>
              <textarea aria-label={`${message.title}正文`} rows={message.role === 'system' ? 5 : 3} value={message.body}
                onChange={event => updateMessage(message.id, event.target.value)} />
            </article>)}
          </div> : <pre className={styles.fileBody}>{drafts[current.id]}</pre>}
        </section> : <section className={styles.directory}>
          <h1>{category ? currentCategory?.name : activePackage.name}</h1>
          {!category && <p>资源与附件</p>}
          <FileTree ariaLabel={category ? currentCategory?.name ?? '' : '资源与附件'}
            nodes={category ? categoryNodes : folderNodes} expandedIds={expandedIds} onExpandedIdsChange={setExpandedIds}
            getDisclosureLabel={node => node.label} getDragLabel={node => node.label} moreActionsLabel="更多操作"
            onSelect={node => {
              if (category) {
                const item = categoryResources.find(value => value.id === node.id)
                if (item) openResource(item)
              } else navigate(() => setCategory(node.id as Category))
            }}
            renderIcon={node => {
              const Icon = categories.find(item => item.id === node.id)?.icon ?? (node.kind === 'agents' ? Bot : FileText)
              return <Icon size={18} aria-hidden="true" />
            }} />
        </section>}
      </div>
    </MasterDetailWorkbench>
  </main>
}
