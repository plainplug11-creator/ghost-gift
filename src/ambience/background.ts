import { onRunningChange, isRunning, reducedMotion, tier } from '../core/perf';

/**
 * Background video: Times Square at night (seamless 8 s loop, ~0.9–1.2 MB).
 *  - The poster still is already in index.html (paints instantly, ~80 KB).
 *  - Video is attached after first paint; WebM/VP9 first, MP4/H.264 fallback (iOS).
 *  - Low tier, reduced motion or Data Saver → stays on the still.
 *  - Paused whenever the app is hidden / deactivated.
 * To change the background: replace public/media/bg-loop.{webm,mp4} + bg-poster.webp.
 */
export function mountBackground(root: HTMLElement) {
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  if (tier === 'low' || reducedMotion || saveData) return;

  const v = document.createElement('video');
  v.className = 'bg-media bg-video';
  v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true; v.preload = 'auto';
  v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
  v.disablePictureInPicture = true;
  const media = (file: string) => `${import.meta.env.BASE_URL}media/${file}`;
  v.poster = media('bg-poster.webp');
  for (const [src, type] of [[media('bg-loop.webm'), 'video/webm; codecs=vp9'], [media('bg-loop.mp4'), 'video/mp4']]) {
    const s = document.createElement('source'); s.src = src; s.type = type; v.append(s);
  }
  v.addEventListener('playing', () => v.classList.add('is-ready'), { once: true });
  v.addEventListener('error', () => v.remove(), { once: true });
  root.querySelector('.bg-scrim')!.before(v);

  const play = () => { if (isRunning()) v.play().catch(() => { /* autoplay blocked → poster stays */ }); };
  onRunningChange((r) => (r ? play() : v.pause()));
  play();
}
