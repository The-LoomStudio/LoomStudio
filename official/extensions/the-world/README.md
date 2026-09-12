# The World

> **状态**：Deferred / 工程骨架

The World 的 Loom Studio 官方扩展目录。当前只建立包身份与工程边界，迁移排在较后阶段；没有可运行功能，没有复制 ST 源码或素材。

```text
the-world/
├── package.json          # workspace 包身份，暂不声明依赖与构建产物
├── manifest.json         # Manifest v2，当前 modules 为空
├── src/
│   ├── client/           # 未来的面板、地图与背景 Renderer
│   └── server/           # 未来的世界状态、工具及提示词投影接线
├── resources/            # 未来的声明式资源
├── assets/               # 未来的图片、主题、音频等素材
└── docs/
    └── migration-discussion.md
```

迁移判断、依赖与开放问题见 [迁移讨论](docs/migration-discussion.md)。该讨论不是已批准实施 Plan。

仓库已经扫描 `official/extensions/*`，workspace 也已经包含此目录层级。包可能出现在 Catalog，但没有模块、权限请求或资源贡献，不会执行功能。Official 表示维护来源，不赋予额外权限或自动启用资格。

`0.0.0` 是骨架版本，不是正式发行。进入实现时按真实入口添加模块声明、依赖、构建配置与命令；当前不提供空 activate、虚假 dist 路径或空跑测试。Client 构建须适配浏览器加载，不能只照搬 Server 的 TypeScript 编译配置。
