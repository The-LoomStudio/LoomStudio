import type {
  ClientRendererContext,
  LoomSandboxFrameMessage,
  LoomSandboxHostMessage,
  LoomSandboxRendererInput,
  LoomSandboxRendererWireContext,
} from '@loom-studio/extension-sdk'
import type { JsonValue } from '@loom-studio/shared'

export type LoomSandboxRendererInstanceOptions = {
  contributionId: string
  declaredContributionIds: readonly string[]
  grantedCapabilities: readonly string[]
  inputs: readonly LoomSandboxRendererInput[]
  scriptDocumentId: string
  documentVersion: number
  source: string
  stateRead(target: { scope: 'global' } | { scope: 'timeline'; timelineId: string; branchId: string }): Promise<JsonValue>
  onClose(): void
  onDiagnostic(input: { code: string; message: string }): void
}

export function mountLoomSandboxRenderer(
  root: HTMLElement,
  context: ClientRendererContext,
  options: LoomSandboxRendererInstanceOptions,
): { update(context: ClientRendererContext, inputs?: readonly LoomSandboxRendererInput[]): void; dispose(): void } {
  const instanceId = globalThis.crypto?.randomUUID?.() ?? `loom-renderer-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const sourceUrl = URL.createObjectURL(new Blob([options.source], { type: 'text/javascript' }))
  const htmlUrl = URL.createObjectURL(new Blob([createBootstrapHtml({
    contributionId: options.contributionId,
    declaredContributionIds: options.declaredContributionIds,
    sourceUrl,
  })], { type: 'text/html' }))
  const frame = document.createElement('iframe')
  const channel = new MessageChannel()
  let ready = false
  let disposed = false
  let currentContext = toWireContext(context, options, options.inputs)

  frame.title = `Loom Script Renderer: ${options.contributionId}`
  frame.sandbox.add('allow-scripts')
  frame.referrerPolicy = 'no-referrer'
  frame.dataset.loomScriptRendererFrame = instanceId
  frame.src = htmlUrl
  channel.port1.onmessage = event => {
    const message = event.data as LoomSandboxFrameMessage
    if (disposed || !message || message.instanceId !== instanceId) return
    if (message.type === 'loom.renderer.ready') {
      ready = true
      post({ type: 'loom.renderer.bootstrap', protocolVersion: 1, instanceId, context: currentContext })
      return
    }
    if (message.type === 'loom.renderer.close') {
      options.onClose()
      return
    }
    if (message.type === 'loom.renderer.diagnostic') {
      options.onDiagnostic({ code: message.code, message: message.message })
      return
    }
    if (message.type === 'loom.renderer.capability-request') {
      void resolveCapability(message)
    }
  }
  channel.port1.start()
  frame.addEventListener('load', () => {
    frame.contentWindow?.postMessage({ type: 'loom.renderer.connect', instanceId }, '*', [channel.port2])
  }, { once: true })
  root.replaceChildren(frame)

  function post(message: LoomSandboxHostMessage): void {
    if (!disposed) channel.port1.postMessage(message)
  }

  async function resolveCapability(message: Extract<LoomSandboxFrameMessage, { type: 'loom.renderer.capability-request' }>): Promise<void> {
    const result = await resolveLoomSandboxCapability(message.request, options.grantedCapabilities, options.stateRead)
    if (!disposed) post({ type: 'loom.renderer.capability-result', instanceId, requestId: message.requestId, result })
  }

  return {
    update(nextContext, inputs = options.inputs) {
      currentContext = toWireContext(nextContext, options, inputs)
      if (ready) post({ type: 'loom.renderer.update', instanceId, context: currentContext })
    },
    dispose() {
      if (disposed) return
      post({ type: 'loom.renderer.dispose', instanceId })
      disposed = true
      channel.port1.close()
      frame.remove()
      URL.revokeObjectURL(htmlUrl)
      URL.revokeObjectURL(sourceUrl)
    },
  }
}

export async function resolveLoomSandboxCapability(
  request: Extract<LoomSandboxFrameMessage, { type: 'loom.renderer.capability-request' }>['request'],
  grantedCapabilities: readonly string[],
  stateRead: LoomSandboxRendererInstanceOptions['stateRead'],
): Promise<Extract<LoomSandboxHostMessage, { type: 'loom.renderer.capability-result' }>['result']> {
  if (request.capability !== 'state.read' || !grantedCapabilities.includes('state.read')) {
    return { ok: false, error: { code: 'capability.denied', message: 'Capability state.read is not granted' } }
  }
  try {
    return { ok: true, value: await stateRead(request.input.target) }
  } catch (error) {
    return { ok: false, error: { code: 'capability.failed', message: error instanceof Error ? error.message : String(error) } }
  }
}

function toWireContext(
  context: ClientRendererContext,
  options: LoomSandboxRendererInstanceOptions,
  inputs: readonly LoomSandboxRendererInput[],
): LoomSandboxRendererWireContext {
  return {
    identity: {
      scriptDocumentId: options.scriptDocumentId,
      documentVersion: options.documentVersion,
      contributionId: options.contributionId,
    },
    surface: context.surface,
    scope: structuredClone(context.scope),
    ...(context.part ? { part: structuredClone(context.part) } : {}),
    inputs: structuredClone([...inputs]),
    host: structuredClone(context.host),
  }
}

function createBootstrapHtml(input: {
  contributionId: string
  declaredContributionIds: readonly string[]
  sourceUrl: string
}): string {
  const config = JSON.stringify(input).replaceAll('<', '\\u003c')
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; connect-src 'none'"><body><script type="module">
const config=${config};
let port,instanceId,renderer,root,pending=new Map();
const diagnostic=(code,message)=>port.postMessage({type:'loom.renderer.diagnostic',instanceId,level:'error',code,message});
addEventListener('message',async event=>{
  if(event.data?.type!=='loom.renderer.connect'||!event.ports[0]||port)return;
  instanceId=event.data.instanceId;port=event.ports[0];port.onmessage=onHostMessage;port.start();
  try{
    const module=await import(config.sourceUrl);const renderers=module.renderers;
    const actual=renderers&&typeof renderers==='object'?Object.keys(renderers).sort():[];
    const declared=[...config.declaredContributionIds].sort();
    if(JSON.stringify(actual)!==JSON.stringify(declared))throw new Error('Loom Script renderer exports do not match metadata: expected '+declared.join(', ')+', received '+actual.join(', '));
    renderer=renderers[config.contributionId];
    if(!renderer||typeof renderer.mount!=='function')throw new Error('Renderer export is invalid: '+config.contributionId);
    port.postMessage({type:'loom.renderer.ready',instanceId});
  }catch(error){diagnostic('renderer.script_export_mismatch',error instanceof Error?error.message:String(error));}
},{once:true});
async function onHostMessage(event){
  const message=event.data;if(!message||message.instanceId!==instanceId)return;
  if(message.type==='loom.renderer.capability-result'){
    const request=pending.get(message.requestId);if(!request)return;pending.delete(message.requestId);
    message.result.ok?request.resolve(message.result.value):request.reject(new Error(message.result.error.message));return;
  }
  try{
    if(message.type==='loom.renderer.bootstrap'){
      root=document.createElement('div');root.dataset.loomScriptRendererRoot='true';document.body.replaceChildren(root);
      await renderer.mount(root,context(message.context));
    }else if(message.type==='loom.renderer.update'&&renderer.update){await renderer.update(context(message.context));}
    else if(message.type==='loom.renderer.dispose'){await renderer.dispose?.();pending.forEach(item=>item.reject(new Error('Renderer disposed')));pending.clear();port.close();document.body.replaceChildren();}
  }catch(error){diagnostic('renderer.sandbox_failed',error instanceof Error?error.message:String(error));}
}
function context(value){return {...value,capabilities:{request(request){const requestId=crypto.randomUUID();return new Promise((resolve,reject)=>{pending.set(requestId,{resolve,reject});port.postMessage({type:'loom.renderer.capability-request',instanceId,requestId,request});});}}};}
</script>`
}
