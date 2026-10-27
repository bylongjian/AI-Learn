export interface UserProfile {
  id: string
  nickname: string
  avatar_url: string
  total_xp: number
  quiz_count: number
  correct_count: number
  average_accuracy: number | null
  is_test: boolean
}
export interface LoginResult { token: string; expires_in: number; user: UserProfile }
export interface Credentials { token: string; userId: string }

export function isProfile(value: unknown): value is UserProfile {
  if (!value || typeof value !== 'object') return false
  const p = value as UserProfile
  return typeof p.id === 'string' && /^\d+$/.test(p.id) && p.id !== '0' &&
    typeof p.nickname === 'string' && !!p.nickname.trim() && typeof p.avatar_url === 'string' &&
    [p.total_xp, p.quiz_count, p.correct_count].every(n => Number.isSafeInteger(n) && n >= 0) &&
    (p.average_accuracy === null || (Number.isFinite(p.average_accuracy) && p.average_accuracy >= 0 && p.average_accuracy <= 100)) &&
    typeof p.is_test === 'boolean'
}
