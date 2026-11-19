import { nftCollection } from './catalog.ts';

// Bot texts: English for English-language Telegram clients, Russian for everyone else (incl. Ukrainian).
const ru = {
  welcome: '👻 <b>Ghost Gift</b> — неоновая осенняя ночь Нью-Йорка и настоящие подарки Telegram.\n\n🎁 Бесплатный кейс каждый день\n🎡 Колесо до ×10 и 🎰 слоты с джекпотом ×40\n🃏 Карта удачи, серия входов и задания с наградами\n💎 Подарки, Premium и NFT приходят прямо в Telegram\n⚖️ Честные шансы — каждый бросок можно проверить\n\nЖми «Играть» 👇',
  play: 'Играть',
  help: '❓ <b>Как это работает</b>\n\n1. Жми «Играть» — откроется приложение.\n2. Пополняй звёзды через Telegram Stars или забирай бесплатный кейс раз в сутки.\n3. Выигранные подарки лежат в инвентаре: продай их за звёзды или выведи в Telegram.\n4. Крупные выводы и NFT проверяет модератор — обычно до нескольких часов.\n\nКоманды: /me — мой профиль · /ref — пригласить друзей\nВопросы — пиши прямо сюда.',
  credited: '⭐ Зачислено <b>{n}</b> звёзд. Баланс: <b>{b}</b>.',
  refunded: '↩️ Платёж возвращён: списано {n} ⭐.',
  delivered_gift: '🎁 Твой приз «{item}» отправлен! Загляни в профиль Telegram → Подарки.',
  delivered_premium: '👑 Telegram Premium на {m} мес. подключён! Спасибо, что играешь в Ghost Gift.',
  delivered_nft: '💎 NFT «{item}» передан тебе! Он уже в твоём профиле Telegram.',
  rejected_item: 'Вывод «{item}» отклонён. Предмет вернулся в инвентарь — его можно продать или вывести позже.',
  rejected_premium: 'Покупка Premium отменена, {n} ⭐ вернулись на баланс.',
  review: '⏳ Вывод «{item}» на проверке. Обычно это занимает до нескольких часов.',
  nft_sending: '💎 NFT «{item}» отправляется! Мы передадим его в твой профиль Telegram — обычно в течение нескольких часов. Сообщим, как только он придёт.',
  rejected_nft: 'NFT «{item}» не удалось передать — на баланс зачислено <b>{n}</b> ⭐ (полная стоимость).',
  ref_welcome: '🎉 Бонус друга: +<b>{n}</b> ⭐ к первому пополнению!',
  ref_bonus: '👥 Твой друг пополнил баланс — тебе <b>+{n}</b> ⭐ реферального бонуса!',
  streak_reminder: '🔥 Серия <b>{n}</b> дн. сгорит в полночь! Забери награду дня и бесплатный кейс 👇',
  notify_ready: '🔔 Готово! Теперь я смогу напомнить о серии (не чаще раза в день). Отключить можно в настройках игры.',
  ref_info: '👥 <b>Приглашай друзей</b>\n\nТвоя ссылка:\n{link}\n\nДруг получит <b>+10%</b> к первому пополнению, а ты — <b>10%</b> от его пополнений в первые 30 дней.\n\nДрузей: <b>{f}</b> · заработано: <b>{e}</b> ⭐',
  me: '👻 <b>{name}</b>\n⭐ Баланс: <b>{b}</b>\n🏅 Уровень: <b>{lvl}</b> ({xp} XP)\n🔥 Серия: <b>{s}</b> дн.\n🎰 Круток: <b>{o}</b>',
  invite_text: 'Залетай в Ghost Gift 👻 — неоновые кейсы с настоящими подарками Telegram. По моей ссылке +10% к первому пополнению!',
  btn_daily: '🎁 Бесплатный кейс',
  btn_wheel: '🎡 Колесо',
  btn_invite: '👥 Пригласить друзей',
  btn_help: '❓ Помощь',
  btn_share: '📤 Поделиться ссылкой',
};
const en: typeof ru = {
  welcome: '👻 <b>Ghost Gift</b> — a neon autumn night in New York and real Telegram gifts.\n\n🎁 A free case every day\n🎡 Wheel up to ×10 and 🎰 slots with a ×40 jackpot\n🃏 Luck card, login streak and quests with rewards\n💎 Gifts, Premium and NFTs arrive right in Telegram\n⚖️ Provably fair — every roll is verifiable\n\nTap “Play” 👇',
  play: 'Play',
  help: '❓ <b>How it works</b>\n\n1. Tap “Play” to open the app.\n2. Top up with Telegram Stars or grab the free case once a day.\n3. Prizes go to your inventory: sell them for Stars or withdraw to Telegram.\n4. Large withdrawals and NFTs are checked by a moderator — usually within a few hours.\n\nCommands: /me — my profile · /ref — invite friends\nQuestions — just write here.',
  credited: '⭐ <b>{n}</b> Stars credited. Balance: <b>{b}</b>.',
  refunded: '↩️ Payment refunded: {n} ⭐ deducted.',
  delivered_gift: '🎁 Your prize “{item}” has been sent! Check Telegram profile → Gifts.',
  delivered_premium: '👑 Telegram Premium for {m} months is active! Thanks for playing Ghost Gift.',
  delivered_nft: '💎 NFT “{item}” has been transferred to you! It is already in your Telegram profile.',
  rejected_item: 'Withdrawal of “{item}” was declined. The item is back in your inventory — sell it or withdraw later.',
  rejected_premium: 'Premium purchase cancelled, {n} ⭐ returned to your balance.',
  review: '⏳ Withdrawal of “{item}” is under review. Usually up to a few hours.',
  nft_sending: '💎 NFT “{item}” is on its way! We’ll transfer it to your Telegram profile, usually within a few hours, and ping you when it lands.',
  rejected_nft: 'NFT “{item}” could not be transferred — <b>{n}</b> ⭐ (its full value) credited to your balance.',
  ref_welcome: '🎉 Friend bonus: +<b>{n}</b> ⭐ on your first top-up!',
  ref_bonus: '👥 Your friend topped up — <b>+{n}</b> ⭐ referral bonus for you!',
  streak_reminder: '🔥 Your <b>{n}</b>-day streak ends at midnight! Grab today’s reward and the free case 👇',
  notify_ready: '🔔 Done! I can now remind you about your streak (max once a day). Turn it off in the game settings.',
  ref_info: '👥 <b>Invite friends</b>\n\nYour link:\n{link}\n\nYour friend gets <b>+10%</b> on the first top-up, you get <b>10%</b> of their top-ups for 30 days.\n\nFriends: <b>{f}</b> · earned: <b>{e}</b> ⭐',
  me: '👻 <b>{name}</b>\n⭐ Balance: <b>{b}</b>\n🏅 Level: <b>{lvl}</b> ({xp} XP)\n🔥 Streak: <b>{s}</b> days\n🎰 Spins: <b>{o}</b>',
  invite_text: 'Join me in Ghost Gift 👻 — neon cases with real Telegram gifts. +10% on your first top-up with my link!',
  btn_daily: '🎁 Free case',
  btn_wheel: '🎡 Wheel',
  btn_invite: '👥 Invite friends',
  btn_help: '❓ Help',
  btn_share: '📤 Share link',
};
export type TextKey = keyof typeof ru;
const isEn = (lang: string | null | undefined) => /^en/.test(lang || '');
export function tx(lang: string | null | undefined, key: TextKey, vars: Record<string, string | number> = {}) {
  const dict = isEn(lang) ? en : ru;
  const v = { ...vars };
  if (typeof v.item === 'string') v.item = localizeItem(v.item, lang);
  return dict[key].replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
}

