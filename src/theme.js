// Dark mode, switched by an old gold pull chain hanging from the top of the page (desktop only).
import { t, onLangChange } from './i18n.js';

const KEY = 'opsis-theme';

export function setupTheme({ book, isSoundOn }) {
  const root = document.documentElement;
  const pull = document.getElementById('pull');
  const arm = document.getElementById('pullArm');
  const meta = document.querySelector('meta[name="theme-color"]');

  let dark = false;
  try { dark = localStorage.getItem(KEY) === 'dark'; } catch {}

  const syncTitle = () => {
    pull.dataset.i18nTitle = dark ? 'lightTitle' : 'darkTitle';
    pull.title = t(pull.dataset.i18nTitle);
  };
  const apply = () => {
    root.dataset.theme = dark ? 'dark' : 'light';
    pull.setAttribute('aria-checked', String(dark));
    meta?.setAttribute('content', dark ? '#0d1820' : '#123c57');
    book.setDark?.(dark);
    syncTitle();
  };
  apply();
  onLangChange(syncTitle);

  // hang the chain just left of the header buttons
  const place = () => {
    const actions = document.querySelector('.actions').getBoundingClientRect();
    pull.style.left = `${Math.round(actions.left - 30)}px`;
  };
  place();
  addEventListener('resize', place);
  new ResizeObserver(place).observe(document.querySelector('.actions'));

  // --- a short brass click, synthesised so there is nothing extra to download
  let ctx;
  const click = (pitch) => {
    if (!isSoundOn()) return;
    try {
      ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;
      const len = Math.floor(ctx.sampleRate * 0.05);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = pitch; bp.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, now);
      src.connect(bp).connect(g).connect(ctx.destination);
      src.start(now);
    } catch {}
  };

  // --- spring physics: the chain stretches down when pulled and swings a little
  let y = 0, vy = 0, a = 0, va = 0;
  let dragging = false, startX = 0, startY = 0, moved = false, armed = false, raf = 0;
  const MAX = 46, TRIGGER = 22;

  // the chain grows as it is pulled, so it always stays attached to its mount (no gap at the top)
  const chain = arm.querySelector('.pull-chain');
  const BASE = 112;
  const render = () => {
    arm.style.transform = `rotate(${a.toFixed(3)}deg)`;
    chain.style.height = `${(BASE + Math.max(-6, y)).toFixed(2)}px`;
  };
  const step = () => {
    if (!dragging) {
      vy += (-y * 0.16) - vy * 0.22;
      va += (-a * 0.05) - va * 0.06;
      y += vy; a += va;
    }
    render();
    if (dragging || Math.abs(y) > 0.05 || Math.abs(vy) > 0.05 || Math.abs(a) > 0.02 || Math.abs(va) > 0.02) {
      raf = requestAnimationFrame(step);
    } else {
      y = vy = a = va = 0; render(); raf = 0;
    }
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(step); };

  const toggle = () => {
    dark = !dark;
    try { localStorage.setItem(KEY, dark ? 'dark' : 'light'); } catch {}
    apply();
  };

  pull.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true; moved = false; armed = false;
    startX = e.clientX; startY = e.clientY;
    pull.setPointerCapture(e.pointerId);
    pull.classList.add('held');
    kick();
  });
  pull.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = e.clientY - startY, dx = e.clientX - startX;
    if (Math.abs(dy) > 3 || Math.abs(dx) > 3) moved = true;
    // resists more the further it goes, like a real spring inside the lamp
    y = Math.max(0, MAX * Math.tanh(Math.max(0, dy) / (MAX * 1.4)));
    a = Math.max(-9, Math.min(9, -dx * 0.12));
    if (!armed && y > TRIGGER) { armed = true; click(2600); }
    else if (armed && y < TRIGGER - 6) armed = false;
  });
  const release = (e) => {
    if (!dragging) return;
    dragging = false;
    pull.classList.remove('held');
    try { pull.releasePointerCapture(e.pointerId); } catch {}
    if (!moved) {
      // a plain click: give it a short tug
      armed = true;
      y = 0; vy = 7.5;
      click(2600);
    }
    if (armed) { click(1900); toggle(); }
    vy -= 1.5;
    va += a * -0.02;
    armed = false;
    kick();
  };
  pull.addEventListener('pointerup', release);
  pull.addEventListener('pointercancel', release);
  pull.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      vy = 7.5; click(2600); click(1900); toggle(); kick();
    }
  });
}
