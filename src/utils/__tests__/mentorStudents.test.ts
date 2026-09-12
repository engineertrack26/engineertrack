import { filterMentorStudents, internshipDates, mapMentorStudent } from '../mentorStudents';
import { filterReviews, PendingReview } from '../mentorReviews';

const ipek = mapMentorStudent({ id: 's1', profiles: { first_name: 'İpek', last_name: 'Yılmaz' }, company_name: 'Atlas', total_xp: 0 });
const deniz = mapMentorStudent({ id: 's2', profiles: { first_name: 'Deniz', last_name: 'Kaya' } });
describe('mentor student presentation', () => {
  it('keeps unknown values distinct from real zero', () => {
    expect(ipek).toMatchObject({ name: 'İpek Yılmaz', company: 'Atlas', xp: 0, level: null });
    expect(mapMentorStudent({ id: 'empty' })).toMatchObject({ name: '', company: '', xp: null, streak: null });
  });
  it('searches Turkish names and filters pending students without mutating the list', () => {
    const students = [ipek, deniz];
    expect(filterMentorStudents(students, ' İPEK ', false, null, 'tr')).toEqual([ipek]);
    expect(filterMentorStudents(students, '', true, { s1: 3 }, 'tr')).toEqual([ipek]);
    expect(filterMentorStudents(students, 'Deniz', true, { s1: 3 }, 'tr')).toEqual([]);
    expect(filterMentorStudents(students, '', true, null, 'tr')).toEqual([]);
    expect(filterMentorStudents(students, '', false, null, 'tr')).toEqual([deniz, ipek]);
    expect(students).toEqual([ipek, deniz]);
  });
  it('does not invent internship dates or a performance percentage', () => {
    expect(internshipDates(undefined, undefined, 'tr')).toBeNull();
    expect(internshipDates('2026-02-30', '2026-03-30', 'tr')).toBeNull();
    expect(internshipDates('2026-10-01', '2026-09-01', 'tr')).toBeNull();
    expect(internshipDates('2026-09-01', '2026-09-30', 'tr')).toContain('2026');
  });
  it('filters by student ID, not a shared display name, while preserving assignment filters', () => {
    const item = (id: string, studentId: string, assignmentId: string): PendingReview => ({ id, studentId, assignmentId,
      status: 'submitted', submittedAt: '2026-09-01', assignment: { id: assignmentId, title: 'Task', groupId: 'g', tripletId: 't', objective: '', criterion: '', createdAt: '' } });
    const rows = [item('1', 's1', 'a1'), item('2', 's2', 'a1'), item('3', 's1', 'a2')];
    expect(filterReviews(rows, { s1: 'Same Name', s2: 'Same Name' }, '', 'oldest', 'en', '', 's1').map(row => row.id)).toEqual(['1', '3']);
    expect(filterReviews(rows, {}, '', 'oldest', 'en', 'a1', 's1').map(row => row.id)).toEqual(['1']);
    expect(filterReviews(rows, {}, '', 'oldest', 'en', '', '').length).toBe(3);
  });
});
