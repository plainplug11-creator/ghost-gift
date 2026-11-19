/**
 * Legal & info documents (lazy chunk — only loaded when a document is opened).
 * Professional, generic wording; not legal advice. Update CONTACT / dates before major releases.
 */
import type { Lang } from '../core/i18n';

export type DocId = 'fair' | 'terms' | 'privacy' | 'play' | 'about';
export interface Doc { title: string; updated: string; sections: { h?: string; p: string[] }[] }

export const CONTACT = '@GhostGift_Game';
const UPDATED = { ru: 'Обновлено: 19 ноября 2026', en: 'Last updated: November 19, 2026', uk: 'Оновлено: 19 листопада 2026' };

const ru: Record<DocId, Doc> = {
  fair: { title: 'Честная игра и шансы', updated: UPDATED.ru, sections: [
    { p: ['Ghost Gift использует схему provably fair: результат каждого открытия определяется заранее и может быть проверен вами самостоятельно. Ни приложение, ни мы не можем подменить результат после того, как вы нажали «Открыть».'] },
    { h: 'Как это работает', p: [
      '1. До раунда сервер создаёт секретный server seed и показывает вам его отпечаток — SHA-256(server seed). Он виден на странице кейса как «Хэш раунда».',
      '2. У вас есть client seed, а у каждого открытия — порядковый номер nonce.',
      '3. Результат: HMAC-SHA256(server seed, «client seed:nonce»). Первые 13 hex-символов переводятся в число от 0 до 1.',
      '4. Это число выбирает приз по таблице весов кейса: чем больше вес, тем больше шанс. Шансы каждого приза показаны в кейсе с точностью до тысячных процента.',
      '5. После раунда server seed раскрывается. Посчитайте SHA-256 от него — он должен совпасть с хэшем, показанным до раунда.'] },
    { h: 'Возврат (RTP)', p: ['RTP — средний возврат стоимости на длинной дистанции, рассчитанный из той же таблицы весов, по которой работает генератор. Он указан на каждом кейсе. Это статистика, а не гарантия результата отдельного открытия.'] },
    { h: 'NFT и бонусы', p: ['NFT-призы попадают в таблицу только пока они есть в наличии, и тогда шансы на странице кейса обновляются. NFT-приз — один настоящий коллекционный подарок Telegram указанной коллекции; модель, фон и номер могут отличаться от картинки-примера. Его стоимость в звёздах — рыночная цена коллекции, по ней же его можно продать. NFT передаётся в профиль Telegram вручную, обычно в течение нескольких часов; если передать не получается, полная стоимость возвращается на баланс. Бонусы удачи немного увеличивают вес дорогих призов только на недорогих кейсах, на NFT не действуют и всегда отражаются в показанных шансах.', 'Изображения NFT-коллекций — публичные превью Fragment; названия, изображения и товарные знаки подарков принадлежат Telegram и их правообладателям.'] },
    { h: 'Колесо и слоты', p: ['Колесо и слоты работают на той же цепочке seed: HMAC-SHA256(server seed, «client seed:nonce») выбирает исход по опубликованной таблице. На колесе 20 секторов, размер каждого пропорционален его шансу; RTP колеса — 86,7%. В слотах исход выбирается из таблицы выплат (×40 … ×0), RTP — 86,5%; символы на барабанах — отдельный косметический бросок из того же seed и на выплату не влияют. Полные таблицы шансов открываются кнопкой «i» в каждой игре. Максимальная ставка может временно снижаться, чтобы банк призов оставался в плюсе.'] },
    { h: 'Карта удачи', p: ['Раз в сутки (по Киеву) можно вытянуть карту: +3% (шанс 45%), +5% (30%), +7% (17%) или +10% (8%). На 24 часа она увеличивает вес призов дороже самого кейса в кейсах до 50 звёзд (NFT не затрагиваются). RTP всех кейсов, включая максимальную удачу, остаётся в пределах 85–88%.'] },
    { h: 'Проверка', p: ['Ниже есть встроенный проверщик: вставьте server seed, client seed и nonce из результата — он посчитает число и покажет приз по базовой таблице кейса.'] },
  ] },
  terms: { title: 'Условия использования', updated: UPDATED.ru, sections: [
    { p: ['Используя Ghost Gift («приложение»), вы соглашаетесь с этими условиями. Если вы не согласны, пожалуйста, не используйте приложение.'] },
    { h: '1. Возраст и доступ', p: ['Приложение предназначено только для лиц старше 18 лет (или старше возраста совершеннолетия в вашей стране). Вы отвечаете за то, чтобы использование приложения было разрешено законом вашей страны.'] },
    { h: '2. Звёзды Ghost Gift', p: ['Звёзды — внутренняя развлекательная валюта приложения. Они приобретаются за Telegram Stars, не являются деньгами, не обмениваются обратно на деньги и могут использоваться только внутри приложения.'] },
    { h: '3. Призы', p: ['Призы — цифровые подарки Telegram, подписки Telegram Premium, NFT-подарки и звёзды. Подарки и Premium выдаются через официального бота приложения. Мы вправе проверять выводы, ограничивать их количество в сутки и отклонять запросы при подозрении на нарушение условий; в таком случае стоимость приза возвращается на баланс.'] },
    { h: '4. Честная игра', p: ['Результаты определяются на сервере по схеме provably fair, описанной в разделе «Честная игра и шансы». Демо-открытия не начисляют призов.'] },
    { h: '4а. Бонусы и приглашения', p: ['Ежедневная серия (1–6 звёзд в день), задания дня, награды за уровни (1% от поставленного за уровень) и достижения — бонусы, которые начисляет сервер. Звёзды за серию и задания временно не начисляются, если банк призов ниже резерва. Приглашения: друг, впервые запустивший игру по вашей ссылке, получает +10% к первому пополнению (до 250 звёзд), а вы — 10% от его пополнений в течение 30 дней (до 500 звёзд с одного друга). Засчитываются только новые игроки; приглашения самого себя, с одного устройства или с ограниченных аккаунтов не засчитываются. Мы можем аннулировать бонусы, полученные с нарушением.'] },
    { h: '5. Запрещено', p: ['Использовать ботов, автокликеры, несколько аккаунтов для получения бонусов, уязвимости, а также пытаться вмешиваться в работу сервиса. При нарушении мы можем ограничить аккаунт и аннулировать полученные с нарушением призы.'] },
    { h: '6. Ответственность', p: ['Приложение предоставляется «как есть». Мы стараемся обеспечить бесперебойную работу, но не гарантируем её. В пределах, допустимых законом, наша ответственность ограничена суммой ваших покупок за последние 30 дней.'] },
    { h: '7. Интеллектуальная собственность', p: ['© 2026 Ghost Gift. Все права защищены. Дизайн, персонажи (включая призрака-маскота), графика, анимации, тексты и код приложения являются собственностью Ghost Gift и не могут копироваться или использоваться без письменного разрешения.'] },
    { h: '8. Telegram', p: ['Ghost Gift — независимый проект. Он не связан с Telegram FZ-LLC, не спонсируется и не одобрен им. Telegram, Telegram Stars и Telegram Premium — товарные знаки их владельцев.'] },
    { h: '9. Изменения и контакты', p: [`Мы можем обновлять условия; актуальная версия всегда доступна в приложении. Вопросы — в боте ${CONTACT}.`] },
  ] },
  privacy: { title: 'Политика конфиденциальности', updated: UPDATED.ru, sections: [
    { h: 'Какие данные мы получаем', p: ['От Telegram: ваш ID, имя, имя пользователя, язык и (если доступна) ссылку на фото профиля. От вас: действия в приложении — открытия, баланс, инвентарь, покупки звёзд и заявки на вывод. Технические данные: идентификатор устройства в приложении и сведения для защиты от мошенничества.'] },
    { h: 'Зачем', p: ['Чтобы работали аккаунт, баланс и инвентарь; чтобы выдавать призы через бота; чтобы обеспечивать честность и предотвращать мошенничество и злоупотребления; чтобы отвечать на обращения и улучшать приложение.'] },
    { h: 'Лента выигрышей и рейтинг', p: ['В ленте последних выигрышей и в недельном рейтинге показываются ваше имя из Telegram (до 14 символов), уровень и выигрыш. Включите «Скрыть меня» в настройках — и вместо имени будет показано «Призрак».'] },
    { h: 'Уведомления', p: ['Бот пишет вам только о ваших заявках на вывод и пополнениях. Напоминания о серии приходят, только если вы сами включили их в настройках, и не чаще раза в день; отключить можно в любой момент.'] },
    { h: 'Платежи', p: ['Оплата проходит в Telegram через Telegram Stars. Мы не получаем и не храним данные ваших банковских карт.'] },
    { h: 'Хранение и передача', p: ['Данные хранятся на защищённой серверной инфраструктуре (Cloudflare) столько, сколько нужно для работы сервиса и выполнения обязательств. Мы не продаём персональные данные. Передаём их только Telegram (для выдачи призов и платежей) и поставщикам инфраструктуры.'] },
    { h: 'Ваши права', p: [`Вы можете запросить копию или удаление своих данных, написав в бот ${CONTACT}. Некоторые записи (например, о платежах) могут храниться дольше, если этого требует закон.`] },
    { h: 'Дети', p: ['Приложение не предназначено для лиц младше 18 лет, и мы сознательно не собираем их данные.'] },
  ] },
  play: { title: 'Ответственная игра · 18+', updated: UPDATED.ru, sections: [
    { p: ['Ghost Gift — развлечение. Играйте ради удовольствия, а не ради заработка.'] },
    { h: 'Простые правила', p: ['• Тратьте только то, что готовы потратить на развлечение.', '• Не пытайтесь «отыграться».', '• Делайте перерывы: призрак никуда не денется.', '• Используйте демо-режим, чтобы смотреть анимации без трат.'] },
    { h: 'Если игра перестала радовать', p: ['Сделайте паузу и поговорите с близкими. Если нужна помощь, обратитесь в местную службу поддержки по проблемам с азартными играми. Вы можете попросить в боте ' + CONTACT + ' временно ограничить ваш аккаунт.'] },
  ] },
  about: { title: 'О приложении', updated: UPDATED.ru, sections: [
    { p: ['Ghost Gift — Telegram Mini App со спиннерами удачи в неоновой осенней атмосфере ночного Нью-Йорка. Открывайте кейсы, собирайте подарки Telegram, Premium и NFT.'] },
    { h: 'Права', p: ['© 2026 Ghost Gift. Все права защищены. Приложение, его дизайн, персонажи и код — проприетарные; копирование и распространение без разрешения запрещены.'] },
    { h: 'Независимость', p: ['Не связано с Telegram FZ-LLC и не одобрено им.'] },
    { h: 'Связь', p: [`Поддержка и вопросы: ${CONTACT}`] },
  ] },
};

