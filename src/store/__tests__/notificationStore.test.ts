import { useNotificationStore } from '../notificationStore';
import { notificationService } from '@/services/notifications';

jest.mock('@/services/notifications', () => ({
  notificationService: { getAll: jest.fn(), getUnreadCount: jest.fn(), markAsRead: jest.fn(), markAllAsRead: jest.fn() },
}));
jest.mock('@/services/supabase', () => ({ supabase: { removeChannel: jest.fn() } }));

const state = () => useNotificationStore.getState();
const row = (id: string) => ({ id, user_id: 'u', title: id, body: 'body', type: 'general', is_read: false, created_at: '2026-09-12T10:00:00Z', data: {} });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

beforeEach(() => {
  state().reset();
  jest.resetAllMocks();
  jest.mocked(notificationService.getAll).mockResolvedValue([row('one')]);
  jest.mocked(notificationService.getUnreadCount).mockResolvedValue(80);
  jest.mocked(notificationService.markAsRead).mockResolvedValue(undefined);
  jest.mocked(notificationService.markAllAsRead).mockResolvedValue(undefined);
});

it('keeps the server unread count, not the loaded page count', async () => {
  expect(await state().fetchNotifications('u')).toBe(true);
  expect(state().notifications).toHaveLength(1);
  expect(state().unreadCount).toBe(80);
  expect(await state().markAsRead('one')).toBe(true);
  expect(state().unreadCount).toBe(79);
  await state().markAsRead('one');
  expect(state().unreadCount).toBe(79);
});

it('reports load failure without erasing existing content', async () => {
  await state().fetchNotifications('u');
  jest.mocked(notificationService.getAll).mockRejectedValue(new Error('offline'));
  expect(await state().fetchNotifications('u')).toBe(false);
  expect(state().notifications[0].id).toBe('one');
  expect(state().unreadCount).toBe(80);
  expect(state().isLoading).toBe(false);
});

it('does not falsely mark a failed single or bulk update as read', async () => {
  await state().fetchNotifications('u');
  jest.mocked(notificationService.markAsRead).mockRejectedValue(new Error('offline'));
  jest.mocked(notificationService.markAllAsRead).mockRejectedValue(new Error('offline'));
  expect(await state().markAsRead('one')).toBe(false);
  expect(await state().markAllAsRead('u')).toBe(false);
  expect(state().notifications[0].isRead).toBe(false);
  expect(state().unreadCount).toBe(80);
});

it('marks all as read after a successful response', async () => {
  await state().fetchNotifications('u');
  expect(await state().markAllAsRead('u')).toBe(true);
  expect(state().notifications[0].isRead).toBe(true);
  expect(state().unreadCount).toBe(0);
});

it('discards a late load after logout/reset', async () => {
  const pending = deferred<ReturnType<typeof row>[]>();
  jest.mocked(notificationService.getAll).mockReturnValue(pending.promise);
  const request = state().fetchNotifications('u');
  state().reset();
  pending.resolve([row('old-user')]);
  expect(await request).toBe(false);
  expect(state().notifications).toEqual([]);
  expect(state().unreadCount).toBe(0);
});

it('does not let an earlier refresh overwrite a newer one', async () => {
  const pending = deferred<ReturnType<typeof row>[]>();
  jest.mocked(notificationService.getAll).mockReturnValueOnce(pending.promise);
  const oldRequest = state().fetchNotifications('u');
  await state().fetchNotifications('u');
  pending.resolve([row('stale')]);
  expect(await oldRequest).toBe(false);
  expect(state().notifications[0].id).toBe('one');
});

it('retains realtime inserts during pagination and deduplicates them', async () => {
  await state().fetchNotifications('u');
  useNotificationStore.setState({ hasMore: true });
  const pending = deferred<ReturnType<typeof row>[]>();
  jest.mocked(notificationService.getAll).mockReturnValue(pending.promise);
  const request = state().fetchMore('u');
  const incoming = { ...state().notifications[0], id: 'incoming' };
  useNotificationStore.setState({ notifications: [incoming, ...state().notifications] });
  pending.resolve([row('incoming'), row('older')]);
  expect(await request).toBe(true);
  expect(state().notifications.map((n) => n.id)).toEqual(['incoming', 'one', 'older']);
  expect(state().unreadCount).toBe(80);
  expect(state().isLoadingMore).toBe(false);
});

it('reports pagination failure so the screen can offer an explicit retry', async () => {
  await state().fetchNotifications('u');
  useNotificationStore.setState({ hasMore: true });
  jest.mocked(notificationService.getAll).mockRejectedValue(new Error('offline'));
  expect(await state().fetchMore('u')).toBe(false);
  expect(state().notifications).toHaveLength(1);
  expect(state().isLoadingMore).toBe(false);
  expect(state().hasMore).toBe(true);
});
