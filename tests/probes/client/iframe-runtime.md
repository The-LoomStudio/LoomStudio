# iframe 客观诊断

这个入口不属于活动 UI Preview，也不读写后端、真实扩展授权或业务数据。它挂载正式 RendererSurfaceHost、Loom Script Runtime、HTML Preview；通知使用纯文本测试接收器，不调用系统通知。

先在仓库根目录构建作者侧 SDK 测试包：

```sh
node --input-type=module -e "import { build } from 'vite'; await build({configFile:false,build:{lib:{entry:'packages/extension-sdk/src/iframe-context.ts',name:'LoomIframe',formats:['iife'],fileName:()=> 'iframe-sdk.generated.js'},outDir:'tests/probes/client/.generated',emptyOutDir:false}})"
```

使用客户端 Vite 服务打开 `/@fs/<仓库绝对路径>/tests/probes/client/iframe-runtime.html`。建议诊断时关闭 HMR，避免并行任务构建 SDK 引发入口重执行；不要把热更新遗留实例的超时误判成正式实例失败。`.generated/` 是忽略的构建产物。

检查：

- 扩展显示 `SDK connected`；两个 Loom Script 在 mount 等待期间读取假的 Global State，宿主立即触发输入更新。最终顺序为 `mount-start,mount-end,update-N`，不能在 mount 完成前执行 update。
- 更新输入后，两者的 `update-N` 数字递增，不重新 mount。
- 扩展和脚本按钮可发送测试通知；同一 owner 在 10 秒内第四次通知返回 `ctx.rate_limited`。
- 展开脚本内容后 iframe 高度增长；普通消息替换 body 后高度变为 420px。
- 导航按钮只导航测试 iframe 到 `about:blank`，宿主随后移除该 iframe 并报告连接撤销。
- 撤销脚本授权会销毁旧实例，重建后的通知返回 `capability.denied`；撤销扩展授权立即移除扩展 iframe。
- 卸载全部后扩展／脚本 iframe 消失，普通消息 HTML 不受影响。
- 相邻消息界面：长文档随内容展开，不设展示高度上限，两块 iframe 之间为 12px，无展开按钮；切换 760／360px 容器宽度不重建 iframe。
- 长代码宽度：正式 RendererNodeMountHost 内的长 token 不得撑宽 article，pre 单独横向滚动并保留 article 的 20px 右侧内边距；Wrap 后 pre 不再横向溢出。

这不是完整角色卡、移动端或主观视觉验收。SDK 使用打包后的普通脚本，避免将 Vite 开发模块的 opaque-origin CORS 问题与生产 SDK 协议混为一谈。
