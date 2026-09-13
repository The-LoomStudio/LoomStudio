import { useId, useState, type CSSProperties, type ReactNode } from 'react'
import { Check, Image as ImageIcon, SlidersHorizontal } from 'lucide-react'
import styles from './background-materials-view.module.scss'

export type BackgroundOption = {
  id: string
  name: string
  description: string
  source: string
  image: string
}

export type MaterialValue = {
  mode: 'solid' | 'translucent' | 'glass'
  blur: number
  opacity: number
}

type AppearancePage = 'background' | 'material' | 'general'

export function BackgroundMaterialsView(props: {
  backgrounds: readonly BackgroundOption[]
  selectedId: string | null
  followState: boolean
  material: MaterialValue
  general?: ReactNode
  onSelect(id: string | null): void
  onFollowStateChange(value: boolean): void
  onMaterialChange(value: MaterialValue): void
}) {
  const [page, setPage] = useState<AppearancePage>('background')
  const [query, setQuery] = useState('')
  const tabId = useId()
  const current = props.backgrounds.find(item => item.id === props.selectedId)
  const visible = props.backgrounds.filter(item => `${item.name} ${item.description} ${item.source}`.includes(query.trim()))
  const pages: { id: AppearancePage; label: string }[] = [
    { id: 'background', label: '背景' },
    { id: 'material', label: '材质' },
    ...(props.general ? [{ id: 'general' as const, label: '缩放与 CSS' }] : []),
  ]
  const modes = { solid: '实色', translucent: '半透明', glass: '毛玻璃' } as const

  return (
    <section className={styles.view} data-loom-component="background-materials-view">
      <div className={styles.tabs} role="tablist" aria-label="外观">
        {pages.map((item, index) => (
          <button
            aria-controls={`${tabId}-panel`}
            aria-selected={page === item.id}
            id={`${tabId}-${item.id}`}
            key={item.id}
            role="tab"
            tabIndex={page === item.id ? 0 : -1}
            type="button"
            onClick={() => setPage(item.id)}
            onKeyDown={event => {
              let next: number
              if (event.key === 'ArrowRight') next = (index + 1) % pages.length
              else if (event.key === 'ArrowLeft') next = (index + pages.length - 1) % pages.length
              else if (event.key === 'Home') next = 0
              else if (event.key === 'End') next = pages.length - 1
              else return
              event.preventDefault()
              setPage(pages[next].id)
              const buttons = event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]')
              buttons[next].focus()
            }}
          >{item.label}</button>
        ))}
      </div>
      <div aria-labelledby={`${tabId}-${page}`} id={`${tabId}-panel`} role="tabpanel">
        {page === 'general' ? props.general : (
          <div className={styles.layout}>
            <div className={styles.controls}>
              {page === 'background' ? (
                <>
                  <label className={styles.switchRow}>
                    <span><strong>跟随 AI 场景切换</strong><small>关闭后使用人工背景，保留世界中的背景选择。</small></span>
                    <input type="checkbox" role="switch" checked={props.followState} onChange={event => props.onFollowStateChange(event.target.checked)} />
                  </label>
                  <label className={styles.search}>
                    <span>搜索背景</span>
                    <input type="search" placeholder="名称、描述或来源" value={query} onChange={event => setQuery(event.target.value)} />
                  </label>
                  <div className={styles.resourceHeader}>
                    <span>{visible.length} 个背景</span>
                    <button aria-pressed={props.selectedId === null} type="button" onClick={() => props.onSelect(null)}>不使用人工背景</button>
                  </div>
                  <div className={styles.grid}>
                    {visible.map(item => (
                      <button
                        aria-label={`选择背景：${item.name}`}
                        aria-pressed={props.selectedId === item.id}
                        className={styles.card}
                        key={item.id}
                        type="button"
                        onClick={() => props.onSelect(item.id)}
                      >
                        <span className={styles.thumbnail}>
                          <img alt="" src={item.image} />
                          {props.selectedId === item.id ? <span className={styles.selected}><Check aria-hidden="true" size={14} /></span> : null}
                        </span>
                        <span className={styles.cardText}>
                          <strong>{item.name}</strong>
                          <span>{item.description}</span>
                          <small>{item.source}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                  {visible.length === 0 ? <p className={styles.empty}>{query ? '没有匹配的背景' : '暂无可用背景'}</p> : null}
                </>
              ) : (
                <>
                  <fieldset className={styles.modeChoices}>
                    <legend>表面模式</legend>
                    {(['solid', 'translucent', 'glass'] as const).map(mode => (
                      <label key={mode}>
                        <input name={`${tabId}-mode`} type="radio" checked={props.material.mode === mode} onChange={() => props.onMaterialChange({ ...props.material, mode })} />
                        {modes[mode]}
                      </label>
                    ))}
                  </fieldset>
                  <label className={styles.range}>
                    <span>模糊强度 <output>{props.material.blur}px</output></span>
                    <input aria-label="模糊强度" disabled={props.material.mode !== 'glass'} max={32} min={0} type="range" value={props.material.blur} onChange={event => props.onMaterialChange({ ...props.material, blur: Number(event.target.value) })} />
                  </label>
                  <label className={styles.range}>
                    <span>表面不透明度 <output>{props.material.opacity}%</output></span>
                    <input aria-label="表面不透明度" disabled={props.material.mode === 'solid'} max={100} min={0} type="range" value={props.material.opacity} onChange={event => props.onMaterialChange({ ...props.material, opacity: Number(event.target.value) })} />
                  </label>
                  <p className={styles.note}>毛玻璃开启时关闭实色渐隐遮罩；关闭时恢复。文字、普通分隔线和操作指示不变。</p>
                  {!current ? <p className={styles.note}>当前没有背景。选择图片后更容易观察模糊效果，材质设置会保留。</p> : null}
                </>
              )}
            </div>
            <aside className={styles.preview}>
              <header><ImageIcon aria-hidden="true" size={15} /><strong>效果预览</strong></header>
              <MaterialScene background={current} material={props.material} />
              <dl className={styles.summary}>
                <div><dt>人工背景</dt><dd>{current?.name ?? '无'}</dd></div>
                <div><dt>来源</dt><dd>{current?.source ?? '—'}</dd></div>
                <div><dt>场景跟随</dt><dd>{props.followState ? '开启' : '关闭'}</dd></div>
              </dl>
              <button className={styles.materialLink} type="button" onClick={() => setPage(page === 'material' ? 'background' : 'material')}>
                <SlidersHorizontal aria-hidden="true" size={14} />{page === 'material' ? '选择背景' : `调整材质 · ${modes[props.material.mode]}`}
              </button>
            </aside>
          </div>
        )}
      </div>
    </section>
  )
}

function MaterialScene(props: { background?: BackgroundOption; material: MaterialValue }) {
  const glass = props.material.mode === 'glass'
  const variables = {
    '--loom-material-blur': `${glass ? props.material.blur : 0}px`,
    '--loom-material-fill-opacity': `${props.material.mode === 'solid' ? 100 : props.material.opacity}%`,
    '--loom-solid-fade-display': glass ? 'none' : 'block',
  } as CSSProperties

  return (
    <div className={styles.scene} data-material-mode={props.material.mode} style={variables}>
      {props.background ? <img alt="" className={styles.sceneBackground} src={props.background.image} /> : null}
      <div className={styles.sceneContent}>
        <header className={styles.material}>四方世界 <small>场景预览</small></header>
        <div className={styles.reading}>
          <p>沿着河岸向前走，远处的灯光在水面轻轻摇晃。</p>
          <article className={styles.material}>
            <strong>可滚动的阅读面板</strong>
            <div className={styles.scrollText}>
              <p>文字保持清晰，表面底色与模糊强度分别控制。</p>
              <p>开启毛玻璃后，上下实色渐隐不会覆盖背景。</p>
              <p>滚动这块区域，可以检查内容和材质背板的关系。</p>
            </div>
          </article>
          <details className={styles.solidPanel}>
            <summary>展开实色面板</summary>
            <p>需要稳定可读性的区域仍使用实色。</p>
          </details>
        </div>
        <footer className={styles.material}>继续你的故事…</footer>
      </div>
    </div>
  )
}
