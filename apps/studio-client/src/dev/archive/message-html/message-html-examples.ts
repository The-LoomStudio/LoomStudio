// Archived acceptance fixtures; reused by regression tests, not production UI.
const theme = `
*{box-sizing:border-box}html{color-scheme:light}body{margin:0;font:14px/1.65 system-ui,sans-serif;color:#25322e;background:#f8faf9}
.sheet{padding:22px}header{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid #dce4df;padding-bottom:16px}
h2{font-size:22px;line-height:1.3;margin:4px 0}p{margin:8px 0}small,.muted{color:#63756d;font-size:12px}
.tag{color:#27654f;background:#e0eee6;padding:3px 9px;border-radius:4px;white-space:nowrap}
.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;padding:20px 0;border-bottom:1px solid #dce4df}
.stats strong{font-size:24px;display:block;font-weight:600}.stats small{display:block}progress{width:100%;height:5px;accent-color:#418468;display:block;margin-top:8px}
.danger{color:#ac5044}.note{border-left:3px solid #d99a68;padding-left:12px;margin:20px 0}
details{border-top:1px solid #dce4df;padding:12px 0}summary{cursor:pointer;font-weight:600}ul{padding-left:20px;margin-bottom:0}
button{border:1px solid #b9cec1;background:#e7f0e9;color:#26593e;padding:7px 13px;border-radius:4px;cursor:pointer;font:inherit}
button:hover{background:#d6e8db}button:disabled{opacity:.5;cursor:default}button:focus-visible,summary:focus-visible{outline:2px solid #327256;outline-offset:3px}
footer{display:flex;justify-content:space-between;align-items:center;gap:12px;border-top:1px solid #dce4df;padding-top:14px;margin-top:10px}
@media(max-width:420px){.sheet{padding:14px}.stats{gap:10px}.stats strong{font-size:20px}header{align-items:flex-start}.tag{white-space:normal}}
`

const statusTemplate = `<section class="sheet">
<style>${theme}</style>
<header><div><small>雾港档案 / 第十二日 · 21:40</small><h2>$1</h2><span class="muted">调查员 · 旧港区钟表店</span></div><span class="tag">同行中</span></header>
<div class="stats">
<div><small>体力</small><strong><span id="stamina">$2</span><small>/ 100</small></strong><progress id="energy" value="$2" max="100"></progress></div>
<div><small>信任</small><strong>$3<small>保持戒备</small></strong><progress value="$3" max="100"></progress></div>
<div><small>异常感知</small><strong class="danger">偏高<small>附近存在回响</small></strong><progress value="74" max="100"></progress></div>
</div>
<div class="note"><small>当前心绪</small><p>她没有松开你的袖口，却始终避开橱窗里那只停摆的怀表。</p></div>
<details><summary>随身物品 · 3</summary><ul><li>旧钥匙 <small>齿口还残留着盐霜</small></li><li>录音笔 <small>剩余电量 42%</small></li><li>未拆封的信 <small>署名已被雨水洇开</small></li></ul></details>
<footer><small id="action-result" role="status">短暂休息可恢复体力</small><button id="rest" type="button">休息片刻</button></footer>
<script>
document.getElementById('rest').addEventListener('click', () => {
  const value = Math.min(100, Number(document.getElementById('stamina').textContent) + 8);
  document.getElementById('stamina').textContent = String(value);
  document.getElementById('energy').value = value;
  document.getElementById('action-result').textContent = '体力恢复，雨声渐渐平息。';
  document.getElementById('rest').disabled = value === 100;
});
</script>
</section>`

export type MessageHtmlExample = { id: string; label: string; format: string; value: string; raw?: string }

