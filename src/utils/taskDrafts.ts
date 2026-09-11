import type { MyAssignment, PhotoEvidence, DocumentEvidence } from '@/types/assignment';

export interface TaskDraft {
  note: string;
  reflection: string;
  photos: PhotoEvidence[];
  documents: DocumentEvidence[];
}
export interface DraftStorage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export function draftRevision(task: MyAssignment): string {
  const s = task.submission;
  return JSON.stringify([s?.id, s?.status, s?.submittedAt, s?.reviewedAt]);
}
export function submissionDraft(task: MyAssignment): TaskDraft {
  return { note: task.submission?.studentNote || '', reflection: task.submission?.reflection || '',
    photos: task.submission?.photos || [], documents: task.submission?.documents || [] };
}
function validDraft(value: unknown): value is TaskDraft {
  if (!value || typeof value !== 'object') return false;
  const d = value as TaskDraft;
  return typeof d.note === 'string' && typeof d.reflection === 'string' &&
    Array.isArray(d.photos) && d.photos.every(p => p && typeof p.uri === 'string' && (p.caption === undefined || typeof p.caption === 'string')) &&
    Array.isArray(d.documents) && d.documents.every(p => p && typeof p.uri === 'string' &&
      typeof p.fileName === 'string' && typeof p.fileType === 'string' && typeof p.fileSize === 'number' && Number.isFinite(p.fileSize));
}

/** Per-account, per-task queue: a slow older write cannot replace a newer one,
 * and successful submission removal runs after all pending saves. */
export function createTaskDraftStore(storage: DraftStorage) {
  const queues = new Map<string, Promise<unknown>>();
  function key(userId: string, taskId: string) {
    if (![userId, taskId].every(id => /^[a-zA-Z0-9-]+$/.test(id))) throw new Error('Invalid draft identity');
    return `${userId}_${taskId}`;
  }
  function enqueue<T>(id: string, action: () => Promise<T>): Promise<T> {
    const result = (queues.get(id) || Promise.resolve()).catch(() => undefined).then(action);
    queues.set(id, result);
    const cleanup = () => { if (queues.get(id) === result) queues.delete(id); };
    void result.then(cleanup, cleanup);
    return result;
  }
  return {
    load(userId: string, taskId: string, revision: string): Promise<TaskDraft | null> {
      return enqueue(key(userId, taskId), async () => {
        const raw = await storage.read(key(userId, taskId));
        if (!raw) return null;
        const saved = JSON.parse(raw);
        if (saved.version !== 1 || !validDraft(saved.draft)) throw new Error('Invalid draft data');
        return saved.revision === revision ? saved.draft : null;
      });
    },
    save(userId: string, taskId: string, revision: string, draft: TaskDraft) {
      const id = key(userId, taskId);
      const value = JSON.stringify({ version: 1, revision, draft });
      return enqueue(id, () => storage.write(id, value));
    },
    remove(userId: string, taskId: string) {
      const id = key(userId, taskId);
      return enqueue(id, () => storage.remove(id));
    },
  };
}
