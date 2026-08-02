import { isConsentCurrent } from '@/utils/consent';

describe('isConsentCurrent', () => {
  it('accepts a stored version equal to the current one', () => {
    expect(isConsentCurrent('1.0', '1.0')).toBe(true);
  });

  it('rejects an older stored version', () => {
    expect(isConsentCurrent('1.0', '1.1')).toBe(false);
  });

  it('rejects a missing consent', () => {
    expect(isConsentCurrent(null, '1.0')).toBe(false);
    expect(isConsentCurrent(undefined, '1.0')).toBe(false);
  });

  it('rejects an empty or whitespace-only stored version', () => {
    expect(isConsentCurrent('', '1.0')).toBe(false);
    expect(isConsentCurrent('   ', '1.0')).toBe(false);
  });

  it('ignores surrounding whitespace on a valid version', () => {
    expect(isConsentCurrent(' 1.0 ', '1.0')).toBe(true);
  });
});
