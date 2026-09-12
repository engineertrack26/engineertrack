import { filterReviews, PendingReview, reviewInitials, reviewNoteError, reviewSubmittedAt, reviewVersion } from '../mentorReviews';

function item(id: string, submittedAt: string, assignmentId = 'a1'): PendingReview {
  return { id, studentId: 'u-' + id, assignmentId, submittedAt, status: 'submitted',
    assignment: { id: assignmentId, groupId: 'g', tripletId: 't', title: 'Devre ölçümü', objective: '', criterion: '', createdAt: '' } };
}
describe('mentor review presentation', () => {
  const earlier = item('1', '2026-09-11T10:00:00Z');
  const later = item('2', '2026-09-12T10:00:00Z');
  it('sorts by submission time in both directions without mutating input', () => {
    const items = [later, earlier];
    expect(filterReviews(items, {}, '', 'oldest', 'tr')).toEqual([earlier, later]);
    expect(filterReviews(items, {}, '', 'newest', 'tr')).toEqual([later, earlier]);
    expect(items).toEqual([later, earlier]);
  });
  it('searches student names and task titles with Turkish casing', () => {
    const names = { 'u-1': 'İpek Yılmaz', 'u-2': 'Deniz Kaya' };
    expect(filterReviews([earlier, later], names, ' İPEK ', 'oldest', 'tr')).toEqual([earlier]);
    expect(filterReviews([earlier, later], names, 'ÖLÇÜMÜ', 'oldest', 'tr')).toHaveLength(2);
    expect(filterReviews([earlier], {}, 'unknown', 'oldest', 'tr')).toEqual([]);
  });
  it('keeps every student submission for assignment-only notification links', () => {
    expect(filterReviews([earlier, later, item('3', later.submittedAt, 'a2')], {}, '', 'oldest', 'tr', 'a1')).toEqual([earlier, later]);
    expect(filterReviews([earlier], {}, '', 'oldest', 'tr', 'missing')).toEqual([]);
  });
  it('requires a meaningful revision reason, but keeps approval notes optional', () => {
    expect(reviewNoteError(false, '  \n ')).toBe('mentorFlow.reasonRequired');
    expect(reviewNoteError(false, 'Birimleri ekle')).toBeNull();
    expect(reviewNoteError(true, '')).toBeNull();
    expect(reviewNoteError(true, 'a'.repeat(1001))).toBe('mentorFlow.noteTooLong');
  });
  it('detects a newer submission and ignores expiring evidence URLs', () => {
    expect(reviewVersion({ ...earlier, submittedAt: later.submittedAt })).not.toBe(reviewVersion(earlier));
    expect(reviewVersion({ ...earlier, status: 'approved' })).not.toBe(reviewVersion(earlier));
    expect(reviewVersion({ ...earlier, photos: [{ uri: 'new-signed-url' }] })).toBe(reviewVersion(earlier));
  });
  it('handles missing names and invalid timestamps without displaying undefined', () => {
    expect(reviewInitials('Deniz Yılmaz')).toBe('DY');
    expect(reviewInitials('Deniz')).toBe('D');
    expect(reviewInitials('')).toBe('?');
    expect(reviewSubmittedAt('invalid', 'tr')).toBe('—');
  });
});
