import { createFrameRequestClient, type ClientNotification, type ClientRendererContext, type LoomSandboxRendererInput, type LoomSandboxRendererWireContext, type IframeRequestResult } from '@loom-studio/extension-sdk'
import type { JsonValue } from '@loom-studio/shared'
import { mountIsolatedFrame } from '../../../shared/iframe-runtime/frame-lifecycle.js'
import { isFrameRecord, serveFrameRequests } from '../../../shared/iframe-runtime/frame-channel.js'
import { boundFrameHeight, observeFrameSize } from '../../../shared/iframe-runtime/frame-size.js'
import { readClientNotification } from '../../../shared/extension-renderer-runtime/renderer-notifications.js'

export type LoomSandboxRendererInstanceOptions = {
  contributionId: string
  declaredContributionIds: readonly string[]
  grantedCapabilities: readonly string[]
  inputs: readonly LoomSandboxRendererInput[]
  scriptDocumentId: string
  documentVersion: number
  source: string
  stateRead(target: { scope: 'global' } | { scope: 'timeline'; timelineId: string; branchId: string }): Promise<JsonValue>
  notify?(input: ClientNotification): void | Promise<void>
  onClose(): void
  onDiagnostic(input: { code: string; message: string }): void
}

export function mountLoomSandboxRenderer(root: HTMLElement, context: ClientRendererContext, options: LoomSandboxRendererInstanceOptions) {
  const instanceId = crypto.randomUUID()
  const channel = new MessageChannel()
  let ready = false
  let disposed = false
  let currentContext = toWireContext(context, options, options.inputs)
  const requests = serveFrameRequests(channel.port1, {
    async handle(method, params) {
      const capability = method === 'state.read' ? 'state.read' : method === 'notifications.show' ? 'ui.notify' : undefined
      const result = await resolveLoomSandboxCapability({ capability, input: params }, options.grantedCapabilities, options.stateRead, options.notify)
      if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code })
      return result.value
    },
    onInvalidMessage: () => options.onDiagnostic({ code: 'renderer.sandbox_failed', message: 'Invalid iframe request envelope' }),
  })
  channel.port1.addEventListener('message', event => {
    const message: unknown = event.data
    if (disposed || !isFrameRecord(message) || message.instanceId !== instanceId) return
    if (message.type === 'loom.renderer.ready' && !ready) {
      ready = true
      instance.markReady()
      post({ type: 'loom.renderer.bootstrap', protocolVersion: 1, instanceId, context: currentContext })
    } else if (message.type === 'loom.renderer.close') {
      options.onClose()
    } else if (message.type === 'loom.renderer.resize') {
      const height = boundFrameHeight(message.height)
      if (height !== undefined) instance.frame.style.height = `${height}px`
    } else if (message.type === 'loom.renderer.diagnostic'
      && typeof message.code === 'string' && typeof message.message === 'string') {
      options.onDiagnostic({ code: message.code.slice(0, 128), message: message.message.slice(0, 4000) })
    }
  })
  const instance = mountIsolatedFrame(root, {
    title: `Loom Script Renderer: ${options.contributionId}`,
    source: { html: createBootstrapHtml(options) },
    onLoad: ({ frame }) => frame.contentWindow?.postMessage({ type: 'loom.renderer.connect', instanceId }, '*', [channel.port2]),
    onFailure: message => {
      dispose()
      options.onDiagnostic({ code: 'renderer.sandbox_failed', message })
    },
  })
  instance.frame.dataset.loomScriptRendererFrame = instanceId
  function post(message: unknown) { if (!disposed) channel.port1.postMessage(message) }
  function dispose() {
    if (disposed) return
    post({ type: 'loom.renderer.dispose', instanceId })
    disposed = true
    requests.dispose()
    channel.port1.close()
    channel.port2.close()
    // ponytail: Host unmount cannot await arbitrary guest cleanup. Guest dispose
    // is best-effort; host resources and capabilities are revoked synchronously.
    instance.dispose()
  }
  return {
    update(nextContext: ClientRendererContext, inputs = options.inputs) {
      currentContext = toWireContext(nextContext, options, inputs)
      if (ready) post({ type: 'loom.renderer.update', instanceId, context: currentContext })
    },
    dispose,
  }
}