export function messageHtmlExamples(image: string): MessageHtmlExample[] {
  const raw = '<Status>\n姓名:林霁\n体力:68\n信任:42\n</Status>'
  const status = raw.replace(/<Status>\n姓名:(.*?)\n体力:(\d+)\n信任:(\d+)\n<\/Status>/s, statusTemplate)
  return [
    {
      id: 'status', label: '角色状态栏', format: 'Display · 非围栏 HTML', raw,
      value: `雨声盖过了最后一班电车。林霁在钟表店门前停下，把那封信重新收进外套。\n\n${status}\n\n“里面有人。”她轻声说。\n\n橱窗里的灯忽然亮了一下。不是整间店重新通了电，只是柜台后方那盏绿色的小台灯，仿佛有人用指尖碰了碰开关。林霁退到门框的阴影里，示意你先别出声。雨水沿着招牌的裂缝落下，在你们之间敲出一串不规则的节拍。\n\n她从口袋里取出录音笔，没有按下播放，只把侧面的指示灯转向你。微弱的红点正在闪烁。这支录音笔原本没有装入电池，而她清楚地记得，自己在离开旅馆之前已经把它关掉了。\n\n门内传来一声很轻的金属碰撞。随后，那只停在二十一点十七分的怀表，开始向后走。她终于抬起头看你，等待你决定是推门，还是带着这段新录下的声音离开。`,
    },
    {
      id: 'fenced', label: 'HTML 代码块', format: '原生 HTML · 围栏',
      value: `她把随身终端递给你，屏幕上仍然保留着出发前的记录。\n\n\`\`\`html\n${status}\n\`\`\`\n\n你可以先确认装备，再决定是否推门。`,
    },
    {
      id: 'reasoning', label: '折叠推演摘要', format: '安全 HTML 片段 · 无 iframe',
      value: `门锁没有被撬过，但门缝里的盐渍是新留下的。\n\n<details>\n<summary>推演摘要 · 三条线索</summary>\n<p><small>调查记录 / 21:42</small></p>\n<ol><li><strong>门锁完好：</strong>来人有钥匙，或者店主主动开过门。</li><li><strong>盐渍潮湿：</strong>鞋底刚接触过海水，时间不会太久。</li><li><strong>怀表停在 21:17：</strong>与断电记录一致，应优先核对后门监控。</li></ol>\n</details>\n\n她建议先绕到店后的窄巷，暂时不要惊动里面的人。`,
    },
    {
      id: 'foreshadow', label: '隐藏伏笔', format: '安全 HTML 片段 · 嵌套折叠',
      value: `你把旧钥匙放在桌上。她的目光停了一瞬，很快又移向窗外。\n\n<details>\n<summary>未揭示线索 · 钥匙上的刻痕</summary>\n<p>钥匙背面刻着一个极浅的“七”。那不是序号，而是钟楼第七层维修间的标记。</p>\n<details><summary>查看关联伏笔</summary><p><small>第三日，她曾说自己从未登上钟楼。但维修间门后的签名，与信封上的笔迹一致。</small></p></details>\n</details>\n\n街角的钟又响了。这一次，只有六声。`,
    },
    {
      id: 'gallery', label: '消息内图片画廊', format: '内嵌附件 · 外链权限未开放',
      value: `终端里收到一张旧照片，背面只有一行日期。\n\n<div class="sheet">
<style>${theme}figure{margin:18px 0 12px}img{display:block;width:100%;height:auto;object-fit:contain;border-radius:4px}figcaption{font-size:12px;color:#63756d;margin-top:8px}.compact{max-width:420px;margin-inline:auto}h2{font-size:18px}</style>
<header><div><small>附件 / 01</small><h2>旅途中的照片</h2></div><button id="zoom" type="button" aria-pressed="false">展开图片</button></header>
<figure id="photo" class="compact"><img src="${image}" alt="蓝天与原野中的角色插画" width="640" height="438"><figcaption>角色插画 · 本地内嵌副本</figcaption></figure>
<details><summary>照片背面的字迹</summary><p>“风停下来的时候，记得回来。”</p></details>
<script>document.getElementById('zoom').addEventListener('click', event => {
  const expanded = document.getElementById('photo').classList.toggle('compact') === false;
  event.currentTarget.textContent = expanded ? '收起图片' : '展开图片';
  event.currentTarget.setAttribute('aria-pressed', String(expanded));
});</script>
</div>\n\n照片下面，还有一条未发送的消息。`,
    },
  ]
}

// Embedded attachment bytes are not model tokens; replay them atomically.
export function nextPreviewStreamOffset(value: string, offset: number, step = 64): number {
  let next = Math.min(value.length, offset + step)
  const imageStart = value.indexOf('data:' + 'image/', offset)
  if (imageStart >= offset && imageStart < next) {
    const end = value.indexOf('"', imageStart)
    if (end !== -1) next = end + 1
  }
  return next
}
