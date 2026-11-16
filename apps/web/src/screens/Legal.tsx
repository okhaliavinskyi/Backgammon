import { gamePath } from '../lib/paths';
import { useState } from 'react';
import { useSettings } from '../lib/settings';
import { clearDeviceData, downloadProfileData } from '../lib/privacy';
import { legalContact, legalReadyForPublication, legalVersion } from '../lib/legal';

export function LegalLinks() {
  const ru = useSettings((s) => s.lang) === 'ru';
  return <footer className="legal-links">
    <a href={gamePath('/privacy')}>{ru ? 'Приватность' : 'Privacy'}</a>
    <a href={gamePath('/terms')}>{ru ? 'Условия' : 'Terms'}</a>
    <a href={gamePath('/legal')}>{ru ? 'О проекте и связь' : 'About & contact'}</a>
  </footer>;
}
export function PrivacyNotice() {
  const ru = useSettings((s) => s.lang) === 'ru';
  return <p className="privacy-notice">{ru
    ? 'Используйте псевдоним. Ник виден сопернику, а у создателя публичной комнаты — в лобби. Онлайн-игра сохраняет гостевой профиль и прогресс в этом браузере. Не отправляйте личные данные в чат. '
    : 'Use a nickname. Your opponent sees it; public room hosts also appear in the lobby. Online play saves a guest profile and progress for this browser. Keep personal data out of chat. '}
    <a href={gamePath('/privacy')}>{ru ? 'О данных' : 'About your data'}</a> · <a href={gamePath('/terms')}>{ru ? 'Условия игры' : 'Game terms'}</a>
  </p>;
}

