import { Flipbook } from './flipbook/Flipbook.js';
import { setupPwa } from './pwa.js';
import { CoffeeCup } from './flipbook/coffee.js';
import { Burger } from './flipbook/burger.js';
import { Pen } from './flipbook/pen.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const book = new Flipbook(stage, {
  // clinical palette: deep navy board, cool white paper
  coverColor: '#123c57',
  paperColor: '#f4f7f9',
  edgeColor: '#eef2f5',
  edgeLine: '80,100,120',
  fiberColor: '#7b8e9c',
  // keep the book clear of the header and the bottom toolbar on every screen size
  padding: () => {
    const bar = document.querySelector('.bar').getBoundingClientRect();
    const nav = document.querySelector('.controls').getBoundingClientRect();
    const small = innerWidth < 640;
    // single page view on phones: tighter side margins so the page is as large as possible
    // desktop: the book fills the space right between the header and the toolbar
    return { top: bar.bottom - (small ? -4 : 6), bottom: innerHeight - nav.top + (small ? 8 : 6), side: small ? 8 : 12 };
  },
});
window.book = book;

const params = new URLSearchParams(location.search);
// the one catalogue this viewer shows: replace public/catalog.pdf with yours
const src = '/catalog.pdf';

book.addEventListener('progress', (e) => {
  $('loadText').textContent = `Opening catalogue… ${Math.round(e.detail.loaded * 100)}%`;
});
let firstLoad = true;
if (matchMedia('(pointer: coarse)').matches) {
  $('hint').textContent = 'Swipe to turn the page, pinch to zoom';
}
book.addEventListener('ready', () => {
  $('loader').classList.add('done');
  const deep = parseInt(params.get('page'), 10);
  if (firstLoad && deep > 0) book.jumpToPage(deep);
  firstLoad = false;
  // pen, coffee cup and burger are hidden; add ?fun=1 to the address to bring them back
  if (params.get('fun') === '1') {
    if (!window.pen) window.pen = new Pen(book);
    if (!window.cup) window.cup = new CoffeeCup(book, { logo: '/brand/opsis-logo-navy.png' });
    if (!window.burger) window.burger = new Burger(book);
  }
  buildThumbs();
  setTimeout(() => $('hint').classList.add('show'), 600);
  setTimeout(() => $('hint').classList.remove('show'), 5200);
});
book.addEventListener('flip', (e) => {
  const p = e.detail.pages;
  const n = book.pageCount;
  $('counter').textContent = p.length ? `${p.join('–')} / ${n}` : `– / ${n}`;
  $('btnPrev').disabled = !book.canPrev;
  $('btnNext').disabled = !book.canNext;
  document.querySelectorAll('.thumb').forEach((t) => t.classList.toggle('on', p.includes(+t.dataset.page)));
});

book.load(src).catch((err) => {
  $('loadText').textContent = 'Could not open the PDF';
  console.error(err);
});

$('btnPrev').onclick = () => book.prev();
$('btnNext').onclick = () => book.next();

// sound
const syncSound = () => $('btnSound').classList.toggle('off', !book.sound.enabled);
$('btnSound').onclick = () => { book.sound.enabled = !book.sound.enabled; syncSound(); };
syncSound();

// fullscreen
$('btnFull').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
};

// thumbnails
let thumbsBuilt = false;
$('btnThumbs').onclick = () => {
  const open = !$('thumbs').classList.contains('open');
  $('thumbs').classList.toggle('open', open);
  $('thumbs').setAttribute('aria-hidden', String(!open));
  if (open) loadThumbs();
};
function buildThumbs() {
  const track = $('track');
  track.innerHTML = '';
  thumbsBuilt = false;
  for (let i = 1; i <= book.pageCount; i++) {
    const b = document.createElement('button');
    b.className = 'thumb';
    b.dataset.page = i;
    b.style.aspectRatio = `1 / ${book.pdf.aspect}`;
    b.innerHTML = `<span>${i}</span>`;
    b.onclick = () => book.goToPage(i);
    track.appendChild(b);
  }
  if ($('thumbs').classList.contains('open')) loadThumbs();
}
function loadThumbs() {
  if (thumbsBuilt) return;
  thumbsBuilt = true;
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const el = en.target;
      io.unobserve(el);
      book.renderThumb(+el.dataset.page, 200).then((c) => {
        const img = new Image();
        img.src = c.toDataURL('image/jpeg', 0.8);
        el.prepend(img);
      });
    }
  }, { root: $('thumbs'), rootMargin: '200px' });
  document.querySelectorAll('.thumb').forEach((t) => io.observe(t));
}

