# Deploy Ghost Gift to GitHub Pages

The Mini App is served at:

https://plainplug11-creator.github.io/ghost-gift/

## Deploy

Push to `main`. GitHub Actions builds the app (`base` = `/ghost-gift/`) and publishes `dist/` to Pages.

```bash
git add -A
git commit -m "Your message"
git push origin main
```

You can also run the **Deploy to GitHub Pages** workflow manually from the Actions tab (`workflow_dispatch`).

After the workflow is green, the site updates in about a minute. Point the Telegram menu button at the Pages URL **with a trailing slash**.

## Local production build

```bash
npm ci
npm run build
npm run preview   # served under http://localhost:4173/ghost-gift/
```

Do not change game odds or prize economics in a deploy-only change.
