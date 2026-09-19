import { readFileSync } from 'node:fs';
import { createInstance } from 'i18next';

const en = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const tr = JSON.parse(readFileSync('src/i18n/locales/tr.json', 'utf8'));

test.each(['student', 'tabs', 'messages', 'feed', 'notifications', 'notificationUi', 'time'])('Turkish %s labels do not rely on English fallback', section => {
  for (const [key, value] of Object.entries(en[section])) {
    expect(tr[section][key]).toEqual(expect.any(String));
    expect(tr[section][key].trim()).not.toBe('');
    expect((tr[section][key].match(/\{\{\w+\}\}/g) || []).sort())
      .toEqual(((value as string).match(/\{\{\w+\}\}/g) || []).sort());
  }
});

test('message screens and safety notices resolve in Turkish', async () => {
  const instance = createInstance();
  await instance.init({ lng: 'tr', fallbackLng: 'en', resources: { tr: { translation: tr }, en: { translation: en } } });
  expect(instance.t('messages.newMessage', 'New message')).toBe('Yeni mesaj');
  expect(instance.t('messages.placeholder')).toBe('Bir mesaj yaz…');
  expect(instance.t('messages.blockConfirm', { name: 'Ali' })).toBe('Ali artık sana mesaj gönderemeyecek. Konuşma geçmişi korunur.');
  expect(instance.t('messages.deleteWarning', { count: 2 })).toBe('2 konuşma ve içindeki mesajlar kalıcı olarak silinecek.');
  for (const key of ['cannotMessage', 'conversationNotFound', 'blocked', 'messageEmpty', 'cannotBlock']) {
    expect(tr.errors[key]).toEqual(expect.any(String));
    expect(instance.t(`errors.${key}`)).not.toBe(en.errors[key]);
  }
});

test('task navigation, statuses and form labels resolve in Turkish', async () => {
  const instance = createInstance();
  await instance.init({ lng: 'tr', fallbackLng: 'en', resources: { tr: { translation: tr }, en: { translation: en } } });
  expect(instance.t('tabs.tasks')).toBe('Görevler');
  expect(instance.t('student.myTasks')).toBe('Görevlerim');
  expect(instance.t('student.stateWaiting')).toBe('İnceleme bekliyor');
  expect(instance.t('student.taskCriterion')).toBe('Değerlendirme kriteri');
  expect(instance.t('student.whatILearned')).toBe('Ne öğrendim?');
  expect(instance.t('errors.reflectionRequired')).toBe('Göndermeden önce ne öğrendiğini yaz.');
});
