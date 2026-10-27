/** Keep an account's draft private when renewal fails or switches the identity. */
export async function prepareLearningScope(auth: { ensureSession(): Promise<void> }, store: { getScope(): string }): Promise<string> {
  const startingScope = store.getScope()
  await auth.ensureSession()
  const scope = store.getScope()
  if (startingScope !== 'guest' && scope !== startingScope) {
    throw new Error('登录已失效或账号已切换，学习主题仍保留在原账号。请重新登录后重试。')
  }
  return scope
}
