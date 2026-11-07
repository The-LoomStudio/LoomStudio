# Resource downloads

`createResourceDownloadService` owns backend-only acquisition, staging, task receipts and update discovery. It does not install, import, authorize or activate resources. Register platform adapters through the host's authorized adapter bridge, initialize at server start and close at shutdown.

- `resolve` returns opaque candidate IDs and safe display metadata. Ambiguous adapters are returned for explicit selection. `start` accepts only a resolved candidate ID.
- `list` / `get` expose progress; `cancel` aborts the network/child process; `retry` starts a fresh transfer. No byte-range resume is claimed. Signed URLs remain in memory; after restart they require source resolution again.
- `prepareDependencies` reads staged extension Manifests, including safely inspected embedded Card archives, and prepares dependency candidates. Card adoption-only references without URLs remain visible as unresolved; preset packages without a dependency declaration return an explicit unsupported result. Scope and declaring package are preserved; embedded does not mean installed. The installation layer still owns compatibility and graph validation.
- `readArtifact` is server-only and returns a local artifact path / validated package directory. Never expose these filesystem paths through RPC.
- `track` must run only after successful adoption and requires a verified Manifest release version. Download completion does not imply adoption. Card/preset ZIPs can carry manifest.release { id, version, update?: { manifestUrl } }; it is verified against the selected candidate. Existing formats without release metadata remain manually importable, not silently enrolled in version tracking. A candidate that promises a release version cannot silently accept an unverifiable legacy package.
- `checkUpdates` checks adopted sources using Manifest SemVer, defaults to a 24-hour interval and supports explicit checks. It distinguishes unsupported/unavailable/failed from current. Ignore/acknowledgement state is persisted independently of resource contents. Safe resolved candidates retain their IDs and targets across restart; signed targets are regenerated for the same selected version. Tracking identity includes adapter, source origin, resource kind/ID and optional local targetId. A declared update Manifest never silently changes the original source association.
- HTTPS and Git fetching reuse `extension-download.ts` address/redirect/size protection. Git output is staged as an installable archive; author build scripts never run. Source adapter registration does not grant arbitrary network or resource-write access.

State lives under the configured staging directory. Incomplete work becomes interrupted on restart; completed files remain for explicit subsequent actions. Automatic staging retention/GC is not implemented. GitHub repository pages first read the optional root Manifest distribution declaration and return its recommended candidate; only a missing declaration permits ordinary discovery without it. Public GitHub release discovery is bounded to its first 30 releases; release attachments must be supported archives and source-code archives are not guessed to be built artifacts. Other Git providers need a declared update Manifest or an adapter for automatic version discovery.

## 作者与平台接入

扩展仍使用根 `manifest.json` 的 `id`、`version` 和模块入口。`version` 是 SemVer，Git commit / SHA256 是产物身份，不替代版本号。无需构建的仓库可以直接包含入口文件；需要构建的包只需发布运行文件，不要求上传 `src`，也不强制入口目录叫 `dist`。

可选的分发声明放在同一个 Manifest：

```json
{
  "distribution": { "kind": "release", "provider": "github", "repository": "author/work", "asset": "work.zip" },
  "update": { "manifestUrl": "https://example.org/work/manifest.json" }
}
```

`distribution` 也可为 `{ "kind": "git", "url": "https://github.com/author/work.git", "ref": "main" }` 或 `{ "kind": "url", "url": "https://example.org/work.zip" }`。检查 Manifest 必须能确定同一作品的发布版本和下载目标；不执行作者的构建命令。直接粘贴 GitHub 仓库首页时优先推荐声明的发行物，明确版本／Git 引用仍尊重用户选择。

原生 Card／预设 Artifact 使用 `metadata.release`，打包器将其写入 ZIP Manifest 的 `release`，例如 `{ "id": "author.fog-harbor", "version": "1.2.0", "update": { "manifestUrl": "https://example.org/fog/manifest.json" } }`。`release.id` 和作者节点 ID 在后续版本中应稳定。新导入保存内部来源映射，更新保持 SQL 身份；旧包无法证明映射时只支持另行导入，不猜测同名节点。玩家另存个人副本会清除发行来源。

第三方平台的全局 Server 扩展声明 `resources.provide`，用 `ctx.resourceSources.register` 注册带包名前缀的 adapter ID，以及认领的精确 HTTPS hostname / pathPrefix。`resolve` 返回候选，`prepare` 可在实际下载前取得同一版本的新签名链接，`check` 返回新版候选或 null。宿主执行下载、校验、暂存和采用；推荐作品、平台页面等仍由扩展自行提供。多个适配器认领时用户选择，停用后来源变为不可用而已导入内容保留。

`ctx.resourceSources.credentials.get/set/remove` 使用宿主 SecretStore，按包隔离；扩展卸载不自动注销平台账号。当前通用下载器不接受任意认证 Header，私有平台可凭安全存储的凭据换取短期 HTTPS 下载地址。Server 扩展仍是受信任的可执行代码，这些能力检查不代表 JS 沙箱。

## 作者 State 迁移

在有效 `timeline.run` 作用域内，具有 `state.read` + `state.contribute` 的扩展可调用 `ctx.state.definitions(target)` 获取自身已采用绑定及定义版本；`state.write` + `state.contribute` 可调用 `ctx.state.migrate`。输入携带当前 State revision、定义版本、幂等键，以及已有绑定的新 Schema 和作者转换后的值。宿主校验归属与结果，原子更新定义、创建当前分支的新修订；不会遍历历史或其他分支。

Schema 是现有受支持的 JSON Schema 子集，未知约束明确报错，`x-*` 可作编辑器注解；不是 Zod 可执行对象。定义仍为 Timeline 共用：旧分支和历史值不被改写，但后续写入面对新定义，作者需要在切换后的正常使用路径处理兼容。宿主不承诺新脚本能读取所有旧存档。


## 采用与更新边界

`updatePolicy` 只保存预发布／暂停策略，不重登记来源；固定 Tag／commit 的 `sourcePinned` 不可通过开关解除。`dependencyTarget` 在候选、任务、来源记录和后续检查中保持，角色私有依赖通过 `previewUse(id, cardId)` 绑定明确的角色及其版本，确认后只附加归档，不调用全局安装器。

Card 更新的确认 fingerprint 同时绑定暂存包字节与 Runtime 审阅结果。脚本按包内稳定 metadataId 识别，保留玩家设置、禁用和授权；新增声明不会自动采用。载荷、内嵌扩展归档只更新本包可证明拥有的引用，用户另行附加的内容保留。内嵌归档仍要在角色扩展面板安装／更新，保存归档不代表 ZIP 内部声明已通过安装校验。

头像和背景可采用包内文件，或勾选保留当前媒体；不做图片 Diff。媒体在 Card CAS 前写入 AssetStore，CAS 失败可能留下未引用资产，清理由共享资产生命周期处理。State 模板、无稳定源身份的旧规则、独立预设的附件更新仍明确阻止，不能把它们当作纯文本自动覆盖。
