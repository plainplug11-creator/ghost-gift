import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/games.css';
import './styles/icons.css';
import './styles/screens.css';
import './styles/decor.css';
import './styles/juice.css';

import { h } from './core/dom';
import { initPerf } from './core/perf';
import { tg } from './core/telegram';
import { createHeader } from './ui/header';
import { createTabbar } from './ui/tabbar';
import { initPress } from './ui/press';
import { initRouter, navigate, prefetch, registerLazyTab, registerTab } from './ui/router';
import { createHome } from './screens/home';
import { api, ApiError } from './api';
import { apiErrorText } from './api/errors';
import { toast } from './ui/sheet';
import { initSound } from './core/sound';
import { onCelebrate } from './core/progress';
import { loadLang, t } from './core/i18n';

// 1. Telegram + perf flags first (affect first paint styling)
tg.init({ header: '#04050d', bg: '#04050d', bottom: '#0a0818' });
initPerf();

// 2. Shell — after the UI language is ready (ru is inline; en/uk are tiny lazy chunks)
void loadLang().then(boot);
function boot() {
  const root = document.getElementById('app')!;
  const screens = h('main', { class: 'screens' });
  const app = h('div', { class: 'app' }, createHeader(), screens, createTabbar());
  root.append(app);
  initRouter(app, screens);
  initPress(document.body);

  const home = createHome();
  registerTab('games', home);
  registerLazyTab('profile', () => import('./screens/profile').then((m) => m.createProfile()));
  home.mount();
  bootstrap();
  // level-ups / achievements → lazy celebration module
  onCelebrate({
    levelUp: (l, b) => void import('./ui/celebrate').then((m) => m.levelUp(l, b)),
    achievements: (ids) => void import('./ui/celebrate').then((m) => m.achievements(ids)),
  });
  initOffline();
  void initSound();

  // 3. Non-critical: ambient background + prefetch of lazy screens after first paint
  requestAnimationFrame(() => {
    document.documentElement.classList.add('is-loaded');
    setTimeout(() => {
      import('./ambience/background').then((m) => m.mountBackground(document.getElementById('bg')!));
      import('./ambience/leaves').then((m) => m.mountLeaves(document.getElementById('ambience') as HTMLCanvasElement));
      prefetch();
      if (!qs.get('push') && !qs.has('noonb')) void import('./ui/onboarding').then((m) => m.showOnboarding());
    }, 350);
  });

  // dev helpers for screenshots / QA: ?tab=profile, ?push=wheel
  const qs = new URLSearchParams(location.search);
  if (qs.get('tab') === 'profile') navigate.tab('profile');
  const p = qs.get('push');
  if (p) setTimeout(async () => {
    for (const step of p.split(',')) { const [id, arg] = step.split(':'); await navigate.push(id as never, arg ? { id: arg } : {}); }
  }, 100);
}

/** Offline pill at the top; "back online" flash when the connection returns. */
function initOffline() {
  const el = h('div', { class: 'net-off', role: 'status' });
  document.body.append(el);
  let hide = 0;
  const set = (on: boolean) => {
    clearTimeout(hide);
    el.textContent = on ? t('net.offline') : t('net.back');
    el.classList.toggle('is-back', !on);
    el.classList.add('is-on');
    if (!on) hide = window.setTimeout(() => el.classList.remove('is-on'), 1800);
  };
  addEventListener('offline', () => set(true));
  addEventListener('online', () => set(false));
  if (!navigator.onLine) set(true);
}

/** Load balance/inventory; on failure show a clear toast and retry with backoff (UI stays usable). */
function bootstrap() {
  let tries = 0;
  let timer = 0;
  let shown = '';
  const run = () => {
    clearTimeout(timer);
    api.bootstrap().then(() => { tries = 0; shown = ''; }).catch((e: unknown) => {
      const msg = apiErrorText(e);
      if (msg !== shown) { toast(msg, 'err'); shown = msg; }
      if (e instanceof ApiError && e.code === 'AUTH') return; // opened outside Telegram: retrying won't help
      tries++;
      timer = window.setTimeout(run, Math.min(30_000, 2_000 * 2 ** Math.min(tries, 4)));
    });
  };
  run();
  window.addEventListener('online', () => { if (shown) run(); });
}
