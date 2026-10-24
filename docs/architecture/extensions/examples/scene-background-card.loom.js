// ==LoomScript==
// @format 1
// @id example.scene-background-card
// @name 场景背景卡
// @version 1.0.0
// @runtime client
// @capability assets.read
// @contribution {"kind":"renderer","id":"scene-card","name":"场景背景卡","surface":"narrative.timeline.tail","scope":"timeline","inputs":[]}
// ==/LoomScript==

// 作者可以修改这三项。图片通过宿主背景目录发现，不写死文件路径或版本。
const backgroundPackage = 'official.backgrounds'
const title = '下一幕，去哪里？'
const description = '翻阅场景，选择此刻故事的风景。这里只改变卡片，不修改工作台背景或剧情状态。'

export function activate(ctx) {
  return ctx.renderers.register({
    id: 'scene-card', name: '场景背景卡', surface: 'narrative.timeline.tail', instanceScope: 'timeline',
  }, {
    mount(root, renderContext) {
      const controller = new AbortController()
      const container = document.createElement('section')
      container.dataset.sceneBackgroundCard = ''
      // Shadow DOM 隔离卡片样式；Client 代码仍在主窗口运行，不是安全沙箱。
      const shadow = container.attachShadow({ mode: 'open' })
      shadow.innerHTML = `
        <style>
          :host { display:block; pointer-events:auto; color:var(--loom-color-text,#ccd6f5); font:inherit; }
          * { box-sizing:border-box; }
          article { overflow:hidden; border:1px solid var(--loom-color-border,#45475a); border-radius:16px; background:var(--loom-color-surface,#313244); }
          header,.content { padding:18px 20px; }
          header { display:flex; justify-content:space-between; align-items:center; gap:12px; }
          .eyebrow,summary,.counter { color:var(--loom-color-text-muted,#a6adc8); font-size:12px; }
          h3 { margin:5px 0 0; font-size:18px; font-weight:600; }
          p { margin:8px 0 0; line-height:1.65; }
          button { font:inherit; color:inherit; cursor:pointer; border:1px solid var(--loom-color-border,#45475a); background:var(--loom-color-surface-subtle,#3c3d50); border-radius:8px; padding:7px 12px; }
          button:hover:not(:disabled) { border-color:var(--loom-color-accent,#cba6f7); }
          button:focus-visible,summary:focus-visible { outline:2px solid var(--loom-color-accent,#cba6f7); outline-offset:3px; }
          button:disabled { opacity:.45; cursor:default; }
          .picture { display:block; width:100%; border:0; border-radius:0; padding:0; background:var(--loom-color-surface-inset,#181825); }
          .picture img { display:block; width:100%; height:clamp(180px,30vw,340px); object-fit:cover; }
          .navigation { display:flex; align-items:center; gap:8px; margin-top:16px; }
          .counter { flex:1; text-align:center; }
          .name { font-size:14px; overflow-wrap:anywhere; }
          .status { color:var(--loom-color-text-muted,#a6adc8); font-size:13px; }
          details { margin-top:18px; padding-top:12px; border-top:1px solid var(--loom-color-border,#45475a); }
          summary { cursor:pointer; }
          dl { font-size:12px; display:grid; grid-template-columns:5em 1fr; gap:8px; line-height:1.5; }
          dt { color:var(--loom-color-text-muted,#a6adc8); } dd { margin:0; overflow-wrap:anywhere; }
          dialog { width:min(1000px,92vw); max-height:90vh; border:1px solid var(--loom-color-border,#45475a); border-radius:12px; padding:12px; color:inherit; background:var(--loom-color-surface,#313244); }
          dialog::backdrop { background:rgb(0 0 0 / .7); }
          dialog img { display:block; max-height:72vh; width:100%; object-fit:contain; margin-top:12px; }
          [hidden] { display:none !important; }
          @media(max-width:480px) { header,.content { padding:14px; } h3 { font-size:16px; } }
        </style>
        <article aria-label="场景背景卡">
          <header><div><span class="eyebrow">场景手记</span><h3></h3></div><button type="button" data-action="reload">刷新资源</button></header>
          <button type="button" class="picture" data-action="expand" aria-label="展开场景大图" hidden><img alt=""></button>
          <div class="content">
            <div class="name"></div><p class="description"></p><p class="status" role="status" aria-live="polite"></p>
            <nav class="navigation" aria-label="切换场景"><button type="button" data-action="previous" aria-label="上一张场景">← 上一张</button><span class="counter"></span><button type="button" data-action="next" aria-label="下一张场景">下一张 →</button></nav>
            <details><summary>资源信息</summary><dl><dt>来源包</dt><dd data-field="package"></dd><dt>资源标识</dt><dd data-field="key"></dd><dt>图片地址</dt><dd data-field="url"></dd><dt>加载状态</dt><dd data-field="state"></dd></dl></details>
          </div>
        </article>
        <dialog aria-label="场景大图"><button type="button" data-action="close">关闭大图</button><img alt=""></dialog>`
      const $ = selector => shadow.querySelector(selector)
      $('h3').textContent = title
      $('.description').textContent = description
      const picture = $('.picture'), dialog = $('dialog')
      let images = [], index = 0, disposed = false
      let imageEvents
      function status(message) {
        $('.status').textContent = message
        $('[data-field="state"]').textContent = message
      }
      function close() { if (dialog.open) dialog.close() }
      function render() {
        imageEvents?.abort()
        close()
        const item = images[index]
        picture.hidden = !item
        $('[data-action="previous"]').disabled = images.length < 2
        $('[data-action="next"]').disabled = images.length < 2
        $('.counter').textContent = item ? `${index + 1} / ${images.length} · 点击图片展开` : '暂无场景'
        $('.name').textContent = item?.name ?? '没有找到可用背景'
        $('[data-field="package"]').textContent = item?.packageId ?? backgroundPackage
        $('[data-field="key"]').textContent = item?.key ?? '—'
        $('[data-field="url"]').textContent = item?.image ?? '—'
        if (!item) { picture.replaceChildren(); status('请安装或启用官方背景包，然后点击“刷新资源”。'); return }
        status('图片加载中…')
        const image = document.createElement('img')
        imageEvents = new AbortController()
        image.alt = item.description || item.name
        // 每次换图使用新节点，上一张图的迟到事件不会覆盖当前状态。
        const isCurrent = () => !disposed && picture.firstChild === image
        image.addEventListener('load', () => { if (isCurrent()) status('图片已加载') }, { signal: imageEvents.signal })
        image.addEventListener('error', () => { if (isCurrent()) status('图片加载失败，可切换图片或刷新资源。') }, { signal: imageEvents.signal })
        picture.replaceChildren(image)
        image.src = item.image
      }
      function reload() {
        try {
          const previous = images[index]?.key
          images = ctx.backgrounds.list().filter(item => item.packageId === backgroundPackage)
          index = Math.max(0, images.findIndex(item => item.key === previous))
          render()
        } catch (error) {
          images = []; index = 0; render()
          status(`无法读取背景资源：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      shadow.addEventListener('click', event => {
        const action = event.target.closest?.('[data-action]')?.dataset.action
        if (action === 'reload') reload()
        if (action === 'close') close()
        if ((action === 'previous' || action === 'next') && images.length) {
          index = (index + (action === 'next' ? 1 : -1) + images.length) % images.length
          render()
        }
        if (action === 'expand' && images[index]) {
          $('dialog img').src = images[index].image
          $('dialog img').alt = images[index].description || images[index].name
          dialog.showModal()
        }
      }, { signal: controller.signal })
      function dispose() {
        if (disposed) return
        disposed = true
        imageEvents?.abort()
        controller.abort()
        ctx.signal.removeEventListener('abort', dispose)
        renderContext.signal.removeEventListener('abort', dispose)
        close()
        container.remove()
      }
      ctx.signal.addEventListener('abort', dispose, { once: true })
      renderContext.signal.addEventListener('abort', dispose, { once: true })
      if (ctx.signal.aborted || renderContext.signal.aborted) dispose()
      else { root.append(container); reload() }
      return { dispose }
    },
  })
}
