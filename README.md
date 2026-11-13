# Ghost Gift — Main screen (stage 1)

Telegram Mini App — midnight-neon palette (navy / electric cyan / violet / magenta, iridescent gloss), orange used only for autumn leaves. Background: looping Times Square night video. Vite + vanilla TypeScript (no framework: ~19 KB gzip total initial load).

## Run
```bash
npm install
npm run dev        # http://localhost:5173  (dev server, open in browser / Telegram via tunnel)
npm run build      # type-check + production build → dist/
npm run preview    # serve dist/ on :4173
npm run shots      # headless QA screenshots → shots/ (needs preview running; `npx playwright install chromium` once)
```
QA query params: `?tier=low|mid|high` (force perf tier), `?lang=en`, `?daily=<seconds>` (daily cooldown), `?tab=profile`, `?push=wheel`.

## Structure
```
index.html              Telegram SDK, shared SVG defs (currency star), canvas for ambience
src/main.ts             bootstrap: Telegram init → perf flags → shell → lazy ambience/prefetch
src/core/telegram.ts    guarded WebApp wrapper (ready/expand/colors/swipes/safe areas/haptics/BackButton)
src/core/perf.ts        perf tier (Telegram Android UA class → hw hints), reduced motion, pause on hidden
src/core/i18n.ts        ru + en dictionaries, t(), number formatting, greeting
src/core/store.ts       tiny signals (balance, daily timer, streak) — display mirrors of server state
src/ui/                 header (mascot, balance, avatar), feed (recycling marquee), tabbar, router, press
src/screens/            home, profile (lazy), soon placeholder (lazy)
src/art/                ghost mascot + game card illustrations (SVG)
src/ambience/leaves.ts  canvas background: sparse leaves + embers (swappable, lazy)
src/styles/             tokens (palette, springs), base, components, games, screens
```

## Swappable assets
| What | Replace this file | Notes |
|---|---|---|
| Currency icon | `src/assets/currency.webp` | square, transparent, ≥384 px; used everywhere (header, feed, wheel hub, slots, top-up) |
| Background video | `public/media/bg-loop.webm` + `public/media/bg-loop.mp4` | seamless loop, muted; WebM/VP9 first, MP4/H.264 for iOS |
| Background still | `public/media/bg-poster.webp` | first paint + low-tier / reduced-motion / Data-Saver fallback |
| Game hero art | `src/assets/{chest,gift,wheel,slots}-{240,480}.webp` | jelly cut-outs, srcset 1x/2x |
| Jelly UI icons | `src/assets/icons.webp` + `src/styles/icons.css` | 6×3 atlas, 128px cells; regenerate with `/workspace/ghost-gift-media/jelly/export.py` |

Perf tiers: high = video + blurred glass cards; mid = video, solid glass cards (only tab bar blurs); low / reduced motion / Data Saver = still poster, no card blur, fewer loops.
Source media & raw renders: `/workspace/ghost-gift-media/`.

## Stage 2 — Cases (client side, mock backend)
```
src/api/            index.ts (GameApi interface + TODO(server) contract), types.ts, catalog.ts (prizes, cases, weights, RTP, Premium tiers), mock.ts (⚠ dev only)
src/screens/cases.ts     cases grid          (?push=cases)
src/screens/case.ts      case detail + opening orchestration + result sheet   (?push=case:neon, &autoopen=1|demo, &force=<prizeId> mock only)
src/screens/opening.ts   the opening show: charge → lid burst → reel w/ motion blur → near-miss → legendary slow-mo → reveal + confetti; Skip
src/screens/inventory.ts inventory          (?push=inventory)
src/screens/sheets.ts    item actions, Premium exchange, withdrawal rules, share card
src/ui/sheet.ts          bottom sheet + toast;  src/ui/confetti.ts canvas burst;  src/core/sound.ts synth SFX (muted by default)
```
Rule: the client NEVER decides real outcomes. `api.openCase()` returns the prize; the animation is built around it.
Server TODOs are marked `TODO(server)`: initData HMAC check, server RNG (provably fair: sha256(serverSeed) before, seed after,
HMAC_SHA256(serverSeed, clientSeed:nonce)), DB transactions/locks, idempotent open, rate limits, withdrawal queue → bot sendGift / gift Premium,
share-card rendering (public URL for shareToStory) and savePreparedInlineMessage (for shareMessage).

Case art: `src/assets/case-{autumn,neon,ghost,star,diamond,legend}-{240,480}.webp`; prize atlas `src/assets/prizes.webp` + `src/styles/prizes.css`
(regenerate with `/workspace/ghost-gift-media/jelly/export2.py`). Mascot: `src/assets/mascot-{96,160}.webp`.
QA: `node scripts/shots-cases.mjs` (screens + frame timing), `node scripts/video-opening.mjs <prize> <case> <tag>` (records an opening).

## Deploy

Production host: [GitHub Pages](https://plainplug11-creator.github.io/ghost-gift/).

```bash
git push origin main
```

The Actions workflow builds the app with base path `/ghost-gift/` and publishes `dist/`. Details: `scripts/deploy-pages.md`.
