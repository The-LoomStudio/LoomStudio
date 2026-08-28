# 历史 Discussion 与里程碑规格

本目录保存已经被当前 Architecture 取代、对应实现已删除，或只用于回溯早期 MVP / M0 决策的讨论稿。

这些文档已经冻结，不再作为当前施工或实现合同。当前事实优先级为：

```text
当前代码与测试
  -> docs/architecture
  -> docs/workbench 中仍标记 Active / Open 的文档
  -> 本目录
```

## 归档内容

- `whitepaper-v0.md`、`studio-repository-engineering-v0.md`、`studio-dependency-and-runtime-choices-v0.md`、`studio-initial-package-api-v0.md`、`loom-studio-mvp-engineering.md`、`studio-mvp-development-plan.md`、`studio-config-and-local-state-v0.md` — 早期愿景、仓库与 MVP 施工阶段；
- `application/m0-backend-slice-v0.md` — 已删除的旧 Session / submitTurn M0 切片；
- `application/composition-pipeline-v0.md` — 已被当前 PromptBuild Architecture 取代的候选 M0 pipeline；
- `kernel/studio-transport-protocol-v0.md`、`kernel/studio-rpc-methods-v0.md` — WebSocket-only 与伪事件订阅旧协议；
- `extensions/studio-extension-manifest-architecture.md`、`extensions/studio-extension-lifecycle-v0.md` — Manifest v1 与旧单体 Extension 生命周期。

仍有价值但尚未晋升的残余问题，应在 Workbench 中建立窄 Discussion / Plan，不继续修改本目录中的历史正文。
