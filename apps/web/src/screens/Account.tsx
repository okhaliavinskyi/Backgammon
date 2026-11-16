import { useEffect, useState } from 'react';
import { authError, authPost, loadAccount, useAccount } from '../lib/auth';
import { useSettings } from '../lib/settings';
import { PageHead, type Nav } from './Menus';
export function EmailAccountPanel() {
  const ru = useSettings((s) => s.lang) === 'ru',
    state = useAccount();
  const [kind, setKind] = useState<'bind' | 'login'>('bind'),
    [email, setEmail] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    void loadAccount();
  }, []);
  return (
    <section className="card email-account">
      <h3>{ru ? 'Сохранить прогресс по email' : 'Save progress with email'}</h3>
      {state.account ? (
        <>
          <p>
            {ru ? 'Привязан:' : 'Linked:'} {state.account.email}
          </p>
          <p className="muted">
            {ru
              ? 'Для входа на другом устройстве запросите ссылку на этот email.'
              : 'Request a sign-in link on another device using this email.'}
          </p>
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await authPost('logout', {});
                try {
                  const guestName = sessionStorage.getItem('nardy.guestName');
                  if (guestName !== null) useSettings.getState().set({ name: guestName });
                  sessionStorage.removeItem('nardy.guestName');
                } catch { /* Browser storage may be unavailable. */ }
                location.replace('/profile');
              } catch (e) {
                setMessage(authError((e as Error).message, ru));
                setBusy(false);
              }
            }}
          >
            {ru ? 'Выйти на этом устройстве' : 'Sign out on this device'}
          </button>
        </>
      ) : (
        <>
          <p>
            {ru
              ? 'Необязательно. Привязка сохраняет опыт, монеты, покупки и рейтинг этого профиля. Для игры email не нужен.'
              : 'Optional. Linking keeps this profile’s XP, coins, purchases and ratings. You never need email to play.'}
          </p>
          {state.loaded && !state.configured ? (
            <p className="muted">
              {ru
                ? 'Отправка писем ещё не настроена. Можно продолжать играть гостем.'
                : 'Email delivery is not configured yet. You can keep playing as a guest.'}
            </p>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setMessage('');
                try {
                  await authPost('request', {
                    email,
                    kind,
                    name: useSettings.getState().name,
                    lang: useSettings.getState().lang,
                  });
                  setMessage(
                    ru
                      ? 'Если запрос допустим, письмо придёт в ближайшее время. Проверьте спам. Повторный запрос — не чаще раза в минуту.'
                      : 'If eligible, your link will arrive shortly. Check spam. Please wait a minute before requesting another link.',
                  );
                } catch (e) {
                  setMessage(authError((e as Error).message, ru));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="seg">
                <button
                  type="button"
                  className={kind === 'bind' ? 'on' : ''}
                  onClick={() => setKind('bind')}
                >
                  {ru ? 'Сохранить этот профиль' : 'Save this profile'}
                </button>
                <button
                  type="button"
                  className={kind === 'login' ? 'on' : ''}
                  onClick={() => setKind('login')}
                >
                  {ru ? 'Войти в существующий' : 'Sign in to existing'}
                </button>
              </div>
              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <button className="btn primary" disabled={busy || !state.loaded}>
                {ru ? 'Отправить одноразовую ссылку' : 'Send one-time link'}
              </button>
            </form>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
export function EmailLinkScreen({ nav }: { nav: Nav }) {
  const ru = useSettings((s) => s.lang) === 'ru';
  const [token] = useState(() => location.hash.slice(1));
  useEffect(() => {
    history.replaceState(null, '', location.pathname);
  }, []);
  const [info, setInfo] = useState<{
      kind: 'bind' | 'login';
      email: string;
      name: string;
      hasGuestProgress: boolean;
    } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void authPost('inspect', { token })
      .then((data) => {
        if (active) setInfo(data);
      })
      .catch((e) => {
        if (active) setError(authError(e.message, ru));
      });
    return () => {
      active = false;
    };
  }, [token]);
  return (
    <main className="screen form">
      <PageHead
        title={ru ? 'Подтверждение email' : 'Email confirmation'}
        onBack={() => nav('/profile')}
      />
      {!info && !error && (
        <p role="status">{ru ? 'Проверяем ссылку…' : 'Checking link…'}</p>
      )}
      {info && (
        <section className="card email-account">
          <p>{info.email}</p>
          <p>
            {info.kind === 'bind'
              ? ru
                ? 'Привязать этот email к текущему профилю? Весь прогресс сохранится.'
                : 'Link this email to your current profile? All progress is preserved.'
              : ru
                ? 'Войти в сохранённый профиль из письма?'
                : 'Sign in to the saved profile from this email?'}
          </p>
          {info.kind === 'login' && info.hasGuestProgress && (
            <p>
              {ru
                ? 'На устройстве есть другой профиль. Балансы и опыт не объединяются. Гостевой профиль останется в этом браузере и будет доступен после выхода.'
                : 'This device has another profile. Balances and XP are not merged. A guest profile stays in this browser and is available after signing out.'}
            </p>
          )}
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const result = await authPost('confirm', {
                  token,
                  confirm: true,
                });
                if (info.kind === 'login') {
                  try {
                    if (sessionStorage.getItem('nardy.guestName') === null)
                      sessionStorage.setItem('nardy.guestName', useSettings.getState().name);
                  } catch { /* Naming preferences do not gate authentication. */ }
                }
                if (result.name)
                  useSettings.getState().set({ name: result.name });
                location.replace('/profile');
              } catch (e) {
                setError(authError((e as Error).message, ru));
                setBusy(false);
              }
            }}
          >
            {info.kind === 'bind'
              ? ru
                ? 'Привязать и сохранить'
                : 'Link and save'
              : ru
                ? 'Войти в профиль из письма'
                : 'Sign in to emailed profile'}
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() => nav('/profile')}
          >
            {ru ? 'Оставить текущий профиль' : 'Keep current profile'}
          </button>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
