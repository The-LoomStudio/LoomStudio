import { useEffect, useState } from 'react'
import { Button, Dialog } from '@loom-studio/ui'
import { Download, RotateCcw } from 'lucide-react'
import { StartupReady } from '../app/startup-curtain.js'
import { ResourceUpdateReview, type ReviewItem, type Resolution, type ResourceCopyResult } from '../features/resource-updates/ui/resource-update-review.js'
import styles from './resource-update-preview.module.scss'

const samples: ReviewItem[] = [
  { id: 'curfew', kind: 'Lore', title: '雾港宵禁', local: '港区每日 23:00 起实行宵禁。持灯者可通行。', incoming: '港区每日 21:00 起实行宵禁。持灯者可通行。', copyResourceId: 'fog-lore', copyResourceTitle: '雾港世界设定' },
  { id: 'dock', kind: 'Lore', title: '北码头', local: null, incoming: '北码头在晨雾散去后开市。渡船每隔一小时出发。', copyResourceId: 'fog-lore', copyResourceTitle: '雾港世界设定' },
  { id: 'style', kind: '预设条目', title: '叙事风格', local: '用细腻的第二人称叙述，保留人物的犹豫。', incoming: '用简洁的第三人称叙述。线索出现时引用 {{clue_style}}。', copyResourceId: 'fog-preset', copyResourceTitle: '雾港写作预设' },
  { id: 'order', kind: '预设排序', title: '条目顺序', local: '世界设定 → 叙事风格 → 输出格式', incoming: '叙事风格 → 世界设定 → 线索整理 → 输出格式', copyResourceId: 'fog-preset', copyResourceTitle: '雾港写作预设' },
  { id: 'macro', kind: '预设宏', title: 'clue_style', local: null, incoming: '用一句独立短句提示线索，不提前揭晓答案。', copyResourceId: 'fog-preset', copyResourceTitle: '雾港写作预设' },
]
type Phase = 'source' | 'download' | 'dependencies' | 'review' | 'receipt'
export function ResourceUpdatePreview() {
  const [phase, setPhase] = useState<Phase>('source')
  const [items, setItems] = useState(samples)
  const [selected, setSelected] = useState('curfew')
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({})
  const [query, setQuery] = useState('')
  const [progress, setProgress] = useState(0)
  const [failure, setFailure] = useState(false)
  const [dependencyReady, setDependencyReady] = useState(false)
  const [round, setRound] = useState(1)
  const [copies, setCopies] = useState<Array<ResourceCopyResult & { content: string }>>([])
  const [openedCopy, setOpenedCopy] = useState<string>()
  const [logs, setLogs] = useState<string[]>([])
  useEffect(() => {
    if (phase !== 'download' || failure) return
    const timer = window.setInterval(() => setProgress(value => Math.min(100, value + 10)), 220)
    return () => window.clearInterval(timer)
  }, [phase, failure])
  useEffect(() => {
    if (phase === 'download' && progress === 100) { setPhase('dependencies'); setLogs(value => [...value, '主包下载完成 · 已校验并保存至暂存区', '读取清单 · 发现一个待准备的依赖']) }
  }, [phase, progress])
  const unresolved = items.filter(item => item.local !== null && item.local !== item.incoming && !resolutions[item.id]).length
  function resultText(item: ReviewItem) { return resolutions[item.id]?.choice === 'local' ? item.local : item.incoming }
  const missingMacro = items.some(item => item.id === 'style' && resultText(item)?.includes('{{clue_style}}')) && !items.some(item => item.id === 'macro' && resultText(item)?.trim())
  function start() { setProgress(0); setFailure(false); setPhase('download'); setLogs(['识别 Odysseia 作品 · 雾港纪事', '准备版本 1.3.0 · 开始下载（模拟）']) }
  function reset() { setPhase('source'); setItems(samples); setResolutions({}); setRound(1); setQuery(''); setSelected('curfew'); setDependencyReady(false); setLogs([]); setCopies([]); setOpenedCopy(undefined) }
  function next(changed: boolean) {
    setItems(current => current.map(item => ({ ...item, local: resultText(item), incoming: changed && item.id === 'curfew' ? '港区每日 20:00 起实行宵禁。持灯者可通行。' : item.incoming })))
    setResolutions({}); setRound(value => value + 1); setPhase('review'); setQuery(''); setSelected('curfew')
  }
  return <main className={styles.host}><StartupReady />
    <header className={styles.header}><div><strong>资源获取与更新</strong><small>DEV PREVIEW · 虚构作品 · 纯内存模拟</small></div><Button variant="ghost" onClick={reset}><RotateCcw size={15} />重置演示</Button></header>
    <nav className={styles.steps} aria-label="当前流程">{['获取主包', '准备依赖', '审阅内容', '采用结果'].map((label, index) => <span key={label} aria-current={index === (phase === 'source' || phase === 'download' ? 0 : phase === 'dependencies' ? 1 : phase === 'review' ? 2 : 3) ? 'step' : undefined}>{index + 1}　{label}</span>)}</nav>
    {phase === 'review' ? <><div className={styles.reviewHead}><strong>《雾港纪事》 · {round === 1 ? '1.2.0 → 1.3.0' : `后续更新 · 第 ${round} 次审阅`}</strong><span>故事第 18 天 · 灯塔与故事进度保持原样</span></div><div className={styles.workbench}><ResourceUpdateReview items={items} selected={selected} onSelect={setSelected} resolutions={resolutions} onResolve={(id, value) => setResolutions(current => ({ ...current, [id]: value }))} query={query} onQuery={setQuery} onSaveCopy={async (resourceId, label) => {
      const result = { id: `copy-${copies.length + 1}`, label, content: items.filter(item => item.copyResourceId === resourceId && item.local !== null).map(item => `${item.title}\n${item.local}`).join('\n\n') }
      setCopies(current => [...current, result]); return result
    }} onOpenCopy={copy => setOpenedCopy(copy.id)} /></div><footer className={styles.footer}><span>{missingMacro ? '叙事条目引用 clue_style，请采用该宏或修改引用' : unresolved ? `${unresolved} 项已有内容待选择` : '选择已就绪；新增内容默认采用'}</span><Button variant="ghost" onClick={() => { setResolutions({}); setPhase('source') }}>取消本次更新</Button><Button disabled={unresolved > 0 || missingMacro} onClick={() => setPhase('receipt')}>确认采用（模拟）</Button></footer></> : <div className={styles.body}>
      <section className={styles.panel}><small>ODYSSEIA · 作品与预设包</small><h1>雾港纪事</h1><p>港口的钟声提前了，旧故事仍在继续。</p>
        {phase === 'source' && <><label>资源链接<input readOnly value="https://odysseia.example/works/fog-harbor" /></label><p>演示已识别来源与版本：1.3.0 · 18 MB</p><p>Lore 与预设更新；脚本和媒体仅显示更新摘要。普通配置不进入审阅清单。</p><Button onClick={start}><Download size={16} />下载到暂存区</Button><Button variant="ghost" onClick={() => setPhase('review')}>直接体验 Diff</Button></>}
        {phase === 'download' && <><p role="status">{failure ? '连接中断，暂存任务保留' : `正在下载主包 · ${progress}%`}</p><progress max={100} value={progress} aria-label="主包下载进度" /><div className={styles.controls}>{failure ? <Button onClick={() => { setFailure(false); setLogs(value => [...value, '重试下载（模拟）']) }}>重试</Button> : <Button onClick={() => { setFailure(true); setLogs(value => [...value, '下载失败 · 模拟连接中断']) }}>模拟网络失败</Button>}<Button variant="ghost" onClick={() => { setPhase('source'); setLogs(value => [...value, '用户取消下载']) }}>取消</Button></div></>}
        {phase === 'dependencies' && <><h2>主包已就绪</h2><p>读取暂存包后发现配套依赖。下载完成不代表启用或升级共享扩展。</p><div className={styles.dependency}><strong>The World · 兼容版本（示例）</strong><span>{dependencyReady ? '依赖产物已暂存，影响审阅留待后续设计' : '需要补充下载'}</span><Button disabled={dependencyReady} onClick={() => { setDependencyReady(true); setLogs(value => [...value, '依赖下载完成（模拟）· 未安装、未启用']) }}>模拟完成依赖下载</Button></div><Button disabled={!dependencyReady} onClick={() => setPhase('review')}>查看内容变化</Button></>}
        {phase === 'receipt' && <><h2>本次内容已采用（模拟）</h2><p>下次生成使用新内容。未改写已提交故事、灯塔与当前 State；依赖安装及运行代码切换不在本次模拟中。</p><ul>{items.map(item => <li key={item.id}>{item.title}：{resolutions[item.id]?.choice === 'local' ? '保留玩家内容' : '采用作者内容'}</li>)}</ul><h3>下一次更新怎么比？</h3><p>本次选择只决定当前使用内容。下次更新重新比较下载包与当前内容；保留过的差异可能再次出现，不保存逐项审阅标签。</p><div className={styles.controls}><Button onClick={() => next(false)}>模拟下次：作者未改宵禁</Button><Button onClick={() => next(true)}>模拟下次：作者改为 20:00</Button></div><p>要体验再次冲突，请先在本轮选择“保留我的内容”。</p></>}
      </section><aside className={styles.notes}><h2>贯穿案例</h2><p><strong>The World</strong><br />维护 Lore 参与内容审阅；天气设置不提示；State 升级另行预览。</p><p><strong>NOM 助手</strong><br />知识与预设参与审阅；脚本只显示更新及必要声明变化。</p><h2>个人副本 · {copies.length}</h2>{copies.map(copy => <Button key={copy.id} variant="ghost" onClick={() => setOpenedCopy(copy.id)}>{copy.label}</Button>)}<p>已保存副本不会因取消更新而删除。此预览刷新后清空。</p><h2>下载日志 · 模拟</h2><ul aria-live="polite">{logs.length ? logs.map((log, index) => <li key={index}>{log}</li>) : <li>尚未开始下载</li>}</ul><p>本页不发送下载请求，不读写真实资源。所选链接为保留示例域名。</p></aside>
    </div>}
    <Dialog open={!!openedCopy} onClose={() => setOpenedCopy(undefined)} title={copies.find(copy => copy.id === openedCopy)?.label ?? "个人资源副本"}><pre className={styles.copyContent}>{copies.find(copy => copy.id === openedCopy)?.content}</pre></Dialog>
  </main>
}