export async function resolveLoomSandboxCapability(
  request: unknown,
  grantedCapabilities: readonly string[],
  stateRead: LoomSandboxRendererInstanceOptions['stateRead'],
  notify?: LoomSandboxRendererInstanceOptions['notify'],
): Promise<IframeRequestResult> {
  if (!isFrameRecord(request) || (request.capability !== 'state.read' && request.capability !== 'ui.notify')) {
    return { ok: false, error: { code: 'capability.invalid_request', message: 'Unknown capability request' } }
  }
  if (!grantedCapabilities.includes(request.capability)) {
    return { ok: false, error: { code: 'capability.denied', message: `Capability ${request.capability} is not granted` } }
  }
  try {
    if (request.capability === 'ui.notify') {
      const notification = readClientNotification(request.input)
      if (!notify) throw new Error('Notification host is unavailable')
      await notify(notification)
      return { ok: true, value: null }
    }
    const target = isFrameRecord(request.input) ? request.input.target : undefined
    if (!isFrameRecord(target) || (target.scope !== 'global' && !(target.scope === 'timeline'
      && typeof target.timelineId === 'string' && target.timelineId.length > 0
      && typeof target.branchId === 'string' && target.branchId.length > 0))) {
      return { ok: false, error: { code: 'capability.invalid_request', message: 'Invalid state.read target' } }
    }
    return { ok: true, value: await stateRead(target.scope === 'global' ? { scope: 'global' } : {
      scope: 'timeline', timelineId: target.timelineId as string, branchId: target.branchId as string,
    }) }
  } catch (error) {
    return { ok: false, error: {
      code: isFrameRecord(error) && typeof error.code === 'string' ? error.code : 'capability.failed',
      message: error instanceof Error ? error.message : String(error),
    } }
  }
}

function toWireContext(context: ClientRendererContext, options: LoomSandboxRendererInstanceOptions, inputs: readonly LoomSandboxRendererInput[]): LoomSandboxRendererWireContext {
  return {
    identity: { scriptDocumentId: options.scriptDocumentId, documentVersion: options.documentVersion, contributionId: options.contributionId },
    surface: context.surface,
    scope: structuredClone(context.scope),
    ...(context.part ? { part: structuredClone(context.part) } : {}),
    inputs: structuredClone([...inputs]),
    host: structuredClone(context.host),
  }
}

export function createBootstrapHtml(input: Pick<LoomSandboxRendererInstanceOptions, 'source' | 'contributionId' | 'declaredContributionIds'>): string {
  const config = JSON.stringify(input).replaceAll('<', '\\u003c')
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'"><body><script type="module">
const config=${config};
let port,instanceId,renderer,client,stopSize,closing=false,queue=Promise.resolve();
const diagnostic=(code,error)=>port.postMessage({type:'loom.renderer.diagnostic',instanceId,level:'error',code,message:String(error?.message??error)});
function connect(event){
  if(event.source!==parent||event.data?.type!=='loom.renderer.connect'||typeof event.data.instanceId!=='string'||!event.ports[0]||port)return;
  removeEventListener('message',connect);
  instanceId=event.data.instanceId;port=event.ports[0];
  client=(${createFrameRequestClient.toString()})(port);
  port.addEventListener('message',onHostMessage);
  const sourceUrl=URL.createObjectURL(new Blob([config.source],{type:'text/javascript'}));
  queue=import(sourceUrl).then(module=>{
    const renderers=module.renderers;
    const actual=renderers&&typeof renderers==='object'?Object.keys(renderers).sort():[];
    const declared=[...config.declaredContributionIds].sort();
    if(JSON.stringify(actual)!==JSON.stringify(declared))throw new Error('Renderer exports do not match declared contributions');
    renderer=renderers[config.contributionId];
    if(!renderer||typeof renderer.mount!=='function')throw new Error('Invalid renderer export');
    port.postMessage({type:'loom.renderer.ready',instanceId});
  }).catch(error=>diagnostic('renderer.script_export_mismatch',error)).finally(()=>URL.revokeObjectURL(sourceUrl));
}
addEventListener('message',connect);
function onHostMessage(event){
  const message=event.data;if(!message||message.instanceId!==instanceId||closing)return;
  if(!['loom.renderer.bootstrap','loom.renderer.update','loom.renderer.dispose'].includes(message.type))return;
  if(message.type==='loom.renderer.dispose'){closing=true;client.dispose();}
  queue=queue.then(async()=>{
    if(message.type==='loom.renderer.bootstrap'){
      const root=document.createElement('div');root.dataset.loomScriptRendererRoot='true';document.body.replaceChildren(root);
      stopSize=(${observeFrameSize.toString()})(height=>port.postMessage({type:'loom.renderer.resize',instanceId,height}));
      await renderer.mount(root,context(message.context));
    }else if(message.type==='loom.renderer.update'){await renderer.update?.(context(message.context));}
    else {try{await renderer?.dispose?.();}finally{stopSize?.();port.close();}}
  }).catch(error=>diagnostic('renderer.sandbox_failed',error));
}
function context(value){
  const theme=value.host?.themeSnapshot;
  if(theme?.version===1){document.documentElement.style.colorScheme=theme.colorScheme;for(const [name,value] of Object.entries(theme.tokens))document.documentElement.style.setProperty(name,value);}
  return {...value,close:()=>port.postMessage({type:'loom.renderer.close',instanceId}),
    notifications:{show:async input=>{await client.request('notifications.show',input);}},
    capabilities:{request:request=>request?.capability==='state.read'?client.request('state.read',request.input):request?.capability==='ui.notify'?client.request('notifications.show',request.input):Promise.reject(new Error('Unknown capability'))}};
}
</script>`
}
