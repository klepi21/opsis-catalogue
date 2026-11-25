// Offline support + "Install app" button.
import { registerSW } from 'virtual:pwa-register';
import { t } from './i18n.js';

export function setupPwa({ installButton, toast }) {
  registerSW({
    immediate: true,
    onOfflineReady() { toast(t('offlineReady')); },
    // look for a new deploy often: on open, when the tab comes back, and every minute while open.
    // A new version installs itself and the page reloads onto it (registerType autoUpdate).
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => { if (navigator.onLine !== false) reg.update().catch(() => {}); };
      setInterval(() => { if (document.visibilityState === 'visible') check(); }, 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
      addEventListener('focus', check);
    },
  });

  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return; // already installed

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let deferred = null;

  // Chrome, Edge, Android: the browser hands us an install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    installButton.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    installButton.hidden = true;
    deferred = null;
    toast(t('installed'));
  });

  // iPhone / iPad: no prompt API, so explain the Share menu instead
  if (isIOS) installButton.hidden = false;

  installButton.addEventListener('click', async () => {
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice.catch(() => {});
      deferred = null;
      installButton.hidden = true;
    } else if (isIOS) {
      document.getElementById('iosInstall').classList.add('open');
    }
  });
  document.getElementById('iosClose')?.addEventListener('click', () =>
    document.getElementById('iosInstall').classList.remove('open')
  );
}
