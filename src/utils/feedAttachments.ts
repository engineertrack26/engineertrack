import type { FeedAttachmentKind } from '@/types/feed';

/** What the composer holds while an announcement is being written: one
 *  slot per kind. Photo and document hold the STORAGE PATH returned by
 *  feedService.uploadFeedAttachment, which is what the row stores; the
 *  link is the URL as typed. */
export interface AttachmentDraft {
  photo?: { path: string; mime: string; size?: number; name?: string };
  document?: { path: string; name: string; mime: string; size?: number };
  link?: { url: string; title?: string };
}

export interface AttachmentInput {
  kind: FeedAttachmentKind;
  target: string;
  name?: string;
  mime?: string;
  size?: number;
}

/** http(s) only, with a host. Rejects javascript:, file:, bare words. */
export function isValidLink(url: string): boolean {
  const s = url.trim();
  if (!/^https?:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    return !!u.hostname;
  } catch {
    return false;
  }
}

/** The RPC's p_attachments array, in a fixed order, omitting absent kinds. */
export function attachmentsPayload(draft: AttachmentDraft): AttachmentInput[] {
  const out: AttachmentInput[] = [];
  if (draft.photo) {
    out.push({ kind: 'photo', target: draft.photo.path, name: draft.photo.name, mime: draft.photo.mime, size: draft.photo.size });
  }
  if (draft.document) {
    out.push({ kind: 'document', target: draft.document.path, name: draft.document.name, mime: draft.document.mime, size: draft.document.size });
  }
  if (draft.link) {
    out.push({ kind: 'link', target: draft.link.url.trim(), name: draft.link.title?.trim() || undefined });
  }
  return out;
}
