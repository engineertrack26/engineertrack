import { Alert } from 'react-native';
import type { TFunction } from 'i18next';
import { RpcError } from '@/services/rpcError';
import type { JoinIssueReason } from '@/services/joinIssue';

/**
 * Which RPC errors a user can report, and under which reason code.
 * INSTITUTION_MISMATCH is deliberately absent: an advisor linking a student
 * from another institution is the rule working correctly, not a fault to report.
 */
const REPORTABLE: Record<string, JoinIssueReason> = {
  INVALID_CODE: 'INVALID_CODE',
  EXPIRED_CODE: 'INVALID_CODE',
  INVALID_CODE_FORMAT: 'INVALID_CODE',
  CODE_SEGMENT_MISMATCH: 'CODE_SEGMENT_MISMATCH',
  EMAIL_DOMAIN_BLOCKED: 'EMAIL_DOMAIN_BLOCKED',
};

/**
 * Single place where a failed code operation becomes a translated alert,
 * with a "Report a problem" action when the failure is reportable.
 *
 * Lives in utils rather than components because it is not a component, and it
 * is not covered by Jest — jest.config.js only matches src/**\/__tests__, so
 * importing react-native here never reaches the test runner.
 */
export function showCodeErrorAlert(params: {
  t: TFunction;
  error: unknown;
  attemptedCode: string;
  onReport: (report: { code: string; reason: JoinIssueReason }) => void;
}): void {
  const { t, error, attemptedCode, onReport } = params;

  if (!(error instanceof RpcError)) {
    Alert.alert(t('common.error'), t('errors.unknown'));
    return;
  }

  const message = t(error.info.key, error.info.params);
  const reason = REPORTABLE[error.info.code];

  if (!reason) {
    Alert.alert(t('common.error'), message);
    return;
  }

  Alert.alert(t('common.error'), message, [
    { text: t('common.cancel'), style: 'cancel' },
    {
      text: t('errors.reportProblem'),
      onPress: () => onReport({ code: attemptedCode.trim(), reason }),
    },
  ]);
}
