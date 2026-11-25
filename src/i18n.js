// Page language (English / Greek). Only the viewer UI is translated, the PDF stays as it is.
const DICT = {
  en: {
    pageTitle: 'Opsis Catalogue 2027',
    eyebrow: 'Catalogue 2027',
    docTitle: 'Maxillofacial Diagnostics',
    install: 'Install app',
    installTitle: 'Install the catalogue as an app, works offline',
    sound: 'Sound',
    soundAria: 'Toggle sound',
    download: 'Download PDF',
    share: 'Share',
    shareHead: 'Share this catalogue',
    sharePage: "Link to the page I'm on",
    copy: 'Copy',
    more: 'More',
    fullscreen: 'Fullscreen',
    opening: 'Opening catalogue…',
    openingPct: 'Opening catalogue… {p}%',
    openFail: 'Could not open the PDF',
    prev: 'Previous page',
    next: 'Next page',
    allPages: 'All pages',
    clean: 'Clean pages',
    cleanTitle: 'Wipe the coffee off the pages',
    hint: 'Drag a page corner, tap, or use ← →. Double click to zoom.',
    hintTouch: 'Swipe to turn the page, pinch to zoom',
    pen: 'Pen',
    red: 'Red', blue: 'Blue', black: 'Black', highlighter: 'Highlighter',
    undo: 'Undo last stroke',
    done: 'Done',
    iosAria: 'Install on iPhone',
    iosTitle: 'Install Opsis Catalogue',
    iosText: 'Read it anytime, even without internet.',
    iosStep1: 'Tap {icon} <b>Share</b> in the Safari toolbar',
    iosStep2: 'Choose <b>Add to Home Screen</b>',
    iosClose: 'Got it',
    linkCopied: 'Link copied',
    offlineReady: 'Ready to use offline',
    installed: 'Installed. Open it from your home screen',
    burgerHint: 'Fling the burger. Double click squeezes it',
    cupHint: 'Grab the cup and fling it. Double click throws it',
    penHint: 'Pick up the pen to write on the catalogue',
    langAria: 'Page language',
    darkAria: 'Dark mode',
    darkTitle: 'Pull the chain for dark mode',
    lightTitle: 'Pull the chain for light mode',
  },
  el: {
    pageTitle: 'Κατάλογος Opsis 2027',
    eyebrow: 'Κατάλογος 2027',
    docTitle: 'Γναθοπροσωπική Διαγνωστική',
    install: 'Εγκατάσταση',
    installTitle: 'Εγκαταστήστε τον κατάλογο ως εφαρμογή, λειτουργεί και χωρίς σύνδεση',
    sound: 'Ήχος',
    soundAria: 'Ενεργοποίηση ή απενεργοποίηση ήχου',
    download: 'Λήψη PDF',
    share: 'Κοινοποίηση',
    shareHead: 'Κοινοποιήστε τον κατάλογο',
    sharePage: 'Σύνδεσμος στη σελίδα που βλέπω',
    copy: 'Αντιγραφή',
    more: 'Περισσότερα',
    fullscreen: 'Πλήρης οθόνη',
    opening: 'Άνοιγμα καταλόγου…',
    openingPct: 'Άνοιγμα καταλόγου… {p}%',
    openFail: 'Δεν ήταν δυνατό το άνοιγμα του PDF',
    prev: 'Προηγούμενη σελίδα',
    next: 'Επόμενη σελίδα',
    allPages: 'Όλες οι σελίδες',
    clean: 'Καθαρισμός σελίδων',
    cleanTitle: 'Σκουπίστε τον καφέ από τις σελίδες',
    hint: 'Σύρετε τη γωνία της σελίδας, πατήστε ή χρησιμοποιήστε τα ← →. Διπλό κλικ για μεγέθυνση.',
    hintTouch: 'Σύρετε για να γυρίσετε σελίδα, τσιμπήστε για μεγέθυνση',
    pen: 'Στυλό',
    red: 'Κόκκινο', blue: 'Μπλε', black: 'Μαύρο', highlighter: 'Μαρκαδόρος',
    undo: 'Αναίρεση τελευταίας γραμμής',
    done: 'Τέλος',
    iosAria: 'Εγκατάσταση σε iPhone',
    iosTitle: 'Εγκατάσταση Καταλόγου Opsis',
    iosText: 'Διαβάστε τον όποτε θέλετε, ακόμη και χωρίς internet.',
    iosStep1: 'Πατήστε {icon} <b>Κοινή χρήση</b> στη γραμμή του Safari',
    iosStep2: 'Επιλέξτε <b>Προσθήκη στην οθόνη Αφετηρίας</b>',
    iosClose: 'Εντάξει',
    linkCopied: 'Ο σύνδεσμος αντιγράφηκε',
    offlineReady: 'Έτοιμο για χρήση χωρίς σύνδεση',
    installed: 'Εγκαταστάθηκε. Ανοίξτε το από την αρχική οθόνη',
    burgerHint: 'Πετάξτε το μπέργκερ. Με διπλό κλικ το στύβετε',
    cupHint: 'Πιάστε την κούπα και πετάξτε τη. Με διπλό κλικ τη ρίχνετε',
    penHint: 'Πιάστε το στυλό για να γράψετε στον κατάλογο',
    langAria: 'Γλώσσα σελίδας',
    darkAria: 'Σκούρο θέμα',
    darkTitle: 'Τραβήξτε το κορδόνι για σκούρο θέμα',
    lightTitle: 'Τραβήξτε το κορδόνι για φωτεινό θέμα',
  },
};

const KEY = 'opsis-lang';
const listeners = new Set();

function initialLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'en' || q === 'el') return q;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'en' || saved === 'el') return saved;
  } catch {}
  // Greek by default, English only when the visitor picks it
  return 'el';
}

export let lang = initialLang();

export function t(key, vars) {
  let s = DICT[lang][key] ?? DICT.en[key] ?? key;
  if (vars) for (const k in vars) s = s.replace(`{${k}}`, vars[k]);
  return s;
}

export function onLangChange(fn) { listeners.add(fn); }

export function setLang(next) {
  if (next !== 'en' && next !== 'el') return;
  lang = next;
  try { localStorage.setItem(KEY, next); } catch {}
  applyLang();
  listeners.forEach((fn) => fn(lang));
}

export function applyLang(root = document) {
  document.documentElement.lang = lang;
  document.title = t('pageTitle');
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const icon = el.querySelector('svg')?.outerHTML || '';
    el.innerHTML = t(el.dataset.i18nHtml, { icon });
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  const sw = document.getElementById('langSwitch');
  if (sw) {
    sw.setAttribute('aria-checked', String(lang === 'el'));
    sw.dataset.lang = lang;
  }
}
