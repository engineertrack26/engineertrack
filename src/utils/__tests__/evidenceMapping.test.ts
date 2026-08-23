import { toPhotoPayload, toDocumentPayload } from '@/utils/evidenceMapping';

describe('toPhotoPayload', () => {
  it('emits uri and caption', () => {
    expect(toPhotoPayload([{ uri: 'https://x/a.jpg', caption: 'hi' }]))
      .toEqual([{ uri: 'https://x/a.jpg', caption: 'hi' }]);
  });

  it('emits a null caption rather than omitting the key', () => {
    expect(toPhotoPayload([{ uri: 'https://x/a.jpg' }]))
      .toEqual([{ uri: 'https://x/a.jpg', caption: null }]);
  });

  it('returns an empty array for no photos', () => {
    expect(toPhotoPayload([])).toEqual([]);
  });
});

describe('toDocumentPayload', () => {
  // The whole reason this module exists. jsonb_to_recordset matches on column
  // names, so a camelCase key lands as NULL in a NOT NULL column -- and the RPC
  // drops such rows silently, so the document disappears with no error.
  it('converts fileName/fileType/fileSize to snake_case', () => {
    expect(toDocumentPayload([
      { uri: 'https://x/a.pdf', fileName: 'a.pdf', fileType: 'application/pdf', fileSize: 42 },
    ])).toEqual([
      { uri: 'https://x/a.pdf', file_name: 'a.pdf', file_type: 'application/pdf', file_size: 42 },
    ]);
  });

  it('emits no camelCase keys at all', () => {
    const [row] = toDocumentPayload([
      { uri: 'u', fileName: 'n', fileType: 't', fileSize: 1 },
    ]) as Record<string, unknown>[];
    expect(Object.keys(row).some((k) => /[A-Z]/.test(k))).toBe(false);
  });

  it('returns an empty array for no documents', () => {
    expect(toDocumentPayload([])).toEqual([]);
  });
});
