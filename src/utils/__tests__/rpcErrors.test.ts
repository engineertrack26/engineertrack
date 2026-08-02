import { mapRpcError } from '@/utils/rpcErrors';

describe('mapRpcError', () => {
  it('maps a known bare code', () => {
    expect(mapRpcError('INVALID_CODE')).toEqual({
      code: 'INVALID_CODE',
      key: 'errors.invalidCode',
    });
  });

  it('maps a code carrying a detail payload', () => {
    expect(mapRpcError('EMAIL_DOMAIN_BLOCKED:btu.edu.tr,ogr.btu.edu.tr')).toEqual({
      code: 'EMAIL_DOMAIN_BLOCKED',
      key: 'errors.emailDomainBlocked',
      params: { domains: 'btu.edu.tr, ogr.btu.edu.tr' },
    });
  });

  it('ignores the Postgres error prefix Supabase prepends', () => {
    expect(mapRpcError('  CODE_SEGMENT_MISMATCH  ')).toEqual({
      code: 'CODE_SEGMENT_MISMATCH',
      key: 'errors.codeSegmentMismatch',
    });
  });

  it('falls back to a generic key for an unrecognised message', () => {
    expect(mapRpcError('some database explosion')).toEqual({
      code: 'UNKNOWN',
      key: 'errors.unknown',
    });
  });

  it('falls back for an undefined message', () => {
    expect(mapRpcError(undefined)).toEqual({ code: 'UNKNOWN', key: 'errors.unknown' });
  });
});