const en: Record<DocId, Doc> = {
  fair: { title: 'Fairness & odds', updated: UPDATED.en, sections: [
    { p: ['Ghost Gift is provably fair: the outcome of every opening is fixed in advance and you can verify it yourself. Neither the app nor we can change a result after you tap “Open”.'] },
    { h: 'How it works', p: [
      '1. Before a round the server creates a secret server seed and shows you its fingerprint — SHA-256(server seed). You see it on the case page as the “round hash”.',
      '2. You have a client seed, and every opening has a sequence number (nonce).',
      '3. Result: HMAC-SHA256(server seed, “client seed:nonce”). The first 13 hex characters become a number between 0 and 1.',
      '4. That number picks the prize from the case weight table — a higher weight means a higher chance. Every prize’s chance is shown in the case to a thousandth of a percent.',
      '5. After the round the server seed is revealed. Hash it with SHA-256 — it must match the hash you saw before the round.'] },
    { h: 'Return to player (RTP)', p: ['RTP is the long-run average return, computed from the same weight table the generator uses. It is shown on every case. It is a statistic, not a guarantee for any single opening.'] },
    { h: 'NFTs and boosts', p: ['NFT prizes join a table only while they are in stock, and the odds on the case page update accordingly. An NFT prize is one real Telegram collectible gift of the named collection; its model, backdrop and number may differ from the sample picture. Its value in stars is the collection’s market price, and it can be sold back for that value. The NFT is transferred to your Telegram profile by hand, usually within a few hours; if that is not possible, its full value returns to your balance. Luck boosts slightly raise the weight of valuable prizes on low-priced cases only, never apply to NFTs and are always reflected in the shown odds.', 'NFT collection images are public Fragment previews; gift names, images and trademarks belong to Telegram and their respective owners.'] },
    { h: 'Wheel and slots', p: ['The wheel and slots use the same seed chain: HMAC-SHA256(server seed, “client seed:nonce”) picks the outcome from a published table. The wheel has 20 segments, each sized in proportion to its chance; wheel RTP is 86.7%. Slots pick an outcome from the paytable (×40 … ×0), RTP 86.5%; the reel symbols are a separate cosmetic roll from the same seed and do not affect the payout. Full odds tables open with the “i” button in each game. The maximum bet may be lowered temporarily so that the prize bank stays positive.'] },
    { h: 'Luck card', p: ['Once a day (Kyiv time) you can draw a card: +3% (45% chance), +5% (30%), +7% (17%) or +10% (8%). For 24 hours it raises the weight of prizes worth more than the case itself in cases up to 50 stars (NFTs are not affected). The RTP of every case, including maximum luck, stays within 85–88%.'] },
    { h: 'Verify', p: ['Use the built-in verifier below: paste the server seed, client seed and nonce from a result — it computes the number and shows the prize from the case base table.'] },
  ] },
  terms: { title: 'Terms of Use', updated: UPDATED.en, sections: [
    { p: ['By using Ghost Gift (the “app”) you agree to these terms. If you do not agree, please do not use the app.'] },
    { h: '1. Age and eligibility', p: ['The app is for persons aged 18+ (or the age of majority in your country, if higher). You are responsible for making sure your use of the app is lawful where you live.'] },
    { h: '2. Ghost Gift stars', p: ['Stars are the app’s in-app entertainment currency. They are bought with Telegram Stars, are not money, cannot be exchanged back for money and can only be used inside the app.'] },
    { h: '3. Prizes', p: ['Prizes are Telegram gifts, Telegram Premium subscriptions, NFT gifts and stars. Gifts and Premium are delivered by the app’s official bot. We may review withdrawals, limit their number per day and decline requests suspected of breaching these terms; in that case the prize value is returned to your balance.'] },
    { h: '4. Fair play', p: ['Outcomes are decided on the server using the provably fair scheme described in “Fairness & odds”. Demo openings never award prizes.'] },
    { h: '4a. Bonuses and invites', p: ['The daily streak (1–6 stars a day), daily quests, level rewards (1% of the amount wagered for that level) and achievements are bonuses granted by the server. Streak and quest stars pause while the prize bank is below its reserve. Invites: a friend who starts the game for the first time via your link gets +10% on their first top-up (up to 250 stars), and you get 10% of their top-ups for 30 days (up to 500 stars per friend). Only new players count; self-invites, shared devices and restricted accounts are not counted. Bonuses obtained in breach of these terms may be cancelled.'] },
    { h: '5. Prohibited', p: ['Bots, auto-clickers, multiple accounts to farm bonuses, exploiting bugs, or interfering with the service. On violation we may restrict the account and void prizes obtained improperly.'] },
    { h: '6. Liability', p: ['The app is provided “as is”. We aim for uninterrupted service but do not guarantee it. To the extent permitted by law, our liability is limited to the amount of your purchases in the last 30 days.'] },
    { h: '7. Intellectual property', p: ['© 2026 Ghost Gift. All rights reserved. The design, characters (including the ghost mascot), graphics, animations, texts and code are the property of Ghost Gift and may not be copied or used without written permission.'] },
    { h: '8. Telegram', p: ['Ghost Gift is an independent project, not affiliated with, sponsored or endorsed by Telegram FZ-LLC. Telegram, Telegram Stars and Telegram Premium are trademarks of their respective owners.'] },
    { h: '9. Changes and contact', p: [`We may update these terms; the current version is always available in the app. Questions: ${CONTACT}.`] },
  ] },
  privacy: { title: 'Privacy Policy', updated: UPDATED.en, sections: [
    { h: 'What we receive', p: ['From Telegram: your ID, name, username, language and (if available) profile photo link. From you: in-app activity — openings, balance, inventory, star purchases and withdrawal requests. Technical data: an in-app device identifier and fraud-prevention signals.'] },
    { h: 'Why', p: ['To run your account, balance and inventory; to deliver prizes via the bot; to keep the game fair and prevent fraud and abuse; to answer requests and improve the app.'] },
    { h: 'Wins feed and ranking', p: ['The recent wins feed and the weekly ranking show your Telegram first name (up to 14 characters), level and win. Turn on “Hide me” in settings to appear as “Ghost” instead.'] },
    { h: 'Notifications', p: ['The bot only messages you about your withdrawals and top-ups. Streak reminders are sent only if you turn them on in settings, at most once a day, and can be turned off at any time.'] },
    { h: 'Payments', p: ['Payments are made inside Telegram with Telegram Stars. We never receive or store your card details.'] },
    { h: 'Storage and sharing', p: ['Data is stored on secure server infrastructure (Cloudflare) for as long as needed to run the service and meet obligations. We do not sell personal data. We share it only with Telegram (prize delivery and payments) and infrastructure providers.'] },
    { h: 'Your rights', p: [`You can request a copy or deletion of your data by messaging ${CONTACT}. Some records (e.g. payments) may be kept longer where the law requires.`] },
    { h: 'Children', p: ['The app is not intended for anyone under 18 and we do not knowingly collect their data.'] },
  ] },
  play: { title: 'Responsible play · 18+', updated: UPDATED.en, sections: [
    { p: ['Ghost Gift is entertainment. Play for fun, not to earn.'] },
    { h: 'Simple rules', p: ['• Only spend what you are happy to spend on fun.', '• Never chase losses.', '• Take breaks — the ghost will wait.', '• Use demo mode to enjoy the animations for free.'] },
    { h: 'If it stops being fun', p: ['Take a pause and talk to someone you trust. If you need help, contact a local problem-gambling support service. You can ask ' + CONTACT + ' to temporarily restrict your account.'] },
  ] },
  about: { title: 'About', updated: UPDATED.en, sections: [
    { p: ['Ghost Gift is a Telegram Mini App with luck spinners in a neon autumn New York night. Open cases and collect Telegram gifts, Premium and NFTs.'] },
    { h: 'Rights', p: ['© 2026 Ghost Gift. All rights reserved. The app, its design, characters and code are proprietary; copying or redistribution without permission is prohibited.'] },
    { h: 'Independence', p: ['Not affiliated with or endorsed by Telegram FZ-LLC.'] },
    { h: 'Contact', p: [`Support and questions: ${CONTACT}`] },
  ] },
};