const ITEM_RU: Record<string, string> = {
  heart: 'Сердце', bear: 'Мишка', rose: 'Роза', gift: 'Подарок', cake: 'Торт', rocket: 'Ракета', cup: 'Кубок', ring: 'Кольцо', diamond: 'Алмаз',
  prem3: 'Premium 3 мес.', prem6: 'Premium 6 мес.', prem12: 'Premium 12 мес.',
};
const ITEM_EN: Record<string, string> = {
  heart: 'Heart', bear: 'Teddy Bear', rose: 'Rose', gift: 'Gift', cake: 'Cake', rocket: 'Rocket', cup: 'Trophy', ring: 'Ring', diamond: 'Diamond',
  prem3: 'Premium 3 mo.', prem6: 'Premium 6 mo.', prem12: 'Premium 12 mo.',
};
const RU_KEY = new Map(Object.entries(ITEM_RU).map(([k, v]) => [v, k]));
/** Translate a built-in prize name (stored/created in ru) to the user's language; NFT titles pass through. */
export function localizeItem(name: string, lang: string | null | undefined) {
  const k = RU_KEY.get(name);
  if (!k) return name;
  return isEn(lang) ? ITEM_EN[k] : name;
}
export const itemName = (prizeId: string, nftTitle?: string | null) => nftTitle || ITEM_RU[prizeId] || nftCollection(prizeId)?.title || prizeId;
export const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