// ------------------------------------------------------------ download
$('btnDownload').href = src;
$('btnDownload').download = src.split('/').pop();

// ------------------------------------------------------------ share
const ICONS = {
  facebook: '<path d="M14 8h2.5V4.5H14A4 4 0 0 0 10 8.5V11H7.5v3.5H10V21h3.5v-6.5H16l.5-3.5h-3V8.8c0-.5.3-.8.5-.8z"/>',
  linkedin: '<path d="M5 9h3.2v11H5zM6.6 3.8a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8zM10.4 9h3v1.5c.5-.9 1.6-1.8 3.4-1.8 3.4 0 4 2.2 4 5.1V20h-3.2v-5.4c0-1.3 0-2.9-1.8-2.9s-2.1 1.4-2.1 2.8V20h-3.3z"/>',
  x: '<path d="M4 4h4.5l4 5.6L17.3 4H20l-6.3 7.3L20.5 20H16l-4.4-6.1L6.3 20H3.6l6.8-7.8z"/>',
  whatsapp: '<path d="M12 3.5a8.5 8.5 0 0 0-7.3 12.8L3.5 20.5l4.3-1.1A8.5 8.5 0 1 0 12 3.5zm4.6 11.8c-.2.6-1.1 1.1-1.6 1.2-.4 0-.9.1-2.8-.6-2.4-1-3.9-3.4-4-3.6-.1-.2-1-1.3-1-2.5s.6-1.8.9-2c.2-.3.5-.3.6-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.7 1.2 1.5 1.9 1 .9 1.9 1.2 2.2 1.3.3.1.4.1.6-.1l.8-1c.2-.2.4-.2.6-.1l1.8.9c.3.1.4.2.5.3.1.2.1.7-.1 1.3z"/>',
  viber: '<path d="M12 3c-4.4 0-8 2.6-8 7.4 0 2.8 1.2 4.6 3 5.7V20l3-2.4c.6.1 1.3.2 2 .2 4.4 0 8-2.6 8-7.4S16.4 3 12 3zm3.6 10.4c-.3.6-1.2 1.1-1.8.9-2.6-.8-4.6-2.8-5.4-5.4-.2-.6.3-1.5.9-1.8.3-.1.6 0 .8.2l.9 1.3c.2.3.1.6-.1.8l-.4.4c.4 1 1.2 1.8 2.2 2.2l.4-.4c.2-.2.6-.3.8-.1l1.3.9c.4.3.5.6.4 1z"/>',
  email: '<path d="M4 6h16v12H4z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4.5 6.5 12 13l7.5-6.5" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  more: '<path d="M12 15V4m0 0L8 8m4-4 4 4M6 12v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
};
const NETWORKS = [
  { id: 'facebook', label: 'Facebook', url: (u) => `https://www.facebook.com/sharer/sharer.php?u=${u}` },
  { id: 'linkedin', label: 'LinkedIn', url: (u) => `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
  { id: 'x', label: 'X', url: (u, t) => `https://twitter.com/intent/tweet?url=${u}&text=${t}` },
  { id: 'whatsapp', label: 'WhatsApp', url: (u, t) => `https://wa.me/?text=${t}%20${u}` },
  { id: 'viber', label: 'Viber', url: (u, t) => `viber://forward?text=${t}%20${u}` },
  { id: 'email', label: 'Email', url: (u, t) => `mailto:?subject=${t}&body=${u}` },
];

function shareLink() {
  const url = new URL(location.href);
  url.search = '';
  const first = book.visiblePages()[0];
  if ($('sharePageOpt').checked && first > 1) url.searchParams.set('page', first);
  return url.toString();
}
function renderShare() {
  const link = shareLink();
  $('shareUrl').value = link;
  const u = encodeURIComponent(link), t = encodeURIComponent($('docTitle').textContent);
  const items = NETWORKS.map((n) => `<a class="share-item ${n.id}" href="${n.url(u, t)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24">${ICONS[n.id]}</svg><span>${n.label}</span></a>`);
  if (navigator.share) items.push(`<button class="share-item more" id="btnNative"><svg viewBox="0 0 24 24">${ICONS.more}</svg><span>More</span></button>`);
  $('shareGrid').innerHTML = items.join('');
  $('btnNative')?.addEventListener('click', () => {
    navigator.share({ title: $('docTitle').textContent, url: shareLink() }).catch(() => {});
  });
}
function toggleShare(open) {
  $('sharePop').classList.toggle('open', open);
  $('btnShare').setAttribute('aria-expanded', String(open));
  if (open) renderShare();
}
$('btnShare').onclick = (e) => { e.stopPropagation(); toggleShare(!$('sharePop').classList.contains('open')); };
$('sharePop').onclick = (e) => e.stopPropagation();
$('sharePageOpt').onchange = renderShare;
document.addEventListener('click', () => toggleShare(false));
book.addEventListener('flip', () => { if ($('sharePop').classList.contains('open')) renderShare(); });
$('btnCopy').onclick = async () => {
  try { await navigator.clipboard.writeText($('shareUrl').value); }
  catch { $('shareUrl').select(); document.execCommand('copy'); }
  toast('Link copied');
};
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 1800);
}

