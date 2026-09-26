import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { saveStudentInternshipBook } from '../saveStudentInternshipBook';

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' }, cacheDirectory: 'file:///cache/',
  writeAsStringAsync: jest.fn(), moveAsync: jest.fn(),
  StorageAccessFramework: { requestDirectoryPermissionsAsync: jest.fn(), createFileAsync: jest.fn() },
}));
jest.mock('expo-print', () => ({ printToFileAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
beforeEach(() => jest.clearAllMocks());

test('Android writes generated PDF base64 to selected folder', async () => {
  jest.mocked(FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync)
    .mockResolvedValue({ granted: true, directoryUri: 'content://folder' } as never);
  jest.mocked(Print.printToFileAsync).mockResolvedValue({ uri: 'file:///cache/book.pdf', base64: 'JVBERg==', numberOfPages: 2 });
  jest.mocked(FileSystem.StorageAccessFramework.createFileAsync).mockResolvedValue('content://book');
  expect(await saveStudentInternshipBook('<html />', 'İpek Yılmaz', '12345678-abcd')).toBe(true);
  expect(FileSystem.StorageAccessFramework.createFileAsync).toHaveBeenCalledWith('content://folder',
    expect.stringMatching(/^EngineerTrack-Staj-Defteri-Ipek-Yilmaz-12345678-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}$/), 'application/pdf');
  expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith('content://book', 'JVBERg==', { encoding: 'base64' });
});

test('cancelling Android folder picker does not generate a PDF', async () => {
  jest.mocked(FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync).mockResolvedValue({ granted: false } as never);
  expect(await saveStudentInternshipBook('<html />', 'Student', '12345678')).toBe(false);
  expect(Print.printToFileAsync).not.toHaveBeenCalled();
});

test('iOS opens PDF share sheet without falsely confirming a save', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  try {
    jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
    jest.mocked(Print.printToFileAsync).mockResolvedValue({ uri: 'file:///cache/book.pdf', numberOfPages: 2 });
    expect(await saveStudentInternshipBook('<html />', 'Student', '12345678')).toBe(false);
    expect(FileSystem.moveAsync).toHaveBeenCalledWith({ from: 'file:///cache/book.pdf',
      to: expect.stringMatching(/^file:\/\/\/cache\/EngineerTrack-Staj-Defteri-Student-12345678-.*\.pdf$/) });
    expect(Sharing.shareAsync).toHaveBeenCalledWith(expect.stringContaining('EngineerTrack-Staj-Defteri-Student-12345678-'),
      { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  } finally { Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true }); }
});
