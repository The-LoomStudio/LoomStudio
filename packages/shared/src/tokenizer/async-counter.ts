import { applyTokenMultiplier, TOKEN_INPUT_LIMIT, TOKEN_QUEUE_LIMIT, type TextTokenCounter } from './contracts.js';

export function createTextTokenCounter(signal: AbortSignal): TextTokenCounter {
  // ponytail: BPE is synchronous; cap extension inputs until server work needs isolation.
  let pending = 0;
  return {
    async countText(input) {
      signal.throwIfAborted();
      if (typeof input.text !== 'string' || input.text.length > TOKEN_INPUT_LIMIT) {
        throw new RangeError(`Token input limit is ${TOKEN_INPUT_LIMIT} characters`);
      }
      applyTokenMultiplier(0, input.multiplier);
      if (pending >= TOKEN_QUEUE_LIMIT) throw new RangeError('Token counting queue is full');
      pending += 1;
      try {
        const { countText } = await import('./index.js');
        signal.throwIfAborted();
        return countText(input.text, input);
      } finally {
        pending -= 1;
      }
    },
  };
}
