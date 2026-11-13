/** Mascot: a cozy autumn ghost with a knitted scarf. Pure SVG, animated via CSS (transform/opacity only). */
export const ghostSvg = (id = 'm') => `
<svg class="ghost-svg" viewBox="0 0 64 64" aria-hidden="true">
  <defs>
    <linearGradient id="${id}-body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fffaf3"/>
      <stop offset=".65" stop-color="#f6ecff"/>
      <stop offset="1" stop-color="#d9c6ff"/>
    </linearGradient>
    <radialGradient id="${id}-shade" cx=".75" cy=".7" r=".6">
      <stop offset="0" stop-color="#8f6ad9" stop-opacity=".28"/>
      <stop offset="1" stop-color="#8f6ad9" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${id}-scarf" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#5ee9ff"/>
      <stop offset=".45" stop-color="#9d6bff"/>
      <stop offset="1" stop-color="#ff4fc8"/>
    </linearGradient>
    <clipPath id="${id}-clip">
      <path d="M14 31C14 18.5 22 10 32 10s18 8.5 18 21v17.5c0 4-3.5 6-6.5 3.5-2-1.7-4.5-1.7-6 .5-2 3-9 3-11 0-1.5-2.2-4-2.2-6-.5-3 2.5-6.5.5-6.5-3.5z"/>
    </clipPath>
  </defs>
  <g class="ghost-body">
    <path d="M14 31C14 18.5 22 10 32 10s18 8.5 18 21v17.5c0 4-3.5 6-6.5 3.5-2-1.7-4.5-1.7-6 .5-2 3-9 3-11 0-1.5-2.2-4-2.2-6-.5-3 2.5-6.5.5-6.5-3.5z" fill="url(#${id}-body)"/>
    <g clip-path="url(#${id}-clip)">
      <rect x="14" y="10" width="36" height="46" fill="url(#${id}-shade)"/>
      <ellipse cx="23.5" cy="18.5" rx="5.5" ry="3.2" transform="rotate(-32 23.5 18.5)" fill="#fff" opacity=".9"/>
      <!-- scarf wrap -->
      <path d="M13 38.5Q32 45.5 51 38.5V44.5Q32 51.5 13 44.5Z" fill="url(#${id}-scarf)"/>
      <path d="M13 41.4Q32 48.4 51 41.4" stroke="#e8f7ff" stroke-width=".9" fill="none" stroke-dasharray="1.6 1.4" opacity=".8"/>
    </g>
    <g class="ghost-eyes">
      <ellipse cx="26" cy="28.5" rx="3.1" ry="4.1" fill="#1b1d4a"/>
      <ellipse cx="38" cy="28.5" rx="3.1" ry="4.1" fill="#1b1d4a"/>
      <circle cx="27.1" cy="27" r="1.15" fill="#fff"/>
      <circle cx="39.1" cy="27" r="1.15" fill="#fff"/>
    </g>
    <ellipse cx="21.6" cy="34.2" rx="2.8" ry="1.6" fill="#ff8ad8" opacity=".5"/>
    <ellipse cx="42.4" cy="34.2" rx="2.8" ry="1.6" fill="#ff8ad8" opacity=".5"/>
    <path d="M29.6 34.3q2.4 2.4 4.8 0" stroke="#1b1d4a" stroke-width="1.6" stroke-linecap="round" fill="none"/>
    <!-- scarf tail -->
    <g class="ghost-scarf-tail">
      <path d="M41 43.5l6.5-.8 1.6 11.2-6.2 1.2z" fill="url(#${id}-scarf)"/>
      <path d="M42.9 55.1l.4 2.4M45 54.7l.4 2.4M47.1 54.3l.4 2.4" stroke="#ff7ad6" stroke-width="1.2" stroke-linecap="round"/>
      <path d="M42 47.5l6-.9M42.5 51l6-.9" stroke="#e8f7ff" stroke-width=".8" opacity=".75"/>
    </g>
  </g>
</svg>`;
