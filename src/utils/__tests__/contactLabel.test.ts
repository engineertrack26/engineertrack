import { contactLabel } from '@/utils/contactLabel';

describe('contactLabel', () => {
  it('names the students a mentor mentors', () => {
    expect(contactLabel('mentor', ['Elif Kaya']))
      .toEqual({ roleKey: 'messages.roleMentor', pairKey: 'messages.mentorOf', names: 'Elif Kaya' });
    expect(contactLabel('mentor', ['Elif Kaya', 'Can Dogan']).names).toBe('Elif Kaya, Can Dogan');
  });
  it("names a student's mentor", () => {
    expect(contactLabel('student', ['Hakan Demir']))
      .toEqual({ roleKey: 'messages.roleStudent', pairKey: 'messages.mentoredBy', names: 'Hakan Demir' });
  });
  it('falls back to the role alone when there is no pairing', () => {
    expect(contactLabel('advisor', [])).toEqual({ roleKey: 'messages.roleAdvisor', names: '' });
    expect(contactLabel('student', undefined)).toEqual({ roleKey: 'messages.roleStudent', names: '' });
    expect(contactLabel('student', ['  '])).toEqual({ roleKey: 'messages.roleStudent', names: '' });
  });
});