const uk: Record<DocId, Doc> = {
  fair: { title: 'Чесна гра та шанси', updated: UPDATED.uk, sections: [
    { p: ['Ghost Gift використовує схему provably fair: результат кожного відкриття визначено заздалегідь, і ви можете перевірити його самостійно. Ні застосунок, ні ми не можемо підмінити результат після натискання «Відкрити».'] },
    { h: 'Як це працює', p: [
      '1. Перед раундом сервер створює секретний server seed і показує його відбиток — SHA-256(server seed). Він видно на сторінці кейса як «Хеш раунду».',
      '2. У вас є client seed, а кожне відкриття має порядковий номер nonce.',
      '3. Результат: HMAC-SHA256(server seed, «client seed:nonce»). Перші 13 hex-символів перетворюються на число від 0 до 1.',
      '4. Це число обирає приз за таблицею ваг кейса: що більша вага, то більший шанс. Шанс кожного призу показано в кейсі з точністю до тисячних відсотка.',
      '5. Після раунду server seed розкривається. Порахуйте від нього SHA-256 — він має збігтися з хешем, показаним до раунду.'] },
    { h: 'Повернення (RTP)', p: ['RTP — середнє повернення на довгій дистанції, розраховане з тієї ж таблиці ваг, за якою працює генератор. Його вказано на кожному кейсі. Це статистика, а не гарантія результату окремого відкриття.'] },
    { h: 'NFT і бонуси', p: ['NFT-призи потрапляють до таблиці лише поки вони є в наявності, і тоді шанси на сторінці кейса оновлюються. NFT-приз — один справжній колекційний подарунок Telegram зазначеної колекції; модель, фон і номер можуть відрізнятися від картинки-прикладу. Його вартість у зірках — ринкова ціна колекції, за неї ж його можна продати. NFT передається у профіль Telegram вручну, зазвичай протягом кількох годин; якщо передати не вдається, повна вартість повертається на баланс. Бонуси удачі трохи підвищують вагу дорогих призів лише на недорогих кейсах, на NFT не діють і завжди відображаються в показаних шансах.', 'Зображення NFT-колекцій — публічні превʼю Fragment; назви, зображення й товарні знаки подарунків належать Telegram та їхнім правовласникам.'] },
    { h: 'Колесо і слоти', p: ['Колесо і слоти працюють на тому ж ланцюжку seed: HMAC-SHA256(server seed, «client seed:nonce») обирає результат з опублікованої таблиці. На колесі 20 секторів, розмір кожного пропорційний його шансу; RTP колеса — 86,7%. У слотах результат обирається з таблиці виплат (×40 … ×0), RTP — 86,5%; символи на барабанах — окремий косметичний кидок з того ж seed і на виплату не впливають. Повні таблиці шансів відкриваються кнопкою «i» в кожній грі. Максимальна ставка може тимчасово знижуватися, щоб банк призів лишався в плюсі.'] },
    { h: 'Карта удачі', p: ['Раз на добу (за Києвом) можна витягнути карту: +3% (шанс 45%), +5% (30%), +7% (17%) або +10% (8%). На 24 години вона збільшує вагу призів, дорожчих за сам кейс, у кейсах до 50 зірок (NFT не зачіпаються). RTP усіх кейсів, включно з максимальною удачею, лишається в межах 85–88%.'] },
    { h: 'Перевірка', p: ['Нижче є вбудований перевіряльник: вставте server seed, client seed і nonce з результату — він порахує число й покаже приз за базовою таблицею кейса.'] },
  ] },
  terms: { title: 'Умови використання', updated: UPDATED.uk, sections: [
    { p: ['Використовуючи Ghost Gift («застосунок»), ви погоджуєтеся з цими умовами. Якщо ви не згодні, будь ласка, не використовуйте застосунок.'] },
    { h: '1. Вік і доступ', p: ['Застосунок призначено лише для осіб від 18 років (або від віку повноліття у вашій країні). Ви відповідаєте за те, щоб використання застосунку було законним у вашій країні.'] },
    { h: '2. Зірки Ghost Gift', p: ['Зірки — внутрішня розважальна валюта застосунку. Вони купуються за Telegram Stars, не є грошима, не обмінюються назад на гроші й можуть використовуватися лише в застосунку.'] },
    { h: '3. Призи', p: ['Призи — цифрові подарунки Telegram, підписки Telegram Premium, NFT-подарунки та зірки. Подарунки й Premium надсилає офіційний бот застосунку. Ми можемо перевіряти виведення, обмежувати їх кількість на добу та відхиляти запити в разі підозри на порушення умов; тоді вартість призу повертається на баланс.'] },
    { h: '4. Чесна гра', p: ['Результати визначаються на сервері за схемою provably fair, описаною в розділі «Чесна гра та шанси». Демо-відкриття не нараховують призів.'] },
    { h: '4а. Бонуси та запрошення', p: ['Щоденна серія (1–6 зірок на день), завдання дня, нагороди за рівні (1% від поставленого за рівень) і досягнення — бонуси, які нараховує сервер. Зірки за серію й завдання тимчасово не нараховуються, якщо банк призів нижче резерву. Запрошення: друг, який уперше запустив гру за вашим посиланням, отримує +10% до першого поповнення (до 250 зірок), а ви — 10% від його поповнень протягом 30 днів (до 500 зірок з одного друга). Зараховуються лише нові гравці; запрошення самого себе, з одного пристрою чи з обмежених акаунтів не зараховуються. Бонуси, отримані з порушенням, можуть бути анульовані.'] },
    { h: '5. Заборонено', p: ['Використовувати ботів, автоклікери, кілька акаунтів для бонусів, вразливості, а також втручатися в роботу сервісу. У разі порушення ми можемо обмежити акаунт і анулювати отримані з порушенням призи.'] },
    { h: '6. Відповідальність', p: ['Застосунок надається «як є». Ми прагнемо безперебійної роботи, але не гарантуємо її. У межах, дозволених законом, наша відповідальність обмежена сумою ваших покупок за останні 30 днів.'] },
    { h: '7. Інтелектуальна власність', p: ['© 2026 Ghost Gift. Усі права захищені. Дизайн, персонажі (зокрема привид-маскот), графіка, анімації, тексти й код застосунку є власністю Ghost Gift і не можуть копіюватися чи використовуватися без письмового дозволу.'] },
    { h: '8. Telegram', p: ['Ghost Gift — незалежний проєкт. Він не пов’язаний з Telegram FZ-LLC, не спонсорується й не схвалений ним. Telegram, Telegram Stars і Telegram Premium — торговельні марки їхніх власників.'] },
    { h: '9. Зміни та контакти', p: [`Ми можемо оновлювати умови; актуальна версія завжди доступна в застосунку. Питання — у боті ${CONTACT}.`] },
  ] },
  privacy: { title: 'Політика конфіденційності', updated: UPDATED.uk, sections: [
    { h: 'Які дані ми отримуємо', p: ['Від Telegram: ваш ID, ім’я, ім’я користувача, мову та (якщо доступне) посилання на фото профілю. Від вас: дії в застосунку — відкриття, баланс, інвентар, купівлі зірок і заявки на виведення. Технічні дані: ідентифікатор пристрою в застосунку та сигнали для захисту від шахрайства.'] },
    { h: 'Навіщо', p: ['Щоб працювали акаунт, баланс та інвентар; щоб надсилати призи через бота; щоб забезпечувати чесність і запобігати шахрайству та зловживанням; щоб відповідати на звернення й покращувати застосунок.'] },
    { h: 'Стрічка виграшів і рейтинг', p: ['У стрічці останніх виграшів і в тижневому рейтингу показуються ваше ім’я з Telegram (до 14 символів), рівень і виграш. Увімкніть «Приховати мене» в налаштуваннях — і замість імені буде показано «Привид».'] },
    { h: 'Сповіщення', p: ['Бот пише вам лише про ваші заявки на виведення та поповнення. Нагадування про серію надходять, тільки якщо ви самі увімкнули їх у налаштуваннях, і не частіше разу на день; вимкнути можна будь-коли.'] },
    { h: 'Платежі', p: ['Оплата відбувається в Telegram через Telegram Stars. Ми не отримуємо й не зберігаємо дані ваших банківських карток.'] },
    { h: 'Зберігання та передача', p: ['Дані зберігаються на захищеній серверній інфраструктурі (Cloudflare) стільки, скільки потрібно для роботи сервісу й виконання зобов’язань. Ми не продаємо персональні дані. Передаємо їх лише Telegram (видача призів і платежі) та постачальникам інфраструктури.'] },
    { h: 'Ваші права', p: [`Ви можете запросити копію або видалення своїх даних, написавши в бот ${CONTACT}. Деякі записи (наприклад, про платежі) можуть зберігатися довше, якщо цього вимагає закон.`] },
    { h: 'Діти', p: ['Застосунок не призначений для осіб до 18 років, і ми свідомо не збираємо їхні дані.'] },
  ] },
  play: { title: 'Відповідальна гра · 18+', updated: UPDATED.uk, sections: [
    { p: ['Ghost Gift — розвага. Грайте заради задоволення, а не заради заробітку.'] },
    { h: 'Прості правила', p: ['• Витрачайте лише те, що готові витратити на розваги.', '• Не намагайтеся «відігратися».', '• Робіть перерви — привид нікуди не дінеться.', '• Користуйтеся демо-режимом, щоб дивитися анімації без витрат.'] },
    { h: 'Якщо гра перестала тішити', p: ['Зробіть паузу й поговоріть із близькими. Якщо потрібна допомога, зверніться до місцевої служби підтримки з проблем азартних ігор. Ви можете попросити в боті ' + CONTACT + ' тимчасово обмежити ваш акаунт.'] },
  ] },
  about: { title: 'Про застосунок', updated: UPDATED.uk, sections: [
    { p: ['Ghost Gift — Telegram Mini App зі спінерами удачі в неоновій осінній атмосфері нічного Нью-Йорка. Відкривайте кейси, збирайте подарунки Telegram, Premium і NFT.'] },
    { h: 'Права', p: ['© 2026 Ghost Gift. Усі права захищені. Застосунок, його дизайн, персонажі й код — пропрієтарні; копіювання та поширення без дозволу заборонені.'] },
    { h: 'Незалежність', p: ['Не пов’язано з Telegram FZ-LLC і не схвалено ним.'] },
    { h: 'Зв’язок', p: [`Підтримка та питання: ${CONTACT}`] },
  ] },
};

