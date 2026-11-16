import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';
import { randomSecret, sha256, TOKEN_MS, SESSION_MS } from './auth-util';
interface Challenge {
  hash: string;
  expires: number;
  kind: 'bind' | 'login';
  profile: string | null;
  name: string;
}
interface Account {
  key: string;
  email: string;
  profile: string | null;
  verified: boolean;
  name: string;
}
interface Session {
  hash: string;
  expires: number;
}
export class AccountDO extends DurableObject<Env> {
  private chain: Promise<unknown> = Promise.resolve();
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const task = this.chain.then(work);
    this.chain = task.catch(() => {});
    return task;
  }
  private async meta() {
    return await this.ctx.storage.get<Account>('account');
  }
  private profile(id: string) {
    return this.env.PROFILE.get(this.env.PROFILE.idFromName(id));
  }
  async request(
    key: string,
    email: string,
    kind: 'bind' | 'login',
    profile: string | null,
    name: string,
    origin: string,
    ru: boolean,
  ): Promise<void> {
    return this.serial(async () => {
      const now = Date.now(),
        throttle = await this.ctx.storage.get<{
          at: number;
          day: string;
          count: number;
        }>('limit:' + kind);
      const day = new Date(now).toISOString().slice(0, 10);
      if (
        throttle &&
        (now - throttle.at < 60000 ||
          (throttle.day === day && throttle.count >= 5))
      )
        return;
      await this.ctx.storage.put('limit:' + kind, {
        at: now,
        day,
        count: throttle?.day === day ? throttle.count + 1 : 1,
      });
      await this.ctx.storage.setAlarm(now + 24 * 60 * 60_000);
      const account = await this.meta();
      if (kind === 'login') {
        if (
          !account?.profile ||
          (await this.profile(account.profile).linkedAccount())?.id !== key
        )
          return;
        if (!account.verified) {
          account.verified = true;
          await this.ctx.storage.put('account', account);
        }
      }
      const secret = randomSecret();
      const challenge: Challenge = {
        hash: await sha256(secret),
        expires: now + TOKEN_MS,
        kind,
        profile: kind === 'bind' ? profile : null,
        name,
      };
      await this.ctx.storage.put('challenge', challenge);
      if (!account)
        await this.ctx.storage.put('account', {
          key,
          email,
          profile: null,
          verified: false,
          name,
        } satisfies Account);
      await this.ctx.storage.setAlarm(now + TOKEN_MS);
      const link = `${origin}/auth#${key}.${secret}`;
      const text = ru
        ? `Нарды: ${kind === 'bind' ? 'сохранение прогресса' : 'вход в профиль'}.\n\nОткройте ссылку и подтвердите действие:\n${link}\n\nСсылка действует 10 минут и используется один раз. ${kind === 'bind' ? 'Откройте её в браузере, из которого отправлен запрос. ' : ''}Если вы не запрашивали письмо, просто проигнорируйте его.`
        : `Nardy: ${kind === 'bind' ? 'save your progress' : 'sign in'}.\n\nOpen the link and confirm:\n${link}\n\nThis link expires in 10 minutes and can be used once. ${kind === 'bind' ? 'Use the browser that requested this link. ' : ''}If you did not request it, ignore this email.`;
      this.ctx.waitUntil(
        this.env.EMAIL.send({
          from: { email: this.env.EMAIL_FROM!, name: 'Nardy' },
          to: email,
          subject: ru
            ? 'Нарды — одноразовая ссылка'
            : 'Nardy — one-time sign-in link',
          text,
          html: `<p>${text.replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!).replace(/\n/g, '<br>')}</p>`,
        }).catch(async () => {
          if (
            (await this.ctx.storage.get<Challenge>('challenge'))?.hash ===
            challenge.hash
          )
            await this.ctx.storage.delete('challenge');
          console.warn(JSON.stringify({ event: 'auth_email_delivery_failed' }));
        }),
      );
    });
  }
  async inspect(
    hash: string,
  ): Promise<{
    kind: 'bind' | 'login';
    email: string;
    name: string;
    target: string | null;
  } | null> {
    const c = await this.ctx.storage.get<Challenge>('challenge'),
      a = await this.meta();
    if (!c || !a || c.hash !== hash || c.expires <= Date.now()) return null;
    return {
      kind: c.kind,
      email: a.email,
      name: c.kind === 'bind' ? c.name : a.name,
      target: c.kind === 'bind' ? c.profile : a.profile,
    };
  }
  async confirm(
    hash: string,
    current: string | null,
  ): Promise<{ session?: string; name?: string; error?: string }> {
    return this.serial(async () => {
      const c = await this.ctx.storage.get<Challenge>('challenge'),
        a = await this.meta();
      if (!c || !a || c.hash !== hash || c.expires <= Date.now())
        return { error: 'expired_link' };
      if (c.kind === 'bind') {
        if (!current || current !== c.profile)
          return { error: 'same_browser_required' };
        if (a.profile && a.profile !== current)
          return { error: 'email_in_use' };
        if (await this.profile(current).rankedTicket())
          return { error: 'finish_ranked_first' };
        a.profile = current;
        a.name = c.name;
        // Persist recovery information before the cross-object link write.
        await this.ctx.storage.put('account', a);
        if (!(await this.profile(current).linkAccount(a.key, a.email)))
          return { error: 'profile_already_linked' };
        a.verified = true;
        await this.ctx.storage.put('account', a);
      }
      if (
        !a.verified ||
        !a.profile ||
        !(await this.profile(a.profile).getProfile())
      )
        return { error: 'expired_link' };
      if (
        current &&
        current !== a.profile &&
        (await this.profile(current).rankedTicket())
      )
        return { error: 'finish_ranked_first' };
      const secret = randomSecret(),
        session: Session = {
          hash: await sha256(secret),
          expires: Date.now() + SESSION_MS,
        };
      await this.ctx.storage.transaction(async (tx) => {
        await tx.put('session:' + session.hash, session);
        await tx.delete('challenge');
      });
      await this.schedule();
      return { session: a.key + '.' + secret, name: a.name };
    });
  }
  async resolve(hash: string): Promise<string | null> {
    const session = await this.ctx.storage.get<Session>('session:' + hash),
      a = await this.meta();
    return session &&
      session.expires > Date.now() &&
      a?.verified &&
      a.profile &&
      (await this.profile(a.profile).getProfile())
      ? a.profile
      : null;
  }
  async status(hash: string): Promise<{ email: string; name: string } | null> {
    if (!(await this.resolve(hash))) return null;
    const a = (await this.meta())!;
    return { email: a.email, name: a.name };
  }
  async logout(hash: string): Promise<void> {
    await this.ctx.storage.delete('session:' + hash);
  }
  async erase(profile: string): Promise<void> {
    return this.serial(async () => {
      if ((await this.meta())?.profile === profile) {
        await this.ctx.storage.deleteAll();
        await this.ctx.storage.deleteAlarm();
      }
    });
  }
  private async schedule() {
    const sessions = await this.ctx.storage.list<Session>({
        prefix: 'session:',
      }),
      c = await this.ctx.storage.get<Challenge>('challenge');
    const times = [...sessions.values()].map((s) => s.expires);
    if (c) times.push(c.expires);
    const limits = await this.ctx.storage.list<{ at: number }>({
      prefix: 'limit:',
    });
    for (const limit of limits.values())
      times.push(limit.at + 24 * 60 * 60_000);
    if ((await this.meta())?.profile) times.push(Date.now() + 24 * 60 * 60_000);
    if (times.length)
      await this.ctx.storage.setAlarm(
        Math.max(Date.now() + 1000, Math.min(...times)),
      );
    else await this.ctx.storage.deleteAlarm();
  }
  override async alarm(): Promise<void> {
    await this.serial(async () => {
      const now = Date.now(),
        c = await this.ctx.storage.get<Challenge>('challenge');
      if (c && c.expires <= now) await this.ctx.storage.delete('challenge');
      for (const [key, s] of await this.ctx.storage.list<Session>({
        prefix: 'session:',
      }))
        if (s.expires <= now) await this.ctx.storage.delete(key);
      const a = await this.meta();
      if (a?.profile && !(await this.profile(a.profile).getProfile())) {
        await this.ctx.storage.deleteAll();
        return;
      }
      if (
        !(await this.ctx.storage.get('challenge')) &&
        (!a?.profile ||
          (!a.verified &&
            (await this.profile(a.profile).linkedAccount())?.id !== a.key))
      )
        await this.ctx.storage.delete('account');
      for (const [key, limit] of await this.ctx.storage.list<{ at: number }>({
        prefix: 'limit:',
      }))
        if (limit.at + 24 * 60 * 60_000 <= now)
          await this.ctx.storage.delete(key);
      await this.schedule();
    });
  }
}
