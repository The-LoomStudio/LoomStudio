export interface TokenCountOptions {
  multiplier?: number;
}

export interface TokenCountBasis {
  encoding: 'o200k_base';
  implementation: 'gpt-tokenizer';
  implementationVersion: '4.0.0';
  algorithm: 'literal-text-v1';
  multiplier: number;
}

export interface TokenCount {
  baseTokens: number;
  estimatedTokens: number;
  basis: TokenCountBasis;
}

export interface TextTokenCounter {
  countText(input: { text: string; multiplier?: number }): Promise<TokenCount>;
}

export const TOKEN_INPUT_LIMIT = 1_000_000;
export const TOKEN_QUEUE_LIMIT = 32;

export function applyTokenMultiplier(baseTokens: number, multiplier = 1): TokenCount {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new RangeError('Token multiplier must be finite and positive');
  }
  const estimatedTokens = Math.ceil(baseTokens * multiplier);
  if (!Number.isSafeInteger(baseTokens) || baseTokens < 0 || !Number.isSafeInteger(estimatedTokens)) {
    throw new RangeError('Token count exceeds the safe integer range');
  }
  return {
    baseTokens,
    estimatedTokens,
    basis: {
      encoding: 'o200k_base',
      implementation: 'gpt-tokenizer',
      implementationVersion: '4.0.0',
      algorithm: 'literal-text-v1',
      multiplier,
    },
  };
}
export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}
