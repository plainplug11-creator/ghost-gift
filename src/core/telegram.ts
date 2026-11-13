/**
 * Thin, defensive wrapper around Telegram.WebApp.
 * Every call is feature-detected (isVersionAtLeast) so the app works in old
 * clients and in a plain browser (dev / screenshots) without throwing.
 */

export interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
}

interface Inset { top: number; bottom: number; left: number; right: number }

interface WebApp {
  initData: string;
  initDataUnsafe: { user?: TgUser; start_param?: string };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  viewportHeight: number;
  viewportStableHeight: number;
  isExpanded: boolean;
  safeAreaInset?: Inset;
  contentSafeAreaInset?: Inset;
  ready(): void;
  expand(): void;
  isVersionAtLeast(v: string): boolean;
  setHeaderColor(c: string): void;
  setBackgroundColor(c: string): void;
  setBottomBarColor?(c: string): void;
  disableVerticalSwipes?(): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  requestFullscreen?(): void;
  isFullscreen?: boolean;
  shareToStory?(mediaUrl: string, params?: { text?: string; widget_link?: { url: string; name?: string } }): void;
  shareMessage?(msgId: string, cb?: (ok: boolean) => void): void;
  openTelegramLink?(url: string): void;
  CloudStorage?: { getItem(k: string, cb: (e: unknown, v?: string) => void): void; setItem(k: string, v: string, cb?: (e: unknown, ok?: boolean) => void): void };
  onEvent(e: string, cb: (...a: unknown[]) => void): void;
  offEvent(e: string, cb: (...a: unknown[]) => void): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback: {
    impactOccurred(s: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(t: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
}

declare global {
  interface Window { Telegram?: { WebApp?: WebApp } }
}

const wa: WebApp | undefined = window.Telegram?.WebApp;
/** True only inside a real Telegram client (initData is signed by Telegram). */
export const inTelegram = !!wa && !!wa.initData;

const at = (v: string) => !!wa && inTelegram && wa.isVersionAtLeast(v);
const safe = (fn: () => void) => { try { fn(); } catch { /* old client */ } };

const DEV_USER: TgUser = { id: 1, first_name: 'Алекс', username: 'alex', language_code: 'ru' };

export const tg = {
  raw: wa,
  /** Signed init data — send this to the backend; the server verifies the hash. */
  initData: wa?.initData ?? '',
  user: (inTelegram ? wa!.initDataUnsafe.user : undefined) ?? DEV_USER,
  platform: wa?.platform ?? 'web',

  init(theme: { header: string; bg: string; bottom: string }) {
    if (!wa) return;
    safe(() => wa.ready());
    safe(() => wa.expand());
    if (at('6.1')) {
      safe(() => wa.setHeaderColor(theme.header));
      safe(() => wa.setBackgroundColor(theme.bg));
    }
    if (at('7.10')) safe(() => wa.setBottomBarColor?.(theme.bottom));
    // Stop the "swipe down closes the app" gesture from fighting our scroll areas.
    if (at('7.7')) safe(() => wa.disableVerticalSwipes?.());
    // Fullscreen (Bot API 8.0) — phones only; desktop clients keep the normal window.
    if (at('8.0') && /^(ios|android)/.test(wa.platform)) {
      safe(() => wa.onEvent('fullscreenChanged', () => document.documentElement.classList.toggle('is-fullscreen', !!wa.isFullscreen)));
      safe(() => wa.onEvent('fullscreenFailed', () => document.documentElement.classList.remove('is-fullscreen')));
      safe(() => wa.requestFullscreen?.());
    }

    const syncViewport = () => {
      const h = wa.viewportStableHeight || wa.viewportHeight;
      if (h) document.documentElement.style.setProperty('--tg-vh', `${h}px`);
    };
    const syncInsets = () => {
      const s = wa.safeAreaInset, c = wa.contentSafeAreaInset;
      const root = document.documentElement.style;
      // safeAreaInset = device notch/home bar; contentSafeAreaInset = Telegram's own
      // overlaid controls (Close / ⋯ in fullscreen). Content must clear both.
      root.setProperty('--tg-safe-top', `${(s?.top ?? 0) + (c?.top ?? 0)}px`);
      root.setProperty('--tg-safe-bottom', `${(s?.bottom ?? 0) + (c?.bottom ?? 0)}px`);
      root.setProperty('--tg-safe-left', `${(s?.left ?? 0) + (c?.left ?? 0)}px`);
      root.setProperty('--tg-safe-right', `${(s?.right ?? 0) + (c?.right ?? 0)}px`);
    };
    syncViewport(); syncInsets();
    safe(() => wa.onEvent('viewportChanged', syncViewport));
    if (at('8.0')) {
      safe(() => wa.onEvent('safeAreaChanged', syncInsets));
      safe(() => wa.onEvent('contentSafeAreaChanged', syncInsets));
    }
  },

  /** Haptics are a no-op outside Telegram / on old clients. */
  haptic: {
    tap: () => at('6.1') && safe(() => wa!.HapticFeedback.impactOccurred('light')),
    soft: () => at('6.1') && safe(() => wa!.HapticFeedback.impactOccurred('soft')),
    select: () => at('6.1') && safe(() => wa!.HapticFeedback.selectionChanged()),
    medium: () => at('6.1') && safe(() => wa!.HapticFeedback.impactOccurred('medium')),
    heavy: () => at('6.1') && safe(() => wa!.HapticFeedback.impactOccurred('heavy')),
    rigid: () => at('6.1') && safe(() => wa!.HapticFeedback.impactOccurred('rigid')),
    success: () => at('6.1') && safe(() => wa!.HapticFeedback.notificationOccurred('success')),
    warning: () => at('6.1') && safe(() => wa!.HapticFeedback.notificationOccurred('warning')),
    error: () => at('6.1') && safe(() => wa!.HapticFeedback.notificationOccurred('error')),
  },

  /** "Are you sure?" on close — enabled only while a case is opening. */
  closingConfirmation(on: boolean) {
    if (!at('6.2')) return;
    safe(() => (on ? wa!.enableClosingConfirmation?.() : wa!.disableClosingConfirmation?.()));
  },

  /** Telegram CloudStorage (6.9+) with localStorage mirror/fallback. */
  cloud: {
    get(k: string): Promise<string | null> {
      const local = localStorage.getItem(k);
      if (!at('6.9') || !wa!.CloudStorage) return Promise.resolve(local);
      return new Promise((res) => {
        const t = setTimeout(() => res(local), 800);
        safe(() => wa!.CloudStorage!.getItem(k, (e, v) => { clearTimeout(t); res(e || v === undefined || v === '' ? local : v); }));
      });
    },
    set(k: string, v: string) {
      try { localStorage.setItem(k, v); } catch { /* ignore */ }
      if (at('6.9')) safe(() => wa!.CloudStorage?.setItem(k, v));
    },
  },

  share: {
    /** Bot API 7.8. mediaUrl must be a public https URL (server-rendered card). */
    canStory: () => at('7.8') && typeof wa?.shareToStory === 'function',
    story(mediaUrl: string, text: string, link?: string) {
      safe(() => wa!.shareToStory!(mediaUrl, { text, widget_link: link ? { url: link, name: 'Ghost Gift' } : undefined }));
    },
    /** Bot API 8.0. msgId comes from the server (savePreparedInlineMessage). */
    canMessage: () => at('8.0') && typeof wa?.shareMessage === 'function',
    message(msgId: string, cb?: (ok: boolean) => void) { safe(() => wa!.shareMessage!(msgId, cb)); },
    /** Universal fallback: Telegram's share picker via t.me link. */
    link(url: string, text: string) {
      const u = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
      if (inTelegram && wa?.openTelegramLink) safe(() => wa.openTelegramLink!(u));
      else window.open(u, '_blank', 'noopener');
    },
  },

  backButton: {
    show(cb: () => void) {
      if (!at('6.1')) return;
      safe(() => { wa!.BackButton.onClick(cb); wa!.BackButton.show(); });
    },
    hide(cb: () => void) {
      if (!at('6.1')) return;
      safe(() => { wa!.BackButton.offClick(cb); wa!.BackButton.hide(); });
    },
  },

  /** Subscribe to app focus changes (Bot API 8.0 'activated'/'deactivated'). */
  onActiveChange(cb: (active: boolean) => void) {
    if (!at('8.0')) return;
    safe(() => wa!.onEvent('activated', () => cb(true)));
    safe(() => wa!.onEvent('deactivated', () => cb(false)));
  },
};
