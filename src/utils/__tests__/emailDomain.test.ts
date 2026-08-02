import { normalizeDomainList } from '@/utils/emailDomain';

describe('normalizeDomainList', () => {
  it('splits on commas and lowercases', () => {
    expect(normalizeDomainList('BTU.EDU.TR, ogr.BTU.edu.tr')).toEqual([
      'btu.edu.tr',
      'ogr.btu.edu.tr',
    ]);
  });

  it('strips a leading @', () => {
    expect(normalizeDomainList('@btu.edu.tr')).toEqual(['btu.edu.tr']);
  });

  it('drops empty entries and surrounding whitespace', () => {
    expect(normalizeDomainList(' btu.edu.tr , , ')).toEqual(['btu.edu.tr']);
  });

  it('removes duplicates, keeping first appearance', () => {
    expect(normalizeDomainList('btu.edu.tr, BTU.EDU.TR')).toEqual(['btu.edu.tr']);
  });

  it('also accepts newline and semicolon separators', () => {
    expect(normalizeDomainList('btu.edu.tr;uludag.edu.tr\nitu.edu.tr')).toEqual([
      'btu.edu.tr',
      'uludag.edu.tr',
      'itu.edu.tr',
    ]);
  });

  it('returns an empty list for empty input', () => {
    expect(normalizeDomainList('')).toEqual([]);
    expect(normalizeDomainList('   ')).toEqual([]);
  });
});
