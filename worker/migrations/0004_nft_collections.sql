-- NFT prizes v2: concrete Telegram collectible collections (see NFT_COLLECTIONS in src/api/catalog.ts).
-- nft_stock.tier now holds the collection prize id. One hand-delivered unit of each collection to start
-- (admin changes it with /nft_stock). Values = catalog values on 17 Nov 2026.
INSERT OR IGNORE INTO nft_stock (owned_gift_id, name, title, value, tier, transfer_cost, status, added_at) VALUES
  ('manual:nft_hypno:1', '', 'Hypno Lollipop', 490, 'nft_hypno', 0, 'in_stock', 1795392000000),
  ('manual:nft_jackbox:1', '', 'Jack-in-the-Box', 490, 'nft_jackbox', 0, 'in_stock', 1795392000000),
  ('manual:nft_hexpot:1', '', 'Hex Pot', 660, 'nft_hexpot', 0, 'in_stock', 1795392000000),
  ('manual:nft_witchhat:1', '', 'Witch Hat', 660, 'nft_witchhat', 0, 'in_stock', 1795392000000),
  ('manual:nft_candle:1', '', 'Eternal Candle', 660, 'nft_candle', 0, 'in_stock', 1795392000000),
  ('manual:nft_evileye:1', '', 'Evil Eye', 900, 'nft_evileye', 0, 'in_stock', 1795392000000),
  ('manual:nft_skullflower:1', '', 'Skull Flower', 1230, 'nft_skullflower', 0, 'in_stock', 1795392000000),
  ('manual:nft_crystal:1', '', 'Crystal Ball', 1400, 'nft_crystal', 0, 'in_stock', 1795392000000),
  ('manual:nft_pumpkin:1', '', 'Mad Pumpkin', 1560, 'nft_pumpkin', 0, 'in_stock', 1795392000000),
  ('manual:nft_eskull:1', '', 'Electric Skull', 2870, 'nft_eskull', 0, 'in_stock', 1795392000000),
  ('manual:nft_voodoo:1', '', 'Voodoo Doll', 4010, 'nft_voodoo', 0, 'in_stock', 1795392000000),
  ('manual:nft_potion:1', '', 'Magic Potion', 5970, 'nft_potion', 0, 'in_stock', 1795392000000),
  ('manual:nft_astral:1', '', 'Astral Shard', 13660, 'nft_astral', 0, 'in_stock', 1795392000000),
  ('manual:nft_scaredcat:1', '', 'Scared Cat', 26090, 'nft_scaredcat', 0, 'in_stock', 1795392000000),
  ('manual:nft_durovcap:1', '', 'Durov''s Cap', 38540, 'nft_durovcap', 0, 'in_stock', 1795392000000);
-- legacy tier rows (nft_s/m/l/xl) no longer map to a drop
UPDATE nft_stock SET status = 'removed' WHERE status = 'in_stock' AND tier IN ('nft_s', 'nft_m', 'nft_l', 'nft_xl');
