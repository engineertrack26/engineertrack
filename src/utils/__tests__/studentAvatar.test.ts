import { avatarStage, isStudentAvatarId, STUDENT_AVATAR_IDS } from '../studentAvatar';

test('nine stable avatar choices, all available independently of XP', () => {
  expect(STUDENT_AVATAR_IDS).toHaveLength(9);
  expect(new Set(STUDENT_AVATAR_IDS).size).toBe(9);
  STUDENT_AVATAR_IDS.forEach(id => expect(isStudentAvatarId(id)).toBe(true));
});

test.each([null, undefined, '', '00', '10', '1', 1, {}, '../01'])('rejects invalid avatar ID %p', value => {
  expect(isStudentAvatarId(value)).toBe(false);
});

test.each([[1,1],[2,1],[3,1],[4,1],[5,5],[6,5],[7,5],[8,5],[9,5],[10,10],[11,10]])('stage mapping %s -> %s', (level, stage) => {
  expect(avatarStage(level)).toBe(stage);
});

test.each([NaN, Infinity, -Infinity, -1, 0])('invalid level %s has a safe base appearance', level => {
  expect(avatarStage(level)).toBe(1);
});
