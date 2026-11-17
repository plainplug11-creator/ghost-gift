import { onRunningChange, onFocusChange, inFocus, isRunning, reducedMotion, tier } from '../core/perf';

/**
 * Background video: neon Times Square at night with falling leaves (seamless 7.5 s loop).
 *  - The poster still is in index.html (paints instantly; it is the loop's first frame, so the swap is invisible).
 *  - The video is attached after first paint. Variant is picked per device:
 *      resolution: 720×1280 on high tier, 540×960 on mid tier / slow networks
 *      codec:      HEVC on Apple (hardware decode, best quality per byte) → VP9 WebM → H.264 MP4 fallback
 *  - Low tier, reduced motion or Data Saver → stays on the still.
 *  - Paused whenever the app is hidden / deactivated; resumes on return.
 * Media source + encode scripts: /workspace/ghost-gift-media/bg/ (make-loop.py, encode.sh).
 * NOTE: the old graveyard background was rejected — Times Square only.
 */
type Conn = { saveData?: boolean; effectiveType?: string };

export function pickVariant(probe: HTMLVideoElement) {
  const conn = (navigator as Navigator & { connection?: Conn }).connection;
  const slow = !!conn?.effectiveType && /(^|-)(2g|3g)$/.test(conn.effectiveType);
  const res = tier === 'high' && !slow ? 720 : 540;
  const apple = /iPhone|iPad|Macintosh/.test(navigator.userAgent);
  const can = (t: string) => probe.canPlayType(t) !== '';
  if (apple && can('video/mp4; codecs="hvc1.1.6.L93.B0"')) return { res, file: `bg-${res}.hevc.mp4` };
  if (can('video/webm; codecs="vp9"')) return { res, file: `bg-${res}.webm` };
  return { res, file: `bg-${res}.mp4` };
}

export function mountBackground(root: HTMLElement) {
  const conn = (navigator as Navigator & { connection?: Conn }).connection;
  if (tier === 'low' || reducedMotion || conn?.saveData) return;

  const v = document.createElement('video');
  v.className = 'bg-media bg-video';
  v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true; v.preload = 'auto';
  v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
  v.disablePictureInPicture = true;
  v.setAttribute('disableremoteplayback', '');
  const media = (file: string) => `${import.meta.env.BASE_URL}media/${file}`;
  const { res, file } = pickVariant(v);
  const h264 = `bg-${res}.mp4`;
  v.src = media(file);
  // decode/network failure → one retry with the universal H.264 file, then stay on the poster
  let retried = file === h264;
  v.addEventListener('error', () => {
    if (!retried) { retried = true; v.src = media(h264); play(); return; }
    v.remove();
  });
  v.addEventListener('playing', () => v.classList.add('is-ready'), { once: true });
  root.querySelector('.bg-scrim')!.before(v);

  const play = () => { if (isRunning() && !inFocus()) v.play().catch(() => { /* autoplay blocked → poster stays */ }); };
  onRunningChange((r) => (r ? play() : v.pause()));
  onFocusChange((f) => (f ? v.pause() : play()));
  // iOS may refuse autoplay until the first touch inside the WebView
  const kick = () => { play(); window.removeEventListener('pointerdown', kick); };
  window.addEventListener('pointerdown', kick, { passive: true });
  play();
}
