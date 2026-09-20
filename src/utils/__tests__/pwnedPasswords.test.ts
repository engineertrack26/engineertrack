import { pwnedCount, splitSha1 } from '@/utils/pwnedPasswords';

// SHA-1 of "password": 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const PASSWORD_SHA1 = '5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8';
const RANGE = [
  '003D68EB55068C33ACE09247EE4C639306B:3',
  '1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493',
  '1E4C9B93F3F0682250B6CF8331B7EE68FD9:0', // padding entry
  '',
].join('\r\n');

describe('pwnedPasswords', () => {
  it('splits the hash into the 5-char prefix that is sent and the suffix that is matched', () => {
    expect(splitSha1(PASSWORD_SHA1)).toEqual({ prefix: '5BAA6', suffix: '1E4C9B93F3F0682250B6CF8331B7EE68FD8' });
  });
  it('finds a breached suffix regardless of the hash casing', () => {
    expect(pwnedCount(PASSWORD_SHA1, RANGE)).toBe(3861493);
    expect(pwnedCount(PASSWORD_SHA1.toUpperCase(), RANGE)).toBe(3861493);
  });
  it('treats an absent suffix and a padding entry as not breached', () => {
    expect(pwnedCount('5baa60000000000000000000000000000000000', RANGE)).toBe(0);
    expect(pwnedCount('5baa61E4C9B93F3F0682250B6CF8331B7EE68FD9', RANGE)).toBe(0);
  });
});
