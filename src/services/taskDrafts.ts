import * as FileSystem from 'expo-file-system/legacy';
import { createTaskDraftStore } from '@/utils/taskDrafts';

const directory = FileSystem.documentDirectory && `${FileSystem.documentDirectory}task-drafts/`;
function draftPath(key: string) {
  if (!directory) throw new Error('Local draft storage unavailable');
  return `${directory}${key}.json`;
}
export const taskDraftStore = createTaskDraftStore({
  async read(key) {
    const path = draftPath(key);
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) return FileSystem.readAsStringAsync(path);
    // iOS move removes the old destination first. If the process stops in
    // that gap, the completed temporary file is still recoverable.
    const pending = await FileSystem.getInfoAsync(`${path}.pending`);
    return pending.exists ? FileSystem.readAsStringAsync(`${path}.pending`) : null;
  },
  async write(key, value) {
    const path = draftPath(key);
    await FileSystem.makeDirectoryAsync(directory!, { intermediates: true });
    await FileSystem.writeAsStringAsync(`${path}.pending`, value);
    await FileSystem.moveAsync({ from: `${path}.pending`, to: path });
  },
  async remove(key) {
    await FileSystem.deleteAsync(draftPath(key), { idempotent: true });
    await FileSystem.deleteAsync(`${draftPath(key)}.pending`, { idempotent: true });
  },
});