export const DOCS: Record<Lang, Record<DocId, Doc>> = { ru, en, uk };
export const VERIFY = {
  ru: { title: 'Проверить раунд', server: 'Server seed', client: 'Client seed', nonce: 'Nonce', hash: 'Хэш раунда (необязательно)', case: 'Кейс', go: 'Проверить', roll: 'Число', prize: 'Приз по базовой таблице', ok: 'Хэш совпадает ✓', bad: 'Хэш НЕ совпадает', odds: 'Шансы и RTP всех кейсов', rtp: 'RTP' },
  en: { title: 'Verify a round', server: 'Server seed', client: 'Client seed', nonce: 'Nonce', hash: 'Round hash (optional)', case: 'Case', go: 'Verify', roll: 'Roll', prize: 'Prize from the base table', ok: 'Hash matches ✓', bad: 'Hash does NOT match', odds: 'Odds & RTP of all cases', rtp: 'RTP' },
  uk: { title: 'Перевірити раунд', server: 'Server seed', client: 'Client seed', nonce: 'Nonce', hash: 'Хеш раунду (необов’язково)', case: 'Кейс', go: 'Перевірити', roll: 'Число', prize: 'Приз за базовою таблицею', ok: 'Хеш збігається ✓', bad: 'Хеш НЕ збігається', odds: 'Шанси та RTP усіх кейсів', rtp: 'RTP' },
} as const;
