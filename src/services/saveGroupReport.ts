import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export async function saveGroupReportCsv(groupId: string, csv: string, title: string): Promise<boolean> {
  const base = `EngineerTrack-${title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'group'}-${groupId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}`;
  if (Platform.OS === 'android') {
    const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) return false;
    const uri = await FileSystem.StorageAccessFramework.createFileAsync(permission.directoryUri, base, 'text/csv');
    await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
    return true;
  }
  if (!FileSystem.cacheDirectory || !await Sharing.isAvailableAsync()) throw new Error('File sharing unavailable');
  const uri = `${FileSystem.cacheDirectory}${base}.csv`;
  await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
  // The iOS share sheet has no completion result: the user may dismiss it.
  return false;
}
