import { describe, expect, it } from 'vitest';

import { sniffImageType } from './image';

/**
 * Byte-level image sniffing — the security-critical half of the finalize pipeline.
 *
 * It is what makes the declared content type stop mattering, so it is tested against a
 * crafted header for each allowed format and against the shapes it must reject (SVG, GIF,
 * truncated, and a near-miss that shares only a prefix).
 */

function riff(chunk: string): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  for (let i = 0; i < 4; i += 1) bytes[12 + i] = chunk.charCodeAt(i);
  return bytes;
}

describe('sniffImageType', () => {
  it('detects JPEG from FF D8 FF', () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });

  it('detects PNG from its 8-byte signature', () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    );
  });

  it('detects WebP from RIFF....WEBP', () => {
    expect(sniffImageType(riff('VP8 '))).toBe('image/webp');
  });

  it('detects AVIF from its ftyp box', () => {
    const avif = new Uint8Array([
      0x00, 0x00, 0x00, 0x0c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
    ]);
    expect(sniffImageType(avif)).toBe('image/avif');
  });

  it('detects the AVIF image-sequence brand (avis)', () => {
    const avis = new Uint8Array([
      0x00, 0x00, 0x00, 0x0c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x73,
    ]);
    expect(sniffImageType(avis)).toBe('image/avif');
  });

  it('rejects an SVG (a script container disguised as an image)', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(sniffImageType(svg)).toBeNull();
  });

  it('rejects a GIF', () => {
    expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull();
  });

  it('rejects empty or too-short input', () => {
    expect(sniffImageType(new Uint8Array())).toBeNull();
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  it('does not treat a PNG-signature-prefixed non-PNG as PNG', () => {
    // Right first byte, wrong rest — the full 8-byte signature must match.
    expect(
      sniffImageType(new Uint8Array([0x89, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])),
    ).toBeNull();
  });

  it('does not treat a RIFF that is not WEBP as an image', () => {
    const wav = new Uint8Array(16);
    wav.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
    wav.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
    expect(sniffImageType(wav)).toBeNull();
  });
});
