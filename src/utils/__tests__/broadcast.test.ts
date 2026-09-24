import { BROADCAST_MAX_BODY, BROADCAST_MAX_RECIPIENTS, broadcastFormError, broadcastSummary, toggleRecipient } from '@/utils/broadcast';

describe('broadcastFormError', () => {
  it('refuses an empty selection and an empty body', () => {
    expect(broadcastFormError([], 'Yarın 09:00')).toBe('errors.recipientsEmpty');
    expect(broadcastFormError(['a'], '   ')).toBe('errors.messageEmpty');
  });
  it('refuses more recipients or more characters than the server takes', () => {
    const many = Array.from({ length: BROADCAST_MAX_RECIPIENTS + 1 }, (_, i) => String(i));
    expect(broadcastFormError(many, 'x')).toBe('errors.tooManyRecipients');
    expect(broadcastFormError(['a'], 'x'.repeat(BROADCAST_MAX_BODY + 1))).toBe('errors.messageTooLong');
  });
  it('accepts a normal send', () => {
    expect(broadcastFormError(['a', 'b'], 'Yarınki saha ziyareti 09:00.')).toBeNull();
    expect(broadcastFormError(['a'], 'x'.repeat(BROADCAST_MAX_BODY))).toBeNull();
  });
});

describe('broadcastSummary', () => {
  it('reports a clean send', () => {
    expect(broadcastSummary({ sent: 5, failed: [] }))
      .toEqual({ key: 'messages.broadcastSent', params: { count: 5 } });
  });
  it('never hides a recipient who did not get it', () => {
    expect(broadcastSummary({ sent: 4, failed: [{ id: 'x', code: 'INTERNSHIP_CLOSED' }] }))
      .toEqual({ key: 'messages.broadcastPartial', params: { count: 4, failed: 1 } });
  });
  it('reports a send where nobody got it', () => {
    expect(broadcastSummary({ sent: 0, failed: [{ id: 'x', code: 'NOT_IN_GROUP' }] }))
      .toEqual({ key: 'messages.broadcastNoneSent', params: { count: 1 } });
  });
  it('survives a result with no failed array', () => {
    expect(broadcastSummary({ sent: 2 } as never))
      .toEqual({ key: 'messages.broadcastSent', params: { count: 2 } });
  });
});

describe('toggleRecipient', () => {
  it('adds in pick order and removes', () => {
    expect(toggleRecipient([], 'a')).toEqual(['a']);
    expect(toggleRecipient(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleRecipient(['a', 'b'], 'a')).toEqual(['b']);
  });
});
