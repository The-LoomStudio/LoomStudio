# Card 文件往返与导入完整性审查

日期：2026-09-22  
状态：Open Issues，待修复  
范围：Card 媒体上传、Bundle 文件投影、ZIP 编解码及媒体重新入库；不涉及 Agent/CodeActor 执行器。

本轮确认 2 项 P2。依据为当前包含未提交修改的工作区、正式文件化角色包文档和临时隔离探针。没有修改实现、真实数据库或用户文件，没有执行浏览器上传流程。

## CARD-FILE-001：允许上传的图片在 Bundle 往返中被错误标记为 PNG

优先级：P2  
证据等级：当前 Codec 与真实 SQLite/Blob/Asset Store 的临时目录探针。

### 调用链

- `apps/studio-client/src/widgets/character-panel/character-panel.tsx:252`：`replaceMedia` 允许所有 `image/` MIME；头像和背景文件选择器也使用 `image/*`。
- `apps/studio-client/src/features/cards/model/use-cards.ts:214`：上传时原样发送 `file.type`，不是客户端转码。
- `apps/studio-server/src/main.ts:492`：读取媒体时保留其 MIME 和字节；非 PNG 图片不进行转码。
- `apps/studio-server/src/codecs/card-bundle-zip.ts:351`：`extensionForMediaType` 只识别 JPEG、WebP、GIF，其他 MIME 默认使用 `.png`。
- 同文件 `:360`：读取时从扩展名推导 MIME，不恢复原 MIME。
- `packages/asset-store/src/store.ts:117`：同一内容 Blob 已有 MIME 时，导入另一 MIME 会抛出 `asset.media_type_mismatch`。

### 触发与影响

用户上传 SVG 作为 Card 头像或背景，媒体存储接受并保留 `image/svg+xml`。导出 ZIP 时，文件被命名为 `assets/avatar.png` 或 `assets/background.png`，但仍然是 SVG 字节。解码该 ZIP 得到相同字节及错误的 `image/png`。

在原数据库重新导入时，相同 hash 命中原 SVG Blob；Asset Store 检测到 MIME 不一致，拒绝导入。即使换一个没有该 Blob 的数据库，Codec 已经丢失原 MIME；新数据库的实际显示结果未做浏览器验证，不作为已复现结论。

PNG Bundle 和 Polyglot 导出也复用此 ZIP Codec，外层选择默认 PNG 封面不会修正内层媒体 MIME。这是静态调用链判断，未分别执行三种 HTTP 导出入口。

### 最小验证

第一项探针直接调用当前 `encodeCardBundleZip` 和 `decodeCardBundleZip`，使用合法的极小 SVG 文本及最小 Card Artifact，断言原始字节不变：

```json
{"before":"image/svg+xml","after":"image/png","bytesUnchanged":true}
```

第二项探针在系统临时目录创建 SQLite Data Engine、Blob Store、Asset Store，直接导入这三个 package 的当前源码入口：

1. 使用 `createMediaAsset` 正常保存 SVG；
2. 调用当前 ZIP Codec 导出并解码；
3. 使用解码后的字节与 MIME 再次创建媒体；
4. 断言失败码为 `asset.media_type_mismatch`。

两个探针均退出码 0；第二项结束时关闭 Engine 并删除临时目录。没有启动完整 Studio Server、运行浏览器或调用真实数据目录。

### 反证与边界

- PNG、JPEG、WebP、GIF 有显式映射，本项不声称这些格式的正常 MIME 往返失败。
- Asset Store 的冲突校验本身保护了数据契约，不应通过删除该校验掩盖 Codec 的错误。
- 此处 SVG 是用于复现 MIME 往返问题的最小合法输入，不把它扩展描述成已证实的脚本执行漏洞。
- 正式文档允许非 PNG 头像使用默认外层封面并在包内保留原图，没有说明可以把原图错误标记为 PNG。
- 媒体先于领域事务创建的非原子边界已在正式文档声明，本轮不将该已知限制重复登记为新发现。

### 修复方向与关闭条件

上传支持范围、文件扩展名映射和解码 MIME 必须遵守同一个契约。至少不能对未知格式成功导出一个伪装为 PNG 的文件；是完整保留当前允许的格式，还是缩小上传范围，实施前需明确产品支持范围，不能在本次只读审查中擅自决定。

关闭时验证当前支持格式的 MIME 与字节往返，以及同库重新导入。若选择拒绝部分格式，应在明确边界报错，不能通过修改 MIME 或静默替换原图宣称成功。测试应覆盖头像和背景共用路径；无需为了此问题引入通用媒体转换框架。

## CARD-FILE-002：ZIP 正文损坏且 CRC 不匹配时仍被接受

优先级：P2  
证据等级：当前完整 ZIP Codec 的单字节损坏探针，使用系统 ZIP 检查工具作独立对照。

### 调用链与影响

`apps/studio-server/src/codecs/card-bundle-zip.ts:225` 的 `unzipSafely` 检查路径、重复 entry、条目数量、声明大小和实际解压大小；`:262` 的回调完成后直接收集字节，没有验证 entry CRC。当前使用的解压路径也没有替调用方拒绝此次 CRC 错误。

因此，当用户文件的正文数据发生保持长度不变、仍是合法 UTF-8 的损坏时，容器解码成功，领域 Schema 也无法判断文本已损坏。`decodeCardBundleZip` 返回改变后的正文；HTTP 导入接线会将其继续交给媒体创建和领域导入，没有另一道原始 ZIP 完整性检查。

本项已经证明 Codec 错误接受损坏内容，没有实际执行损坏包的数据库导入；不将静态后续调用链描述为完整 Server 复现。

### 最小验证

使用当前 `encodeCardBundleFiles` 创建合法文件集合，再使用项目已有 `fflate.zipSync` 的 `level: 0` 生成 ZIP。未压缩 ZIP 是合法且当前解码器支持的输入，不是自定义格式。

将 `card/description.md` 中 `audit-original-content-12345` 的首字节从 `a` 改成 `X`，保留全部长度字段及原 CRC。随后：

1. 当前 `decodeCardBundleZip` 成功，返回 `Xudit-original-content-12345`；
2. 同一临时文件交给 `/usr/bin/unzip -t`，其检查失败并输出：

```text
testing: card/description.md      bad CRC 0a9584a8  (should be 2b6fe32d)
```

探针断言两项结果，退出码为 0；系统工具的非零状态被作为预期反例捕获，不算检查通过。临时 ZIP 和目录已删除，没有更改真实 Card。

### 反证与边界

- 现有字节预算、路径、重复 entry、UTF-8 和领域校验均有独立价值；不声称 ZIP 解码完全不校验输入。
- 本项是意外损坏检测，不是签名或来源认证。CRC 无法阻止主动修改内容并重算校验值的人，不能把增加 CRC 检查包装为恶意包认证方案。
- 压缩流解压成功、文本合法与字节数一致，都不能证明内容与 ZIP 记录的校验值一致。
- 探针只覆盖未压缩 entry 的单字节损坏，未执行全部压缩方法、流式数据描述符和 PNG 外层组合。

### 修复方向与关闭条件

在统一 ZIP Codec 中补齐 entry 完整性验证，优先利用项目既有 ZIP 能力，不在每个导入入口各写一套解析。保持现有增量解压预算，不以先无界解压再校验替代当前边界。

关闭时验证正常存储和 deflate ZIP 可导入、合法数据描述符 ZIP 仍受支持、正文同长度损坏和校验值错误在领域导入前失败。错误应明确指向损坏条目，不能静默接受或尝试把损坏 Loom 包当其他格式转换。
