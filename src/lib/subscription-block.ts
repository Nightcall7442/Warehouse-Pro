/**
 * Уводить ли на экран «подписка закрыта».
 *
 * Только когда сервер сказал «закрыто» (access.state приходит от того же
 * правила, что и калитка, — contracts/subscription-access). Прежде здесь было
 * своё правило — «статус не active и не trialing», — и экран запирал сразу,
 * пока сервер ещё пускал. Срок кончился — это 24 часа предупреждения, а не
 * запертая дверь (решение владельца 10.10.2026).
 */
export function blockedByServer(sub: { access?: { state?: string } | null } | null | undefined): boolean {
  return sub?.access?.state === "closed";
}
