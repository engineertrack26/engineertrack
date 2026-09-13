import type { GroupAssignment } from '@/types/assignment';

export interface PreparedTask {
  id: string;
  groupId: string;
  createdBy: string;
  tripletId: string;
  title: string;
  description?: string;
  objective: string;
  criterion: string;
  dueDate?: string;
  document?: { uri: string; name: string; mimeType: string };
  uploaded?: { path: string; name: string };
}

// These are database identities, not credentials. RLS, not UUID secrecy,
// authorizes every write. Keep each ID stable throughout an interrupted save.
export function newAssignmentId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

/** Do not publish a deleted or silently changed task from an old review. */
export function reviewedAssignmentsMatch(reviewed: GroupAssignment[], current: GroupAssignment[]): boolean {
  const byId = new Map(current.map((row) => [row.id, row]));
  const fields = ['groupId', 'tripletId', 'title', 'description', 'objective', 'criterion', 'dueDate', 'documentPath', 'documentName'] as const;
  return reviewed.length > 0 && reviewed.every((row) => {
    const latest = byId.get(row.id);
    return latest && fields.every((field) => (row[field] || '') === (latest[field] || ''));
  });
}

interface PreparationApi {
  findPreparedAssignment(id: string, groupId: string, createdBy: string): Promise<GroupAssignment | null>;
  createAssignment(task: PreparedTask): Promise<GroupAssignment>;
  uploadAssignmentDocument(groupId: string, id: string, uri: string, name: string, mime: string): Promise<{ path: string; name: string }>;
  setAssignmentDocument(id: string, path: string, name: string): Promise<GroupAssignment>;
}

/** Save the immutable reviewed snapshot. A failed read must never become a
 * second insert. No publishing occurs here: callers publish only after ALL
 * rows and requested documents are ready. Successfully saved rows remain drafts. */
export async function prepareAssignments(tasks: PreparedTask[], api: PreparationApi): Promise<GroupAssignment[]> {
  const rows: GroupAssignment[] = [];
  for (const task of tasks) {
    let row = await api.findPreparedAssignment(task.id, task.groupId, task.createdBy);
    if (!row) row = await api.createAssignment(task);
    if (row.tripletId !== task.tripletId || row.title !== task.title ||
        row.objective !== task.objective || row.criterion !== task.criterion ||
        (row.description || '') !== (task.description || '') ||
        (row.dueDate || '') !== (task.dueDate || '')) {
      throw new Error('PREPARED_TASK_CHANGED');
    }
    if (task.document) {
      if ((row.publishedAt && (!task.uploaded || row.documentPath !== task.uploaded.path)) ||
          (row.documentPath && row.documentPath !== task.uploaded?.path)) {
        throw new Error('PREPARED_TASK_CHANGED');
      }
      if (!task.uploaded) {
        task.uploaded = await api.uploadAssignmentDocument(task.groupId, task.id,
          task.document.uri, task.document.name, task.document.mimeType);
      }
      if (row.documentPath !== task.uploaded.path) {
        row = await api.setAssignmentDocument(task.id, task.uploaded.path, task.uploaded.name);
      }
    }
    rows.push(row);
  }
  return rows;
}
