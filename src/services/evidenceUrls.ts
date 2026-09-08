import { supabase } from './supabase';
import type { PhotoEvidence, DocumentEvidence } from '@/types/assignment';

export const PHOTO_BUCKET = 'log-photos';
export const DOCUMENT_BUCKET = 'log-documents';

/** Long enough to open a document or scroll a review, short enough that a URL
 *  copied out of the app stops working. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/** Recover the object path from whatever was stored in the row.
 *
 *  Uploads write `getPublicUrl(...)` into `uri`, which is a URL that only
 *  resolves for a PUBLIC bucket. `log-photos` and `log-documents` are both
 *  created with `public = false` (docs/database-schema.sql:671-677), so those
 *  stored URLs are dead links -- they render as a blank image and open as an
 *  empty page. `avatars` is public, which is why the same upload pattern works
 *  there and hid this for so long.
 *
 *  The path is the durable part; the URL around it is not. This accepts a bare
 *  path, a public URL and an already-signed URL so it keeps working whatever a
 *  row happens to hold. */
export function extractStoragePath(urlOrPath: string, bucket: string): string {
  if (!urlOrPath) return '';
  if (!urlOrPath.startsWith('http')) {
    return urlOrPath.replace(new RegExp(`^${bucket}/`), '');
  }

  const markers = [
    `/object/public/${bucket}/`,
    `/object/sign/${bucket}/`,
    `/object/${bucket}/`,
  ];
  const marker = markers.find((m) => urlOrPath.includes(m));
  if (!marker) return '';

  const after = urlOrPath.split(marker)[1] || '';
  const path = after.split('?')[0] || '';
  return decodeURIComponent(path);
}

/** Swap a stored URL for a short-lived signed one.
 *
 *  Returns the original on any failure rather than throwing: a piece of
 *  evidence that will not load is worth far less than a review screen that
 *  will not open. */
async function sign(uri: string, bucket: string): Promise<string> {
  const path = extractStoragePath(uri, bucket);
  if (!path) return uri;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return uri;
  return data.signedUrl;
}

/** Sign a submission's evidence for display.
 *
 *  Signing has to happen at READ time, once per view: a signed URL expires, so
 *  storing one in the row would only move the broken-link problem into the
 *  future. */
export async function signEvidence(
  photos: PhotoEvidence[] = [],
  documents: DocumentEvidence[] = [],
): Promise<{ photos: PhotoEvidence[]; documents: DocumentEvidence[] }> {
  const [signedPhotos, signedDocuments] = await Promise.all([
    Promise.all(photos.map(async (p) => ({ ...p, uri: await sign(p.uri, PHOTO_BUCKET) }))),
    Promise.all(
      documents.map(async (d) => ({ ...d, uri: await sign(d.uri, DOCUMENT_BUCKET) })),
    ),
  ]);
  return { photos: signedPhotos, documents: signedDocuments };
}
