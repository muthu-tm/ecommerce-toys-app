import { describe, expect, it } from 'vitest';

import { decideMediaFinalize } from './media-finalize';

/** A PNG header declaring the given dimensions. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  bytes.set([(width >> 24) & 0xff, (width >> 16) & 0xff, (width >> 8) & 0xff, width & 0xff], 16);
  bytes.set(
    [(height >> 24) & 0xff, (height >> 16) & 0xff, (height >> 8) & 0xff, height & 0xff],
    20,
  );
  return bytes;
}

// SOI, then an SOF0 frame declaring 100×100. sniff sees FF D8 FF; dimensions come from SOF.
const jpegBytes = new Uint8Array([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0, 100, 0, 100, 3, 0, 0, 0, 0, 0, 0,
]);

describe('decideMediaFinalize', () => {
  it('accepts a file whose bytes match the declared type', () => {
    const decision = decideMediaFinalize(png(800, 600), 'image/png');

    expect(decision.action).toBe('accept');
    if (decision.action === 'accept') {
      expect(decision.contentType).toBe('image/png');
    }
  });

  it('quarantines a file whose bytes are not an allowed image', () => {
    const svg = new TextEncoder().encode('<svg><script>alert(1)</script></svg>');
    const decision = decideMediaFinalize(svg, 'image/png');

    expect(decision.action).toBe('quarantine');
    if (decision.action === 'quarantine') {
      expect(decision.reason).toBe('not_an_allowed_image');
    }
  });

  it('quarantines a real image whose bytes differ from the declared type', () => {
    // Actually a PNG, but the upload claimed JPEG — the mismatch is the attack signal.
    const decision = decideMediaFinalize(png(10, 10), 'image/jpeg');

    expect(decision.action).toBe('quarantine');
    if (decision.action === 'quarantine') {
      expect(decision.reason).toBe('type_mismatch');
    }
  });

  it('accepts a JPEG whose bytes match', () => {
    const decision = decideMediaFinalize(jpegBytes, 'image/jpeg');

    expect(decision.action).toBe('accept');
    if (decision.action === 'accept') {
      expect(decision.contentType).toBe('image/jpeg');
    }
  });
});
