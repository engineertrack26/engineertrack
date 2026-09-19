import { readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import { mapRpcError } from '../rpcErrors';

const en = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const tr = JSON.parse(readFileSync('src/i18n/locales/tr.json', 'utf8'));

test('stream copy is translated, except language-neutral counters and URLs', () => {
  for (const key of Object.keys(en.feed)) {
    if (['charCount', 'linkUrlPlaceholder'].includes(key)) continue;
    expect(tr.feed[key]).toEqual(expect.any(String));
    expect(tr.feed[key]).not.toBe(en.feed[key]);
  }
});

test('Turkish stream counts, draft actions and errors do not fall back to English', async () => {
  const instance = createInstance();
  await instance.init({ lng: 'tr', fallbackLng: 'en', resources: { tr: { translation: tr }, en: { translation: en } } });
  for (const count of [0, 1, 3]) {
    expect(instance.t('feed.commentCount', { count })).toBe(`${count} yorum`);
    expect(instance.t('feed.likeCount', { count })).toBe(`${count} beğeni`);
    expect(instance.t('feed.votes', { count })).toBe(`${count} oy`);
    expect(instance.t('feed.postedToAll', { count })).toBe(`${count} grupta paylaşıldı.`);
  }
  expect(instance.t('feed.saveDraft', 'Save draft')).toBe('Taslak kaydet');
  expect(instance.t('feed.publish', 'Publish')).toBe('Yayınla');
  expect(instance.t('advisor.archived')).toBe('Arşivlendi');
  expect(instance.t('notifications.taskAssignedTitle')).toBe('Yeni görev atandı');
  expect(instance.t('feed.postedToSome', { ok: 1, total: 2, failed: 'Grup B' }))
    .toBe('2 grubun 1 tanesinde paylaşıldı. Başarısız: Grup B');
  for (const code of ['NOT_GROUP_OWNER', 'NOT_IN_GROUP', 'NOT_OWNER', 'KIND_NOT_ALLOWED',
    'POLL_OPTIONS_RANGE', 'OPTION_MISMATCH', 'POST_NOT_FOUND', 'ATTACHMENT_LIMIT']) {
    const { key } = mapRpcError(code);
    const name = key.split('.')[1];
    expect(tr.errors[name]).toEqual(expect.any(String));
    expect(instance.t(key)).toBe(tr.errors[name]);
    expect(instance.t(key)).not.toBe(en.errors[name]);
  }
});
