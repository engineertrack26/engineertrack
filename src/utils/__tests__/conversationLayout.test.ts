import { readFileSync } from 'node:fs';

// Source-level layout guards; native keyboard geometry still needs device QA.
const source = readFileSync('src/components/screens/ConversationScreen.tsx', 'utf8');

test('keyboard avoidance is enabled on both platforms and wraps the full screen', () => {
  expect(source).toContain("behavior={Platform.OS === 'ios' ? 'padding' : 'height'}");
  expect(source.indexOf('<KeyboardAvoidingView')).toBeLessThan(source.indexOf('<SafeAreaView'));
  expect(source.indexOf('</KeyboardAvoidingView>')).toBeGreaterThan(source.indexOf('</SafeAreaView>'));
});

test('message list shrinks while the composer remains visible', () => {
  expect(source).toContain('messageList: { flex: 1, minHeight: 0 }');
  expect(source).toContain('inputRow: { flexShrink: 0,');
  expect(source).toContain('keyboardShouldPersistTaps="handled"');
  expect(source).toContain('keyboardDismissMode="on-drag"');
});

test.each(['student', 'mentor', 'advisor'])('%s uses the shared conversation layout', role => {
  expect(readFileSync(`app/(${role})/conversation.tsx`, 'utf8')).toContain('ConversationScreen');
});
