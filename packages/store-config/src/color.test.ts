import { describe, expect, it } from 'vitest';

import {
  CONTRAST_THRESHOLDS,
  contrastRatio,
  formatContrastRatio,
  isHexColor,
  meetsContrast,
  parseHexColor,
  relativeLuminance,
} from './color';

describe('isHexColor', () => {
  it.each(['#fff', '#FFF', '#ffffff', '#d8fd4f', '#D8FD4F', '#ffffffff'])('accepts %s', (value) => {
    expect(isHexColor(value)).toBe(true);
  });

  it.each(['fff', '#ff', '#fffff', '#gggggg', 'rgb(0,0,0)', 'white', ''])('rejects %o', (value) => {
    expect(isHexColor(value)).toBe(false);
  });
});

describe('parseHexColor', () => {
  it('parses six-digit hex', () => {
    expect(parseHexColor('#d8fd4f')).toEqual({ r: 216, g: 253, b: 79 });
  });

  it('expands three-digit shorthand', () => {
    expect(parseHexColor('#f0a')).toEqual({ r: 255, g: 0, b: 170 });
    expect(parseHexColor('#fff')).toEqual(parseHexColor('#ffffff'));
  });

  it('ignores alpha, because contrast is computed against opaque surfaces', () => {
    expect(parseHexColor('#d8fd4f80')).toEqual(parseHexColor('#d8fd4f'));
  });

  it('is case-insensitive', () => {
    expect(parseHexColor('#D8FD4F')).toEqual(parseHexColor('#d8fd4f'));
  });

  it('throws on anything that is not a hex colour', () => {
    // Callers have already passed the schema, so a failure here is a bug.
    expect(() => parseHexColor('white')).toThrow(TypeError);
  });
});

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 10);
  });

  it('weights green most heavily, as the WCAG formula does', () => {
    const red = relativeLuminance({ r: 255, g: 0, b: 0 });
    const green = relativeLuminance({ r: 0, g: 255, b: 0 });
    const blue = relativeLuminance({ r: 0, g: 0, b: 255 });

    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
    expect(green).toBeCloseTo(0.7152, 4);
  });

  it('uses the linear segment for very dark channels', () => {
    // Channel 10 sits in the linear part of the curve: 10/255/12.92.
    expect(relativeLuminance({ r: 10, g: 10, b: 10 })).toBeCloseTo(10 / 255 / 12.92, 6);
  });
});

describe('contrastRatio', () => {
  it('is 21:1 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2);
  });

  it('is 1:1 for identical colours', () => {
    expect(contrastRatio('#d8fd4f', '#d8fd4f')).toBeCloseTo(1, 10);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#131417', '#f5f6f7')).toBeCloseTo(
      contrastRatio('#f5f6f7', '#131417'),
      10,
    );
  });

  it('matches the well-known AA boundary greys on white', () => {
    // #767676 is the darkest grey that passes AA normal text on white, and #949494
    // is a standard 3:1 large-text boundary. Getting these right is the evidence
    // that the implementation matches WCAG rather than merely looking plausible.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('#949494', '#ffffff')).toBeCloseTo(3.0, 1);
  });
});

describe('meetsContrast', () => {
  it('applies the AA normal-text threshold by default', () => {
    expect(meetsContrast('#767676', '#ffffff')).toBe(true);
    expect(meetsContrast('#777777', '#ffffff', 'aaNormal')).toBe(false);
  });

  it('applies a lower bar for large text and non-text', () => {
    expect(meetsContrast('#949494', '#ffffff', 'aaLarge')).toBe(true);
    expect(meetsContrast('#949494', '#ffffff', 'aaNonText')).toBe(true);
    expect(meetsContrast('#949494', '#ffffff', 'aaNormal')).toBe(false);
  });

  it('applies a higher bar for AAA', () => {
    expect(meetsContrast('#595959', '#ffffff', 'aaaNormal')).toBe(true);
    expect(meetsContrast('#767676', '#ffffff', 'aaaNormal')).toBe(false);
  });

  it('exposes the documented thresholds', () => {
    expect(CONTRAST_THRESHOLDS.aaNormal).toBe(4.5);
    expect(CONTRAST_THRESHOLDS.aaLarge).toBe(3);
    expect(CONTRAST_THRESHOLDS.aaNonText).toBe(3);
    expect(CONTRAST_THRESHOLDS.aaaNormal).toBe(7);
  });
});

describe('formatContrastRatio', () => {
  it('renders two decimals for failure messages', () => {
    expect(formatContrastRatio(4.5)).toBe('4.50:1');
    expect(formatContrastRatio(21)).toBe('21.00:1');
    expect(formatContrastRatio(3.14159)).toBe('3.14:1');
  });
});
