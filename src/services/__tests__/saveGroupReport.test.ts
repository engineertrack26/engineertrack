import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { saveGroupReportCsv } from '../saveGroupReport';

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { UTF8: 'utf8' }, cacheDirectory: 'file:///cache/',
  writeAsStringAsync: jest.fn(),
  StorageAccessFramework: { requestDirectoryPermissionsAsync: jest.fn(), createFileAsync: jest.fn() },
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

test('Android saves the CSV content to a chosen folder instead of sharing text', async () => {
  jest.mocked(FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync)
    .mockResolvedValue({ granted: true, directoryUri: 'content://folder' } as never);
  jest.mocked(FileSystem.StorageAccessFramework.createFileAsync).mockResolvedValue('content://report');
  expect(await saveGroupReportCsv('12345678-0000', '\ufeffAd,Sonuç\r\n', 'Güz/Staj')).toBe(true);
  expect(FileSystem.StorageAccessFramework.createFileAsync).toHaveBeenCalledWith(
    'content://folder', expect.stringMatching(/^EngineerTrack-Guz-Staj-12345678-\d{4}-\d{2}-\d{2}$/), 'text/csv');
  expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith('content://report', '\ufeffAd,Sonuç\r\n', { encoding: 'utf8' });
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

test('cancelled Android folder picker creates no file and reports no save', async () => {
  jest.mocked(FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync).mockResolvedValue({ granted: false } as never);
  expect(await saveGroupReportCsv('group', 'csv', 'Group')).toBe(false);
  expect(FileSystem.StorageAccessFramework.createFileAsync).not.toHaveBeenCalled();
});

test('iOS opens a real CSV file in the share sheet without claiming it was saved', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  try {
    jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
    expect(await saveGroupReportCsv('12345678', 'csv', 'Group')).toBe(false);
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
      expect.stringMatching(/^file:\/\/\/cache\/EngineerTrack-Group-12345678-\d{4}-\d{2}-\d{2}\.csv$/),
      'csv', { encoding: 'utf8' });
    expect(Sharing.shareAsync).toHaveBeenCalledWith(expect.stringContaining('.csv'),
      { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
  } finally { Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true }); }
});
