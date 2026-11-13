import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/games.css';
import './styles/icons.css';
import './styles/screens.css';

import { h } from './core/dom';
import { initPerf } from './core/perf';
import { tg } from './core/telegram';
import { createHeader } from './ui/header';
import { createTabbar } from './ui/tabbar';
import { initPress } from './ui/press';
import { initRouter, navigate, prefetch, registerLazyTab, registerTab } from './ui/router';
import { createHome } from './screens/home';
import { api } from './api';
import { initSound } from './core/sound';

// 1. Telegram + perf flags first (affect first paint styling)
tg.init({ header: '#04050d', bg: '#04050d', bottom: '#0a0818' });
initPerf();

// 2. Shell
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
void api.bootstrap();
void initSound();

// 3. Non-critical: ambient background + prefetch of lazy screens after first paint
requestAnimationFrame(() => {
  document.documentElement.classList.add('is-loaded');
  setTimeout(() => {
    import('./ambience/background').then((m) => m.mountBackground(document.getElementById('bg')!));
    import('./ambience/leaves').then((m) => m.mountLeaves(document.getElementById('ambience') as HTMLCanvasElement));
    prefetch();
  }, 350);
});

// dev helpers for screenshots / QA: ?tab=profile, ?push=wheel
const qs = new URLSearchParams(location.search);
if (qs.get('tab') === 'profile') navigate.tab('profile');
const p = qs.get('push');
if (p) setTimeout(async () => {
  for (const step of p.split(',')) { const [id, arg] = step.split(':'); await navigate.push(id as never, arg ? { id: arg } : {}); }
}, 100);
