import { submissionStampKind } from '../mentorSubmissions';

test('maps every submission status to the stamp the mentor reads but cannot set', () => {
  expect(submissionStampKind('approved')).toBe('approved');
  expect(submissionStampKind('needs_revision')).toBe('revision');
  expect(submissionStampKind('submitted')).toBe('pending');
});