const privacySections = {
  ru: [
    ['Данные онлайн-игры', 'Регистрация и email игрока не требуются. Сервер хранит псевдоним, токен возврата в комнату, состояние и результаты партии, время активности, последние 50 сообщений чата и хеш пароля комнаты. Ник виден сопернику; ник создателя публичной комнаты также показывается в лобби. Оформление аватара и рамки видно сопернику. Чат получают участники комнаты. Оператор и Cloudflare могут иметь технический доступ к серверным данным.'],
    ['Гостевой профиль', 'При первом онлайн-входе или открытии профиля создаётся гостевой профиль. Cookie nardy_guest — секретный ключ доступа: HttpOnly, SameSite=Strict, Secure на HTTPS; срок — до 365 дней, продлевается при инициализации профиля. Сервер хранит опыт, игровые монеты, коллекцию и выбранное оформление, статистику, личный счёт встреч и записи начислений. Игровые монеты не покупаются за деньги, не выводятся и не обмениваются на деньги. Очистка браузера может лишить доступа к профилю; восстановление и перенос между устройствами без сохранённого доступа не предусмотрены.'],
    ['Цели и правовые основания', 'Для работы запрошенной онлайн-игры, сохранения прогресса и защиты от злоупотреблений используется законный интерес оператора поддерживать безопасный бесплатный хобби-сервис (статья 6(1)(f) GDPR, когда он применим). Для исполнения конкретных юридических обязанностей применяется статья 6(1)(c). Вы можете возразить против обработки на основании законного интереса. Мы не используем эти данные для рекламы, продажи данных или принятия решений, имеющих юридические либо сопоставимые существенные последствия.'],
    ['Cookie и другие данные браузера', 'Кроме гостевого cookie, localStorage сохраняет настройки, псевдоним, игру с ИИ и последнюю онлайн-комнату (код, ники, счёт). Токены комнат очищаются при следующем открытии приложения спустя 24 часа после последнего успешного входа; старым токенам без даты она присваивается при первом запуске обновлённой игры. sessionStorage временно хранит пароль созданной комнаты до входа или закрытия вкладки. Service Worker и Cache Storage хранят файлы игры для офлайн-работы. Эти механизмы обеспечивают запрошенные функции игры; рекламных и аналитических трекеров в приложении нет.'],
    ['Сроки хранения', 'Комната и её чат удаляются при проверке после 30 минут неактивности, если подключённых игроков нет; подключённые игроки продлевают её существование. Гостевой профиль хранится до удаления пользователем или до истечения 365 дней после последней инициализации профиля при онлайн-входе или открытии профиля. Настройки и сохранённая игра с ИИ остаются до очистки. Сроки журналов и резервных копий инфраструктуры проверяются отдельно: удаление из рабочей базы не означает мгновенное удаление всех резервных копий.'],
    ['Cloudflare и международная обработка', 'Cloudflare обеспечивает хостинг, сетевые соединения, защиту и хранение данных. При этом обрабатываются сетевые сведения, включая IP-адрес; он также используется для ограничения частоты запросов. Приложение не гарантирует хранение исключительно в ЕС. До публикации окончательной политики оператор должен подтвердить применимые договорные условия, механизмы международных передач и сроки инфраструктурного хранения.'],
    ['Ваши права', 'Если применяется GDPR, вы можете запросить доступ, исправление, удаление, ограничение обработки, переносимость и возразить против обработки в предусмотренных законом случаях. Данные профиля можно выгрузить или удалить кнопками ниже. Для остальных обращений будет указан email проекта. Не отправляйте пароли и токены; достаточно описания, кода комнаты и времени игры. Проверка принадлежности данных должна быть соразмерной. Обычно ответ предоставляется в течение месяца с предусмотренными законом исключениями. Можно обратиться в компетентный надзорный орган, в том числе AEPD в Испании.'],
    ['Что удаляют кнопки', '«Удалить данные на этом устройстве» очищает доступ к профилю, настройки, сохранения, токены и офлайн-кеш, сохраняя серверный профиль до истечения его срока. «Удалить профиль и данные устройства» дополнительно удаляет прогресс и записи начислений из рабочей базы профиля. Данные текущей комнаты и уже полученные соперником сообщения этим не стираются; комната удаляется по описанному выше правилу. Сводные результаты в профилях соперников могут оставаться частью их статистики. Выгрузка не содержит секретов доступа или секретных идентификаторов соперников.'],
    ['Датчики и дети', 'Бросок встряхиванием обрабатывает показания движения локально, без отправки серверу; его можно выключить. Не указывайте дату рождения, адрес, школу и другие личные сведения в нике или чате. Игра не запрашивает детские персональные сведения. Если для использования сервиса по местному закону требуется участие законного представителя, используйте игру с его участием. Возрастные условия для стран предоставления ещё требуют проверки перед окончательной публикацией.'],
  ],
  en: [
    ['Online game data', 'No registration or player email is required. The server stores nicknames, room reconnect tokens, game state and results, activity times, the latest 50 chat messages and a room password hash. Your opponent sees your nickname; public room hosts also appear in the lobby. Opponents can see equipped avatars and frames. Chat is delivered to room participants. The operator and Cloudflare may have technical access to server data.'],
    ['Guest profile', 'A guest profile is created on first online entry or when opening the profile. The nardy_guest cookie is a secret access credential: HttpOnly, SameSite=Strict and Secure on HTTPS; it lasts up to 365 days and is renewed on profile initialization. The server stores XP, game coins, owned and equipped cosmetics, statistics, head-to-head scores and reward records. Coins cannot be purchased for money, withdrawn or exchanged for money. Clearing the browser may lose access; recovery or transfer across devices without existing access is not provided.'],
    ['Purposes and legal bases', 'Where GDPR applies, providing the requested online game, saving progress and preventing abuse rely on the operator’s legitimate interest in running a safe, free hobby service (Article 6(1)(f)). Specific legal obligations rely on Article 6(1)(c). You may object to legitimate-interest processing. Data is not used for advertising, sale or decisions with legal or similarly significant effects.'],
    ['Cookies and browser storage', 'In addition to the guest cookie, localStorage stores preferences, a nickname, an AI game and the latest online room (code, names and score). Room tokens are cleared on the next app launch over 24 hours after the last successful join; legacy undated tokens are dated on first launch after upgrading. sessionStorage holds a newly created room password until joining or closing the tab. Service Worker and Cache Storage store game files offline. These mechanisms support requested game features; no advertising or analytics trackers are included.'],
    ['Retention', 'A room and its chat are deleted at an inactivity check after 30 minutes if no players remain connected; connected players extend its lifetime. Guest profiles remain until user deletion or 365 days after the last profile initialization on online entry or opening the profile. Preferences and AI saves remain until cleared. Infrastructure log and backup retention require separate verification: deletion from the live database does not mean instant deletion of every backup.'],
    ['Cloudflare and international processing', 'Cloudflare provides hosting, network connections, protection and data storage. Network information including IP addresses is processed; IP addresses also support request rate limits. EU-only storage is not guaranteed. The operator must verify applicable processing agreements, international transfer mechanisms and infrastructure retention before publishing the final policy.'],
    ['Your rights', 'Where GDPR applies, you may request access, correction, erasure, restriction, portability and object as provided by law. Use the buttons below to export or erase profile data. A project email will be added for other requests. Never send passwords or tokens; provide a description, room code and approximate game time. Verification must be proportionate. Responses are normally due within one month, subject to legal exceptions. You may complain to the competent supervisory authority, including Spain’s AEPD.'],
    ['Deletion controls', '“Delete data on this device” removes profile access, preferences, saves, tokens and offline cache; the server profile remains until expiry. “Delete profile and device data” also removes progress and reward records from the live profile database. Current room data and messages already received by opponents are not erased by these actions; rooms expire as described above. Aggregate results in opponents’ profiles may remain as part of their statistics. Exports exclude access secrets and opponents’ secret identifiers.'],
    ['Sensors and children', 'Shake-to-roll processes motion locally without sending readings to the server and can be disabled. Do not share birth dates, addresses, schools or other personal details in nicknames or chat. The game does not request children’s personal details. Where local law requires a legal representative’s involvement to use the service, use it with that involvement. Country-specific age terms still require review before final publication.'],
  ],
};

