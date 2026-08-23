import type { PhotoEvidence, DocumentEvidence } from '@/types/assignment';

/** The camelCase -> snake_case boundary for submit_assignment's evidence
 *  parameters.
 *
 *  submit_assignment reads these with jsonb_to_recordset, which matches JSON
 *  keys to COLUMN names and is case-sensitive. A `fileName` key therefore lands
 *  as a NULL `file_name`, and the RPC drops rows with a null NOT NULL field
 *  rather than aborting the submission -- so the document would simply vanish,
 *  with no error on either side. This module is the one place that conversion
 *  happens, and it is tested. */
export function toPhotoPayload(photos: PhotoEvidence[]): unknown[] {
  return photos.map((p) => ({ uri: p.uri, caption: p.caption ?? null }));
}

export function toDocumentPayload(docs: DocumentEvidence[]): unknown[] {
  return docs.map((d) => ({
    uri: d.uri,
    file_name: d.fileName,
    file_type: d.fileType,
    file_size: d.fileSize,
  }));
}
