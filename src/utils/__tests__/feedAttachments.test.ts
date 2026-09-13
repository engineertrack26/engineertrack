import { isValidLink, attachmentsPayload } from '@/utils/feedAttachments';

describe('isValidLink', () => {
  it('accepts http and https URLs with a host', () => {
    expect(isValidLink('https://a.b/c')).toBe(true);
    expect(isValidLink('http://x.y')).toBe(true);
  });

  it('rejects a bare domain without a scheme', () => {
    expect(isValidLink('www.x.y')).toBe(false);
  });

  it('rejects non-http schemes', () => {
    expect(isValidLink('javascript:alert(1)')).toBe(false);
    expect(isValidLink('file:///etc/passwd')).toBe(false);
  });

  it('rejects a scheme with no host', () => {
    expect(isValidLink('https://')).toBe(false);
  });

  it('trims surrounding whitespace before checking', () => {
    expect(isValidLink(' https://a.b ')).toBe(true);
  });
});

describe('attachmentsPayload', () => {
  it('returns an empty array for an empty draft', () => {
    expect(attachmentsPayload({})).toEqual([]);
  });

  it('emits one entry per present kind in photo, document, link order', () => {
    const out = attachmentsPayload({
      link: { url: 'https://a.b', title: 'A' },
      document: { path: 'g/1/brief.pdf', name: 'brief.pdf', mime: 'application/pdf', size: 12 },
      photo: { path: 'g/1/p.jpg', mime: 'image/jpeg', size: 3, name: 'p.jpg' },
    });
    expect(out.map((a) => a.kind)).toEqual(['photo', 'document', 'link']);
    expect(out[0]).toEqual({ kind: 'photo', target: 'g/1/p.jpg', name: 'p.jpg', mime: 'image/jpeg', size: 3 });
    expect(out[1]).toEqual({ kind: 'document', target: 'g/1/brief.pdf', name: 'brief.pdf', mime: 'application/pdf', size: 12 });
    expect(out[2]).toEqual({ kind: 'link', target: 'https://a.b', name: 'A' });
  });

  it('omits absent kinds', () => {
    expect(attachmentsPayload({ document: { path: 'd', name: 'd.pdf', mime: 'application/pdf' } }))
      .toEqual([{ kind: 'document', target: 'd', name: 'd.pdf', mime: 'application/pdf', size: undefined }]);
  });

  it('trims the link url and turns an empty title into undefined', () => {
    const out = attachmentsPayload({ link: { url: '  https://a.b/x  ', title: '   ' } });
    expect(out).toEqual([{ kind: 'link', target: 'https://a.b/x', name: undefined }]);
  });

  it('leaves the link title undefined when none was given', () => {
    expect(attachmentsPayload({ link: { url: 'https://a.b' } })[0].name).toBeUndefined();
  });
});