export function LegalPage({ page }: { page: 'privacy' | 'terms' | 'legal' }) {
  const ru = useSettings((s) => s.lang) === 'ru';
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const title = page === 'privacy' ? (ru ? 'Приватность и хранение данных' : 'Privacy & storage') : page === 'terms' ? (ru ? 'Условия использования' : 'Terms of use') : (ru ? 'О проекте и связь' : 'About & contact');
  const action = async (fn: () => Promise<void>) => {
    setBusy(true); setMessage('');
    try { await fn(); }
    catch (e) { setMessage(e instanceof Error && e.message === 'no_profile'
      ? (ru ? 'В этом браузере нет доступного гостевого профиля.' : 'No guest profile is available in this browser.')
      : (ru ? 'Операция не завершена. Проверьте соединение и попробуйте снова.' : 'The operation did not finish. Check your connection and retry.')); }
    finally { setBusy(false); }
  };
  const remove = (profile: boolean) => {
    const question = profile
      ? (ru ? 'Удалить серверный профиль, опыт, монеты и данные этого устройства? Действие нельзя отменить.' : 'Delete your server profile, XP, coins and this device’s data? This cannot be undone.')
      : (ru ? 'Удалить данные игры на этом устройстве? Доступ к профилю и прежним комнатам будет утрачен.' : 'Delete game data on this device? You will lose access to your profile and existing rooms.');
    if (confirm(question)) void action(() => clearDeviceData(profile));
  };
  return <main className="screen legal-page">
    <a href={gamePath('/')}>← {ru ? 'К игре' : 'Back to game'}</a><h1>{title}</h1>
    {!legalReadyForPublication && <p role="status" className="error">{ru
      ? 'Предварительная редакция. Email проекта будет добавлен позже. Идентификация оператора и условия для стран предоставления ещё не завершены; документ не является окончательным юридическим оформлением.'
      : 'Preliminary version. The project email will be added later. Operator identification and country-specific terms remain incomplete; this is not final legal documentation.'}</p>}
    <p>{ru ? 'Редакция' : 'Version'}: {legalVersion}</p>
    {page === 'privacy' && <>
      {privacySections[ru ? 'ru' : 'en'].map(([heading, body]) => <section key={heading}><h2>{heading}</h2><p>{body}</p></section>)}
      <div className="privacy-actions">
        <button className="btn" disabled={busy} onClick={() => void action(downloadProfileData)}>{ru ? 'Скачать данные профиля' : 'Download profile data'}</button>
        <button className="btn" disabled={busy} onClick={() => remove(false)}>{ru ? 'Удалить данные на этом устройстве' : 'Delete data on this device'}</button>
        <button className="btn" disabled={busy} onClick={() => remove(true)}>{ru ? 'Удалить профиль и данные устройства' : 'Delete profile and device data'}</button>
      </div>
      {message && <p role="alert">{message}</p>}
    </>}
    {page === 'terms' && <>
      <h2>{ru ? 'Бесплатная игра' : 'Free game'}</h2>
      <p>{ru ? 'Нарды — бесплатный хобби-проект. Сейчас нет рекламы, денежных ставок и пополнений баланса. Игровые монеты, опыт, уровни и оформление не являются деньгами, не выводятся и не обмениваются на деньги или внешние ценности. Магазин использует только заработанные игровые монеты. Игровые очки и кубик удвоения служат для счёта партии. Денежные пари и продажа мест или профилей через сервис запрещены.' : 'Nardy is a free hobby project with no current advertising, monetary bets or balance top-ups. Game coins, XP, levels and cosmetics are not money and cannot be withdrawn or exchanged for money or external value. The shop uses earned game coins only. Game points and the doubling cube score matches. Monetary wagers and selling seats or profiles through the service are prohibited.'}</p>
      <h2>{ru ? 'Правила поведения и жалобы' : 'Conduct and complaints'}</h2>
      <p>{ru ? 'Не публикуйте чужие персональные данные, угрозы, незаконный контент, спам или материалы, нарушающие чужие права. Не пытайтесь получить доступ к чужой позиции или нарушить работу сервиса. Можно скрыть сообщения соперника или выйти из комнаты. Email проекта для жалоб будет добавлен на страницу связи. Для обращения укажите код комнаты, время и описание; не отправляйте пароли и токены.' : 'Do not share others’ personal data, threats, illegal content, spam or infringing material. Do not access others’ seats or disrupt the service. You can hide opponent messages or leave a room. A project email for reports will be added to the contact page. Include the room code, time and description; never send passwords or tokens.'}</p>
      <h2>{ru ? 'Доступ и сохранения' : 'Access and saves'}</h2>
      <p>{ru ? 'Возврат в занятую позицию возможен только с сохранённым токеном. Доступ к гостевому прогрессу связан с cookie браузера; восстановление после утраты доступа не предусмотрено. Комнаты временные, непрерывная доступность не гарантируется. Если местное право требует участия законного представителя, используйте сервис с его участием. Условия не ограничивают обязательные права пользователя и ответственность, которую нельзя исключить по закону.' : 'Occupied seats require their saved token. Guest progress access depends on the browser cookie; recovery after losing access is not provided. Rooms are temporary and continuous availability is not guaranteed. Where local law requires a legal representative’s involvement, use the service with that involvement. These terms do not limit mandatory user rights or liability that cannot lawfully be excluded.'}</p>
      <h2>{ru ? 'Изменения сервиса' : 'Service changes'}</h2>
      <p>{ru ? 'При существенных изменениях будет обновлена дата редакции и показано доступное уведомление. Возможная реклама требует предварительного обновления этих условий и политики приватности, проверки поставщика и получения согласия до включения необязательных трекеров, когда оно требуется. Текущие условия не означают согласия на будущую рекламу или отслеживание.' : 'Material changes require an updated version date and an accessible notice. Future advertising requires prior updates to these terms and privacy policy, provider review and consent before non-essential tracking where required. These terms do not constitute consent to future advertising or tracking.'}</p>
    </>}
    {page === 'legal' && <>
      <p>{ru ? 'Nardy — бесплатный хобби-проект: нарды в браузере, без денежных ставок и пополнений.' : 'Nardy is a free hobby project: browser backgammon with no monetary bets or balance top-ups.'}</p>
      <h2>{ru ? 'Связь с проектом' : 'Contact the project'}</h2>
      {legalContact.email ? <p><a href={`mailto:${legalContact.email}`}>{legalContact.email}</a></p> : <p>{ru ? 'Отдельный email проекта пока не опубликован. Форма обращения ещё не доступна.' : 'A dedicated project email has not been published yet. A contact form is not available.'}</p>}
      <p>{ru ? 'Контакт будет использоваться для вопросов о данных, жалобах на контент, правах на материалы и сообщениях об уязвимостях. Не отправляйте пароли и токены.' : 'The contact will handle privacy requests, content complaints, rights concerns and vulnerability reports. Do not send passwords or tokens.'}</p>
    </>}
    <p><a href={gamePath('/third-party-notices.txt')}>{ru ? 'Лицензии библиотек' : 'Third-party licenses'}</a> · <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer">Cloudflare Privacy Policy</a></p>
    {page === 'privacy' && <section>
      <h2>{ru ? 'Добровольный вход по email' : 'Optional email sign-in'}</h2>
      <p>{ru ? 'По желанию можно подтвердить email одноразовой ссылкой и связать его с существующим прогрессом. Пароль не создаётся. Сервер хранит подтверждённый адрес и связь с профилем; сессии устройств используют HttpOnly cookie до 90 дней и хеши секретов на сервере. Ссылки действуют 10 минут и используются один раз. Вход не объединяет балансы. Письма служат только подтверждению и входу, рассылки не подключены. Выход отзывает сессию устройства; удаление профиля удаляет привязку и отзывает все его сессии. Данные комнаты и результаты у соперника сохраняются по прежним правилам.' : 'You may verify an email with a one-time link and attach it to existing progress. No password is created. The server stores the verified address and profile link; device sessions use HttpOnly cookies for up to 90 days and server-side secret hashes. Links expire after 10 minutes and work once. Signing in does not merge balances. Email is transactional confirmation/sign-in only, with no marketing subscription. Logout revokes this device session; profile erasure removes the email link and revokes its sessions. Room data and opponents’ independent results follow the existing rules.'}</p>
    </section>}
    <LegalLinks />
  </main>;
}
