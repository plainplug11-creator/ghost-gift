import { nftCollection, type NftInfo } from './catalog.ts';

/**
 * What the player sees for an NFT prize. A stock row bound to a concrete owned gift (auto mode, /nft_add)
 * shows that gift (t.me/nft link + its own preview); a manual stock row stands for "one gift of the collection",
 * so it shows the collection (Fragment collection page + a sample preview).
 */
export function nftInfo(prizeId: string, row: { title?: string | null; name?: string | null } | null): NftInfo {
  const col = nftCollection(prizeId);
  const name = (row?.name ?? '').trim();
  if (name) return { title: row?.title || col?.title || 'NFT', name, link: `https://t.me/nft/${name}`, art: name.toLowerCase() };
  return { title: col?.title ?? row?.title ?? 'NFT', name: '', link: col ? `https://fragment.com/gifts/${col.slug}` : '', ...(col ? { art: col.art } : {}) };
}

/** Telegram-safe sample image of a collection (Fragment public CDN). */
export const nftArtUrl = (art?: string) => (art && /^[a-z0-9]+-\d+$/.test(art) ? `https://nft.fragment.com/gift/${art}.medium.jpg` : '');