// iOS Safari ignores user-scalable=no; block its native pinch gestures directly
['gesturestart', 'gesturechange', 'gestureend'].forEach((t) =>
  document.addEventListener(t, (e) => e.preventDefault(), { passive: false })
);

// offline app: caches everything after the first visit, offers "Install app"
setupPwa({ installButton: $('btnInstall'), toast });

// the coffee joke: clean button + a one-time hint
book.addEventListener('stain', (e) => { $('btnClean').hidden = !!e.detail.cleared; });
$('btnClean').onclick = () => { book.clearStains(); window.cup?.clearSplats(); window.burger?.clearSplats(); $('btnClean').hidden = true; };
let cupHinted = false;
let burgerHinted = false;
book.addEventListener('burger', (e) => {
  if (e.detail.type === 'hover' && !burgerHinted) { burgerHinted = true; toast('Fling the burger. Double click squeezes it'); }
});
book.addEventListener('coffee', (e) => {
  if (e.detail.type === 'hover' && !cupHinted) { cupHinted = true; toast('Grab the cup and fling it. Double click throws it'); }
});

// the pen: toolbar while it's in hand
const penBar = $('penBar');
let penHinted = false;
book.addEventListener('pen', (e) => {
  if (e.detail.hover && !penHinted) { penHinted = true; toast('Pick up the pen to write on the catalogue'); }
  if (e.detail.color) penBar.querySelectorAll('.sw').forEach((x) => x.classList.toggle('on', x.dataset.color === e.detail.color));
  if (e.detail.active !== undefined) {
    penBar.classList.toggle('open', e.detail.active);
    $('hint').classList.remove('show');
  }
});
penBar.querySelectorAll('.sw').forEach((b) => b.addEventListener('click', () => {
  window.pen.setColor(b.dataset.color);
}));
$('penUndo').onclick = () => window.pen.undo();
$('penDone').onclick = () => window.pen.deactivate();
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.pen?.deactivate();
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && window.pen?.active) { e.preventDefault(); window.pen.undo(); }
});
