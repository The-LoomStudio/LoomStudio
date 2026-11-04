# 依赖补丁

## sonner@2.0.7

LoomStudio只提供瞬时通知，不使用Sonner的无限历史。补丁在依赖自身的dismiss生命周期移除退休记录及其回调，并清理dismissed-ID记录；保留活动通知按ID更新、操作按钮及原Toaster退场流程。

ESM与CommonJS发布入口均已修改，由package.json和pnpm-lock.yaml通过pnpm可复现地应用。业务代码不在运行时改getHistory()或私有数组。行为回归见tests/unit/client/notification-retention.test.ts，包含真实Toaster自然到期。

此策略使getHistory()仅包含未退休记录；应用没有需要退休历史的消费者。升级Sonner时需复核补丁，若上游提供等价正式退休策略即可移除。已运行Vite的旧预构建缓存不会因此自动保证更新，应在重启开发服务或新构建后验收；不要为此擅自刷新有草稿的用户页。
