import { value } from './value.js'
if (typeof document !== 'undefined' || !(self instanceof DedicatedWorkerGlobalScope)) throw new Error('Not a Worker')
export async function activate(ctx) {
  await ctx.notifications.show({ message: value })
}
