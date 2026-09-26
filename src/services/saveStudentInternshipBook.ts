import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

/** Android saves to a user-selected folder; iOS opens Save to Files/share sheet. */
export async function saveStudentInternshipBook(html: string, studentName: string, studentId: string): Promise<boolean> {
  const safeName = studentName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i')
    .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'student';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
  const fileName = `EngineerTrack-Staj-Defteri-${safeName}-${studentId.slice(0, 8)}-${stamp}`;
  if (Platform.OS === 'android') {
    const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) return false;
    const pdf = await Print.printToFileAsync({ html, base64: true, width: 595, height: 842 });
    if (!pdf.base64) throw new Error('PDF generation failed');
    const uri = await FileSystem.StorageAccessFramework.createFileAsync(permission.directoryUri, fileName, 'application/pdf');
    await FileSystem.writeAsStringAsync(uri, pdf.base64, { encoding: FileSystem.EncodingType.Base64 });
    return true;
  }
  if (Platform.OS !== 'ios' || !FileSystem.cacheDirectory || !await Sharing.isAvailableAsync()) {
    throw new Error('File sharing unavailable');
  }
  const pdf = await Print.printToFileAsync({ html, width: 595, height: 842 });
  const namedUri = `${FileSystem.cacheDirectory}${fileName}.pdf`;
  await FileSystem.moveAsync({ from: pdf.uri, to: namedUri });
  await Sharing.shareAsync(namedUri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  // Share sheets cannot confirm whether the person saved the file.
  return false;
}
