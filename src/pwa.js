// Offline support + "Install app" button.
import { registerSW } from 'virtual:pwa-register';

export function setupPwa({ installButton, toast }) {
  registerSW({
    immediate: true,
    onOfflineReady() { toast('Ready to use offline'); },
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
    toast('Installed. Open it from your home screen');
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
