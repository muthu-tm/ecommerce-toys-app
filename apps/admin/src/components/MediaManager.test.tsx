import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MediaItem } from '@romp/contracts';

/**
 * The media manager's upload dance: register a slot through the API, then upload the file to
 * the returned path with the Storage SDK. Both are mocked so the browser SDK never loads. The
 * concern here is the validation before upload (alt text, allowed type) and that a successful
 * register+upload refreshes.
 */

const registerMedia = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ path: 'products/p1/x.webp' })),
);
const uploadToPath = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
const refresh = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  adminApi: { registerMedia },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/firebase-client', () => ({ uploadToPath }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { MediaManager } = await import('./MediaManager');

const pending: MediaItem = {
  path: 'products/p1/cover.webp',
  alt: 'A toy',
  width: 1,
  height: 1,
  blurhash: null,
  order: 0,
};

beforeEach(() => {
  registerMedia.mockClear();
  uploadToPath.mockClear();
  refresh.mockClear();
});

describe('MediaManager', () => {
  it('marks a 1x1 entry as processing', () => {
    render(<MediaManager productId="p1" media={[pending]} />);
    expect(screen.getByText(/processing/u)).toBeInTheDocument();
  });

  it('requires alt text before uploading', async () => {
    const user = userEvent.setup();
    render(<MediaManager productId="p1" media={[]} />);

    const file = new File([new Uint8Array([1, 2, 3])], 'toy.webp', { type: 'image/webp' });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, file);
    await user.click(screen.getByRole('button', { name: 'Upload image' }));

    expect(screen.getByText(/enter alt text/iu)).toBeInTheDocument();
    expect(registerMedia).not.toHaveBeenCalled();
  });

  it('registers a slot and uploads on a valid submission', async () => {
    const user = userEvent.setup();
    render(<MediaManager productId="p1" media={[]} />);

    await user.type(screen.getByLabelText(/Alt text/u), 'A tower of blocks');
    const file = new File([new Uint8Array([1, 2, 3])], 'toy.webp', { type: 'image/webp' });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, file);

    await user.click(screen.getByRole('button', { name: 'Upload image' }));

    await waitFor(() => {
      expect(registerMedia).toHaveBeenCalledWith('p1', {
        alt: 'A tower of blocks',
        contentType: 'image/webp',
      });
    });
    await waitFor(() => {
      expect(uploadToPath).toHaveBeenCalledWith('products/p1/x.webp', file, 'image/webp');
    });
  });
});
