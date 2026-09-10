'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import type { MediaItem, RegisterMediaRequest } from '@romp/contracts';
import { Button, Field } from '@romp/ui';

import { ApiError, adminApi } from '@/lib/api';
import { uploadToPath } from '@/lib/firebase-client';
import { mediaUrl } from '@/lib/store';

/**
 * The product media manager.
 *
 * Upload is a two-step dance that keeps the API off the file's bytes: the API allocates an
 * object path and records a pending entry (`registerMedia`), then the browser uploads the
 * file straight to that path with the Storage SDK, gated by the security rules. The
 * object-finalize Function then re-derives the type from the bytes and either confirms the
 * entry with its real dimensions or quarantines it. So a freshly uploaded image shows as
 * pending until finalize runs — which is honest, and why the list reflects the stored
 * entries rather than an optimistic guess.
 *
 * `alt` is required before upload, because every product image needs alt text and asking for
 * it after the file is chosen is the reliable moment to get it.
 */

const ALLOWED: Record<string, RegisterMediaRequest['contentType']> = {
  'image/jpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/avif': 'image/avif',
};

export function MediaManager({
  productId,
  media,
}: {
  readonly productId: string;
  readonly media: readonly MediaItem[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [alt, setAlt] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = (): void => {
    const file = fileRef.current?.files?.[0];
    if (file === undefined) {
      setError('Choose a file to upload.');
      return;
    }
    const contentType = ALLOWED[file.type];
    if (contentType === undefined) {
      setError('That file type is not allowed. Use JPEG, PNG, WebP or AVIF.');
      return;
    }
    if (alt.trim().length === 0) {
      setError('Enter alt text for the image.');
      return;
    }

    setUploading(true);
    setError(null);
    void adminApi
      .registerMedia(productId, { alt: alt.trim(), contentType })
      .then(async (slot) => {
        const ok = await uploadToPath(slot.path, file, contentType);
        if (!ok) {
          throw new ApiError(500, 'INTERNAL', 'Media host is not configured.');
        }
        setAlt('');
        if (fileRef.current !== null) fileRef.current.value = '';
        router.refresh();
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : 'The upload failed.');
      })
      .finally(() => {
        setUploading(false);
      });
  };

  const sorted = [...media].sort((left, right) => left.order - right.order);

  return (
    <section aria-labelledby="media-heading" className="flex flex-col gap-4">
      <h2 id="media-heading" className="font-display text-xl text-text-primary">
        Media
      </h2>

      {sorted.length === 0 ? (
        <p className="font-body text-sm text-text-muted">No images yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {sorted.map((item) => {
            const url = mediaUrl(item.path);
            const pending = item.width <= 1 && item.height <= 1;
            return (
              <li key={item.path} className="flex flex-col gap-1">
                <span className="flex size-24 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-alt">
                  {url === null ? (
                    <span className="font-body text-xs text-text-muted">No preview</span>
                  ) : (
                    <img src={url} alt={item.alt} className="size-full object-cover" />
                  )}
                </span>
                <span className="font-body text-xs text-text-muted">
                  {item.order === 0 ? 'Cover' : `#${String(item.order + 1)}`}
                  {pending ? ' · processing' : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-3 rounded-md border border-border p-4">
        <Field
          label="Alt text"
          hint="Describe the image for screen readers."
          value={alt}
          onChange={(event) => {
            setAlt(event.target.value);
          }}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="font-body text-sm text-text-primary"
        />
        {error !== null ? (
          <p role="alert" className="font-body text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div>
          <Button type="button" loading={uploading} onClick={upload}>
            Upload image
          </Button>
        </div>
      </div>
    </section>
  );
}
