import { describe, expect, it } from 'vitest';

import { RateLimitedError } from '@romp/observability';

import { createRateLimiter } from './rate-limit';

describe('createRateLimiter', () => {
  const rule = { limit: 3, windowSeconds: 60 };

  it('allows up to the limit within a window', () => {
    const limiter = createRateLimiter(() => 0);
    expect(() => {
      limiter.consume('k', rule);
      limiter.consume('k', rule);
      limiter.consume('k', rule);
    }).not.toThrow();
  });

  it('throws once the limit is exceeded, with a retry-after', () => {
    const limiter = createRateLimiter(() => 0);
    limiter.consume('k', rule);
    limiter.consume('k', rule);
    limiter.consume('k', rule);

    try {
      limiter.consume('k', rule);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitedError);
      expect((error as RateLimitedError).retryAfterSeconds).toBe(60);
    }
  });

  it('resets after the window elapses', () => {
    let now = 0;
    const limiter = createRateLimiter(() => now);
    limiter.consume('k', rule);
    limiter.consume('k', rule);
    limiter.consume('k', rule);

    now = 60_001; // just past the window
    expect(() => {
      limiter.consume('k', rule);
    }).not.toThrow();
  });

  it('keys are independent', () => {
    const limiter = createRateLimiter(() => 0);
    limiter.consume('a', rule);
    limiter.consume('a', rule);
    limiter.consume('a', rule);
    // A different key has its own fresh window.
    expect(() => {
      limiter.consume('b', rule);
    }).not.toThrow();
  });

  it('sweep drops expired windows', () => {
    let now = 0;
    const limiter = createRateLimiter(() => now);
    limiter.consume('k', rule);
    now = 60_001;
    limiter.sweep();
    // After a sweep the key is fresh again — full budget.
    expect(() => {
      limiter.consume('k', rule);
      limiter.consume('k', rule);
      limiter.consume('k', rule);
    }).not.toThrow();
  });
});
