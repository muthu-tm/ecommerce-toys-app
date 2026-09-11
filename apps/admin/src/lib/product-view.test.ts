import { describe, expect, it } from 'vitest';

import { statusLabel, statusTone } from './product-view';

describe('statusTone', () => {
  it('maps each status to a tone', () => {
    expect(statusTone('active')).toBe('success');
    expect(statusTone('draft')).toBe('neutral');
    expect(statusTone('archived')).toBe('warning');
  });
});

describe('statusLabel', () => {
  it('gives a human label for each status', () => {
    expect(statusLabel('active')).toBe('Published');
    expect(statusLabel('draft')).toBe('Draft');
    expect(statusLabel('archived')).toBe('Archived');
  });
});
