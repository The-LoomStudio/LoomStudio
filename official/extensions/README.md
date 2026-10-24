# 官方扩展目录

本目录保存并直接提供由 Loom Studio 主仓库维护的官方内容。默认开发与发行入口将 `official/extensions/` 作为 repository 来源加载，用户安装包仍保存在根目录 `extensions/`；官方包不再复制到用户安装目录。显式指定扩展来源目录或安装目录的入口沿用自定义来源，不自动加入官方目录。

开发默认发现本目录中所有现有包，包括 `themes/`（`official.themes`）以及本地存在的 `backgrounds/`（`official.backgrounds`）。背景目录整体被 Git 忽略，不随 Git clone 提供。源码修改目前需要服务重新发现或重启，没有文件级 HMR。官方包不能通过扩展中心删除式卸载；模块可以停用，主题与增强可以取消采用。官方目录与用户安装目录出现相同包 ID 时会报告来源冲突，不能用安装副本覆盖官方源码。

“官方”表示维护方，不表示全部随程序分发。当前发行包仍仅携带 `loom-assistant` 与 `story-memory`，不携带主题和背景包；实际随包内容以 `scripts/release/prepare-release.mjs` 为准。

`story-memory` 提供剧情总结扩展与一个可编辑的总结 Preset，LV1/LV2 规则由任务条件选择。默认入口仅对 `loom-assistant` 与 `story-memory` 执行首次 setup，包括资源导入和剧情总结 server/client 模块的默认启用；其他官方包仅被发现，不自动授权代码或采用外观。模型由用户在总结 Preset 中配置。

首次 setup 不会授予额外事件、资源或通知权限。已有模块选择优先，之后继续使用扩展中心的持久启用状态，重启不会重新开启用户已停用的模块。发现和启用不等于采用，老 Timeline 不会被自动采用，也不会因此自动触发模型。

## 独立发行的可选扩展

以下扩展由各自的独立仓库维护，本目录不保留源码或构建副本：

- STBridge：[LS_STBridge](https://github.com/The-LoomStudio/LS_STBridge)，安装后位于应用根目录 `extensions/`。
- The World：[LS_The_World](https://github.com/The-LoomStudio/LS_The_World)，安装后位于应用根目录 `extensions/`。

用户在官方扩展选择或扩展中心确认后下载，安装、授权与启用分别执行。推荐地址由 `apps/studio-server/src/extensions/extension-manager.ts` 维护。

独立扩展以自己的仓库源码为基准。Git 安装不运行构建，因此扩展仓库需同时交付 Manifest、资源与对应源码构建出的完整 `dist/`；源码变更后重新构建，不单独手改 `dist/`。本地开发可放在根目录 `extensions/`，修改应提交到对应独立仓库，不能复制回本目录形成另一份实现。
