import { nftCollection } from './catalog.ts';

// Bot texts (ru default, en for non-CIS languages).
const ru = {
  welcome: '👻 <b>Ghost Gift</b> — неоновые кейсы с настоящими подарками Telegram, Premium и NFT.\n\n🎁 Ежедневный бесплатный кейс\n⭐ Честные шансы (provably fair) — каждый бросок можно проверить\n🚀 Выигрыши приходят прямо в Telegram\n\nЖми «Играть» 👇',
  play: 'Играть',
  help: 'Открой приложение кнопкой «Играть». Вопросы по выводам — ответим здесь же.',
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
};
const en: typeof ru = {
  welcome: '👻 <b>Ghost Gift</b> — neon cases with real Telegram gifts, Premium and NFTs.\n\n🎁 Free daily case\n⭐ Provably fair odds — every roll is verifiable\n🚀 Winnings arrive right in Telegram\n\nTap “Play” 👇',
  play: 'Play',
  help: 'Open the app with the “Play” button. Questions about withdrawals — ask right here.',
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
};
export type TextKey = keyof typeof ru;
export function tx(lang: string | null | undefined, key: TextKey, vars: Record<string, string | number> = {}) {
  const dict = !lang || /^(ru|uk|be|kk)/.test(lang) ? ru : en;
  return dict[key].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

const ITEM_RU: Record<string, string> = {
  heart: 'Сердце', bear: 'Мишка', rose: 'Роза', gift: 'Подарок', cake: 'Торт', rocket: 'Ракета', cup: 'Кубок', ring: 'Кольцо', diamond: 'Алмаз',
  prem3: 'Premium 3 мес.', prem6: 'Premium 6 мес.', prem12: 'Premium 12 мес.',
};
export const itemName = (prizeId: string, nftTitle?: string | null) => nftTitle || ITEM_RU[prizeId] || nftCollection(prizeId)?.title || prizeId;
export const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
