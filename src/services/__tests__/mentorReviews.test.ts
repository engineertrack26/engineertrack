import { mentorReviewService } from '../mentorReviews';
import { assignmentService } from '../assignments';
import { notificationService } from '../notifications';
import { supabase } from '../supabase';
import type { PendingReview } from '@/utils/mentorReviews';

jest.mock('../assignments', () => ({ assignmentService: { listPendingReviews: jest.fn(), reviewAssignment: jest.fn() } }));
jest.mock('../notifications', () => ({ notificationService: { create: jest.fn() } }));
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

const item: PendingReview = { id: 's1', assignmentId: 'a1', studentId: 'u1', status: 'submitted', submittedAt: '2026-09-11',
  assignment: { id: 'a1', groupId: 'g1', tripletId: 't1', title: 'T', objective: '', criterion: '', createdAt: '' } };
const notification = { title: 'Review outcome', body: 'Your mentor reviewed the task.' };
const list = jest.mocked(assignmentService.listPendingReviews);
const review = jest.mocked(assignmentService.reviewAssignment);
const notify = jest.mocked(notificationService.create);

describe('mentor review operations', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    list.mockResolvedValue([item]);
    review.mockResolvedValue(undefined);
    notify.mockResolvedValue(undefined);
  });
  it('does not call the server for a blank revision reason', async () => {
    await expect(mentorReviewService.submit(item, false, '  ', notification)).rejects.toThrow('mentorFlow.reasonRequired');
    expect(list).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });
  it('rechecks the specific submission and sends the trimmed reason', async () => {
    await mentorReviewService.submit(item, false, '  Add units  ', notification);
    expect(list).toHaveBeenCalledWith({ submissionId: 's1', signUrls: false });
    expect(review).toHaveBeenCalledWith('s1', false, 'Add units', undefined);
    // The RPC notifies in-transaction; the client no longer inserts a notification.
    expect(notify).not.toHaveBeenCalled();
  });
  it('allows approval without a note', async () => {
    await mentorReviewService.submit(item, true, '', notification);
    expect(review).toHaveBeenCalledWith('s1', true, '', undefined);
    expect(notify).not.toHaveBeenCalled();
  });
  it('rejects a submission that was already reviewed or left the mentor scope', async () => {
    list.mockResolvedValue([]);
    await expect(mentorReviewService.submit(item, true, '', notification)).rejects.toThrow('mentorFlow.reviewChanged');
    expect(review).not.toHaveBeenCalled();
  });
  it('rejects a newer version of the student work', async () => {
    list.mockResolvedValue([{ ...item, submittedAt: '2026-09-12' }]);
    await expect(mentorReviewService.submit(item, true, '', notification)).rejects.toThrow('mentorFlow.reviewChanged');
    expect(review).not.toHaveBeenCalled();
  });
  it('never notifies the student when the review fails', async () => {
    review.mockRejectedValue(new Error('STUDENT_LEFT_GROUP'));
    await expect(mentorReviewService.submit(item, true, '', notification)).rejects.toThrow('STUDENT_LEFT_GROUP');
    expect(notify).not.toHaveBeenCalled();
  });
  it('does not turn notification failure into a failed review', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      notify.mockRejectedValue(new Error('offline'));
      await expect(mentorReviewService.submit(item, true, '', notification)).resolves.toBeUndefined();
    } finally { warn.mockRestore(); }
  });
  it('does not wait for slow push delivery to finish the review', async () => {
    notify.mockReturnValue(new Promise(() => {}));
    await expect(mentorReviewService.submit(item, true, '', notification)).resolves.toBeUndefined();
  });
  it('loads the queue without signing every attachment', async () => {
    const query = { select: jest.fn().mockReturnThis(), in: jest.fn().mockResolvedValue({ data: [{ id: 'u1', first_name: 'Deniz', last_name: 'Yılmaz' }], error: null }) };
    (supabase.from as jest.Mock).mockReturnValue(query);
    expect(await mentorReviewService.list()).toEqual({ items: [item], names: { u1: 'Deniz Yılmaz' } });
    expect(list).toHaveBeenCalledWith({ signUrls: false });
  });
  it('returns unavailable for an inaccessible detail without querying student names', async () => {
    list.mockResolvedValue([]);
    expect(await mentorReviewService.get('missing')).toEqual({ item: null, name: '' });
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
