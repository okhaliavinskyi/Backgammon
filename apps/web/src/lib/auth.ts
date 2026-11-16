import { create } from 'zustand';
export const useAccount = create<{
  loaded: boolean;
  configured: boolean;
  account: { email: string; name: string } | null;
}>(() => ({ loaded: false, configured: false, account: null }));
export async function loadAccount() {
  try {
    const r = await fetch('/api/auth/status');
    if (!r.ok) return;
    useAccount.setState({ ...(await r.json()), loaded: true });
  } catch {
    useAccount.setState({ loaded: true });
  }
}
export async function authPost(path: string, body: unknown) {
  const r = await fetch('/api/auth/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? 'unavailable');
  return data;
}
export function authError(code: string, ru: boolean): string {
  const messages: Record<string, [string, string]> = {
    expired_link: [
      'Ссылка истекла или уже использована. Запросите новую.',
      'This link expired or was already used. Request a new one.',
    ],
    same_browser_required: [
      'Откройте ссылку в браузере, где запросили привязку.',
      'Open this binding link in the browser that requested it.',
    ],
    email_in_use: [
      'Этот email уже связан с другим профилем. Выберите вход по email вместо привязки; балансы не объединяются.',
      'This email already belongs to another profile. Choose email sign-in instead of linking; balances are not merged.',
    ],
    profile_already_linked: [
      'Профиль уже связан с другим email.',
      'This profile is linked to another email.',
    ],
    finish_ranked_first: [
      'Сначала завершите рейтинговый матч или отмените поиск.',
      'Finish your ranked match or cancel matchmaking first.',
    ],
    email_not_configured: [
      'Отправка писем пока не настроена. Гостевая игра доступна.',
      'Email delivery is not configured yet. Guest play is available.',
    ],
    invalid_email: ['Проверьте адрес email.', 'Check the email address.'],
    rate_limited: [
      'Слишком много запросов. Попробуйте позже.',
      'Too many requests. Please try later.',
    ],
  };
  return (
    messages[code]?.[ru ? 0 : 1] ??
    (ru
      ? 'Не удалось выполнить действие. Попробуйте снова.'
      : 'Could not complete the action. Please retry.')
  );
}
