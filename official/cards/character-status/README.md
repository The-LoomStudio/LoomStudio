# Character Status 完整样例

这是一个可导入的 Loom Card 样例，演示：

- Card 自有 Text Transform Rule；
- Card 自有 Text Extractor；
- Card 自带 `.loom.js` Renderer；
- 导入后默认关闭 Script Mount，用户确认能力后再启用；
- 通过正式 Card Bundle ZIP / PNG 编解码导出和导入。

生成 `.loomcard.zip`：

```bash
pnpm example:character-status
```

默认输出到 `.artifacts/character-status.loomcard.zip`。这个样例使用仓库内置的无内容占位头像，仅用于验证包结构和导入流程。

导入后，在叙事正文中加入以下内容即可看到状态数据：

```text
<CharacterStatus>HP: 100
Mood: calm</CharacterStatus>
```

Script Mount 默认没有启用，也没有任何能力授权。要显示状态面板，需要在导入后的 Card 上检查并启用它。
