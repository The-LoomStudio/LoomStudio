import { countTokens, setMergeCacheSize } from 'gpt-tokenizer/encoding/o200k_base';
import { applyTokenMultiplier, type TokenCount, type TokenCountOptions } from './contracts.js';

// Avoid retaining fragments of user text in the library's merge cache.
setMergeCacheSize(0);
const literalOptions = { allowedSpecial: new Set<string>(), disallowedSpecial: new Set<string>() };

export function countText(text: string, options: TokenCountOptions = {}): TokenCount {
  applyTokenMultiplier(0, options.multiplier);
  return applyTokenMultiplier(countTokens(text, literalOptions), options.multiplier);
}

export { applyTokenMultiplier } from './contracts.js';
export type { TokenCount, TokenCountBasis, TokenCountOptions, TextTokenCounter } from './contracts.js';
