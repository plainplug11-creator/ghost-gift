// Solves NFT drop weights per case: weight ∝ 1/value, scaled so RTP with all NFTs in stock = base + target pp.
// Run: node --experimental-strip-types scripts/solve-nft.ts — paste the printed map into NFT_DROPS (src/api/catalog.ts).
import { CASES, PRIZES, NFT_COLLECTIONS, caseStats, liveDrops } from '../../src/api/catalog.ts';
const plan: Record<string, [string[], number]> = {
  neon: [['nft_hypno','nft_jackbox'], 0.0015],
  ghost: [['nft_hypno','nft_jackbox','nft_hexpot','nft_witchhat','nft_candle','nft_evileye'], 0.012],
  star: [['nft_hexpot','nft_witchhat','nft_candle','nft_evileye','nft_skullflower','nft_crystal','nft_pumpkin'], 0.012],
  diamond: [['nft_evileye','nft_skullflower','nft_crystal','nft_pumpkin','nft_eskull','nft_voodoo'], 0.013],
  legend: [['nft_skullflower','nft_crystal','nft_pumpkin','nft_eskull','nft_voodoo','nft_potion'], 0.013],
  aurora: [['nft_eskull','nft_voodoo','nft_potion','nft_astral'], 0.012],
  phantom: [['nft_voodoo','nft_potion','nft_astral','nft_scaredcat'], 0.012],
  king: [['nft_potion','nft_astral','nft_scaredcat','nft_durovcap'], 0.013],
};
const out: Record<string, Record<string, number>> = {};
for (const [cid, [ids, d]] of Object.entries(plan)) {
  const c = CASES.find((x) => x.id === cid)!;
  for (const id of ids) { const v = PRIZES[id].value; if (!(v > c.price && v <= 10 * c.price)) throw new Error(cid + id); }
  const base = caseStats(c, liveDrops(c));
  const W = c.drops.reduce((s, x) => s + x.weight, 0);
  const target = base.rtp + d;
  const rtpAt = (k: number) => { const dr = [...c.drops, ...ids.map((id) => ({ prize: id, weight: k / PRIZES[id].value }))]; return caseStats(c, dr).rtp; };
  let lo = 0, hi = W * 1e6; for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (rtpAt(m) < target) lo = m; else hi = m; }
  const ws: Record<string, number> = {};
  for (const id of ids) ws[id] = +(lo / PRIZES[id].value).toPrecision(3);
  out[cid] = ws;
  const dr = [...c.drops, ...Object.entries(ws).map(([prize, weight]) => ({ prize, weight }))];
  const nftShare = Object.values(ws).reduce((a, b) => a + b, 0) / (W + Object.values(ws).reduce((a, b) => a + b, 0));
  console.log(cid, (base.rtp*100).toFixed(2), '→', (caseStats(c, dr).rtp*100).toFixed(2), 'NFT chance', (nftShare*100).toFixed(3)+'%');
}
console.log(JSON.stringify(out).replace(/"(\w+)":/g, '$1: '));
