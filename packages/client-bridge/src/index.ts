import type { RpcRequest, RpcResponse } from '@loom-studio/transport'

export type ClientBridge = {
  request(request: RpcRequest): Promise<RpcResponse>
}
