import { newAssignmentId, prepareAssignments, reviewedAssignmentsMatch, type PreparedTask } from '../assignmentPreparation';
import type { GroupAssignment } from '@/types/assignment';

function task(id: string): PreparedTask {
  return { id, groupId: 'g1', createdBy: 'advisor', tripletId: `triplet-${id}`,
    title: `Task ${id}`, objective: 'Objective', criterion: 'Criterion' };
}

function apiFixture() {
  const records = new Map<string, GroupAssignment>();
  const api = {
    findPreparedAssignment: jest.fn(async (id: string, _group: string, _owner: string) => records.get(id) || null),
    createAssignment: jest.fn(async (input: PreparedTask) => {
      const row: GroupAssignment = { ...input, createdAt: '2026-09-13' };
      if (records.has(input.id)) throw new Error('duplicate');
      records.set(input.id, row);
      return row;
    }),
    uploadAssignmentDocument: jest.fn(async (_group: string, id: string, _uri: string, name: string, _mime: string) => ({ path: `g1/${id}/file`, name })),
    setAssignmentDocument: jest.fn(async (id: string, path: string, name: string) => {
      const row = { ...records.get(id)!, documentPath: path, documentName: name };
      records.set(id, row);
      return row;
    }),
  };
  return { api, records };
}

test('identities have UUID v4 shape', () => {
  expect(newAssignmentId()).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
});

test('final preflight rejects deleted or changed rows, but ignores unrelated drafts and signed URLs', () => {
  const row: GroupAssignment = { ...task('a'), createdAt: 'now' };
  expect(reviewedAssignmentsMatch([row], [])).toBe(false);
  expect(reviewedAssignmentsMatch([], [row])).toBe(false);
  expect(reviewedAssignmentsMatch([row], [{ ...row, criterion: 'Different' }])).toBe(false);
  expect(reviewedAssignmentsMatch([row], [{ ...row, documentUrl: 'signed' }, { ...row, id: 'unrelated' }])).toBe(true);
  expect(reviewedAssignmentsMatch([row], [{ ...row, publishedAt: 'now' }])).toBe(true);
});

test('prepares only the selected tasks and retains edited content and date', async () => {
  const { api, records } = apiFixture();
  records.set('unrelated', { ...task('unrelated'), createdAt: 'yesterday' });
  const edited = { ...task('a'), title: 'Edited', description: 'Instructions', dueDate: '2026-10-01' };
  const rows = await prepareAssignments([edited, task('b')], api);
  expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
  expect(rows[0]).toMatchObject(edited);
  expect(api.findPreparedAssignment).toHaveBeenCalledWith('a', 'g1', 'advisor');
  expect(records.get('unrelated')!.publishedAt).toBeUndefined();
});

test('a failed lookup never turns into another insert', async () => {
  const { api } = apiFixture();
  api.findPreparedAssignment.mockRejectedValueOnce(new Error('offline'));
  await expect(prepareAssignments([task('a')], api)).rejects.toThrow('offline');
  expect(api.createAssignment).not.toHaveBeenCalled();
});

test('recovers a committed insert whose response was lost without duplicating it', async () => {
  const { api, records } = apiFixture();
  const input = task('a');
  api.createAssignment.mockImplementationOnce(async (value) => {
    records.set(value.id, { ...value, createdAt: 'today' });
    throw new Error('response lost');
  });
  await expect(prepareAssignments([input], api)).rejects.toThrow('response lost');
  expect(await prepareAssignments([input], api)).toHaveLength(1);
  expect(api.createAssignment).toHaveBeenCalledTimes(1);
});

test('partial preparation keeps saved drafts and retry creates only the missing row', async () => {
  const { api, records } = apiFixture();
  const create = api.createAssignment.getMockImplementation()!;
  api.createAssignment.mockImplementationOnce(create).mockRejectedValueOnce(new Error('scope'));
  const inputs = [task('a'), task('b')];
  await expect(prepareAssignments(inputs, api)).rejects.toThrow('scope');
  expect(records.get('a')!.publishedAt).toBeUndefined();
  expect(await prepareAssignments(inputs, api)).toHaveLength(2);
  expect(api.createAssignment.mock.calls.map(([r]) => r.id)).toEqual(['a', 'b', 'b']);
});

test('failed upload prevents a complete batch from reaching the publisher', async () => {
  const { api } = apiFixture();
  const input = { ...task('a'), document: { uri: 'file://a.pdf', name: 'a.pdf', mimeType: 'application/pdf' } };
  const publish = jest.fn();
  api.uploadAssignmentDocument.mockRejectedValueOnce(new Error('upload failed'));
  await expect(prepareAssignments([input], api).then(publish)).rejects.toThrow('upload failed');
  expect(publish).not.toHaveBeenCalled();
  const rows = await prepareAssignments([input], api);
  expect(rows[0].documentName).toBe('a.pdf');
  expect(api.createAssignment).toHaveBeenCalledTimes(1);
});

test('retry linking an uploaded document does not upload it again', async () => {
  const { api } = apiFixture();
  const inputs = [{ ...task('a'), document: { uri: 'file://a.docx', name: 'a.docx', mimeType: 'docx' } }];
  api.setAssignmentDocument.mockRejectedValueOnce(new Error('link failed'));
  await expect(prepareAssignments(inputs, api)).rejects.toThrow('link failed');
  await prepareAssignments(inputs, api);
  expect(api.uploadAssignmentDocument).toHaveBeenCalledTimes(1);
  expect(api.setAssignmentDocument).toHaveBeenCalledTimes(2);
});

test('refuses to overwrite content edited in another session', async () => {
  const { api, records } = apiFixture();
  await prepareAssignments([task('a')], api);
  records.set('a', { ...records.get('a')!, title: 'Changed elsewhere' });
  await expect(prepareAssignments([task('a')], api)).rejects.toThrow('PREPARED_TASK_CHANGED');
  expect(api.createAssignment).toHaveBeenCalledTimes(1);
});

test('refuses to attach a missing document to a concurrently published task', async () => {
  const { api, records } = apiFixture();
  records.set('a', { ...task('a'), createdAt: 'today', publishedAt: 'now' });
  await expect(prepareAssignments([{ ...task('a'), document: { uri: 'file://a', name: 'a.pdf', mimeType: 'pdf' } }], api))
    .rejects.toThrow('PREPARED_TASK_CHANGED');
  expect(api.uploadAssignmentDocument).not.toHaveBeenCalled();
});

test('recovers a lost publish response without rewriting rows or documents', async () => {
  const { api, records } = apiFixture();
  const inputs = [{ ...task('a'), document: { uri: 'file://a', name: 'a.pdf', mimeType: 'pdf' } }];
  await prepareAssignments(inputs, api);
  records.set('a', { ...records.get('a')!, publishedAt: 'now' });
  const rows = await prepareAssignments(inputs, api);
  expect(rows[0].publishedAt).toBe('now');
  expect(api.createAssignment).toHaveBeenCalledTimes(1);
  expect(api.uploadAssignmentDocument).toHaveBeenCalledTimes(1);
  expect(api.setAssignmentDocument).toHaveBeenCalledTimes(1);
});
