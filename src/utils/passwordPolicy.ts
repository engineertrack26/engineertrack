/**
 * Minimum password length. Mirrors the Supabase dashboard setting
 * (Authentication › Sign In / Providers › Email › Minimum password length),
 * which must be kept at the same value — the client checks first so the
 * field can be marked, the server refuses anyway with `weak_password`.
 * Length plus the leaked-password check (`services/pwnedPasswords.ts`), no
 * character-class rules: NIST SP 800-63B.
 */
export const PASSWORD_MIN_LENGTH = 8;
