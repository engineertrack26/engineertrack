import { createTaskDraftStore, draftRevision, submissionDraft, TaskDraft } from '../taskDrafts';
import type { MyAssignment } from '@/types/assignment';

const draft: TaskDraft = { note: 'Measured voltage', reflection: 'Calibration matters',
  photos: [{ uri: 'user/task/photo.jpg', caption: 'Probe' }],
  documents: [{ uri: 'user/task/report.pdf', fileName: 'report.pdf', fileType: 'application/pdf', fileSize: 100 }],
  selfLevel: null };
function setup() {
  const files = new Map<string, string>();
  const storage = {
    read: jest.fn(async (key: string) => files.get(key) || null),
    write: jest.fn(async (key: string, value: string) => { files.set(key, value); }),
    remove: jest.fn(async (key: string) => { files.delete(key); }),
  };
  return { files, storage, store: createTaskDraftStore(storage) };
}
describe('local task drafts', () => {
  it('survives store recreation and keeps text and all evidence', async () => {
    const { storage, store } = setup();
    await store.save('u1', 'a1', 'revision', draft);
    expect(await createTaskDraftStore(storage).load('u1', 'a1', 'revision')).toEqual(draft);
  });
  it('isolates users and assignments', async () => {
    const { store } = setup();
    await store.save('u1', 'a1', 'revision', draft);
    expect(await store.load('u2', 'a1', 'revision')).toBeNull();
    expect(await store.load('u1', 'a2', 'revision')).toBeNull();
  });
  it('ignores drafts from an older server submission or review', async () => {
    const { store } = setup();
    await store.save('u1', 'a1', 'old', draft);
    expect(await store.load('u1', 'a1', 'new')).toBeNull();
  });
  it('serializes saves and removes after pending writes', async () => {
    const { store, files } = setup();
    await Promise.all([store.save('u1', 'a1', 'r', draft), store.save('u1', 'a1', 'r', { ...draft, note: 'newest' })]);
    expect((await store.load('u1', 'a1', 'r'))?.note).toBe('newest');
    await Promise.all([store.save('u1', 'a1', 'r', draft), store.remove('u1', 'a1')]);
    expect(files.size).toBe(0);
  });
  it('reports write failure and allows a later retry', async () => {
    const { store, storage } = setup();
    storage.write.mockRejectedValueOnce(new Error('Disk full'));
    await expect(store.save('u1', 'a1', 'r', draft)).rejects.toThrow('Disk full');
    await store.save('u1', 'a1', 'r', draft);
    expect(await store.load('u1', 'a1', 'r')).toEqual(draft);
  });
  it('reports corruption instead of pretending no draft exists', async () => {
    const { store, files } = setup();
    files.set('u1_a1', '{broken');
    await expect(store.load('u1', 'a1', 'r')).rejects.toThrow();
    files.set('u1_a1', JSON.stringify({ version: 1, revision: 'r', draft: { ...draft, photos: [null] } }));
    await expect(store.load('u1', 'a1', 'r')).rejects.toThrow('Invalid draft data');
  });
  it('rejects path traversal identities', () => {
    const { store } = setup();
    expect(() => store.load('../u1', 'a1', 'r')).toThrow('Invalid draft identity');
    expect(() => store.remove('u1', '../a1')).toThrow('Invalid draft identity');
  });
  it('prefills revision work and fingerprints server changes, not signed URLs', () => {
    const task: MyAssignment = { id: 'a1', groupId: 'g', tripletId: 't', title: 'T', objective: '', criterion: '', createdAt: '',
      submission: { id: 's1', assignmentId: 'a1', studentId: 'u1', status: 'needs_revision', submittedAt: '1', reviewedAt: '2',
        studentNote: draft.note, reflection: draft.reflection, photos: draft.photos, documents: draft.documents } };
    expect(submissionDraft(task)).toEqual(draft);
    expect(draftRevision({ ...task, submission: { ...task.submission!, photos: [] } })).toBe(draftRevision(task));
    expect(draftRevision({ ...task, submission: { ...task.submission!, reviewedAt: '3' } })).not.toBe(draftRevision(task));
  });
});
