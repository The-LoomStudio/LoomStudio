export function scriptCapabilityLabel(capability: string): string {
  if (capability === 'runtime.client') return '信任客户端代码（同进程，可直接访问页面）'
  if (capability === 'runtime.client-worker') return '信任浏览器 Worker 代码（独立线程、无直接 DOM 访问，仍可使用浏览器网络与存储，不是安全沙箱）'
  if (capability === 'runtime.server') return '信任服务端代码（同进程，可访问 Node 环境）'
  return capability
}
