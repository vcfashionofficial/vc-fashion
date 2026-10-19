// VC Fashion PWA support: registers the service worker and provides a safe,
// honest install affordance. The browser's native install prompt is used only
// where it is actually exposed; for every other browser (notably iPhone/iPad
// Safari) clear per-platform instructions are shown instead. This script is
// loaded on customer-facing pages only — never on the admin panel.
(() => {
  'use strict';

  // A service worker requires a secure context: HTTPS in deployment, or
  // localhost/127.0.0.1 during development.
  const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const isSecureContext = location.protocol === 'https:' || isLocalhost;
  if (isSecureContext && 'serviceWorker' in navigator) {
    addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(error => {
        console.warn('VC Fashion offline support could not be started.', error);
      });
    });
  }

  const installButton = document.getElementById('install-app');
  const floatingInstallButton = document.getElementById('install-app-float');
  const instructionsPanel = document.getElementById('install-instructions');
  const floatingInstructionsPanel = document.getElementById('install-float-instructions');
  const installButtons = [installButton, floatingInstallButton].filter(Boolean);
  if (!installButtons.length && !instructionsPanel && !floatingInstructionsPanel) return;

  const standaloneQuery = window.matchMedia ? window.matchMedia('(display-mode: standalone)') : null;
  const isStandalone = (standaloneQuery && standaloneQuery.matches) || navigator.standalone === true;

  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);

  let deferredPrompt = null;

  const hideInstallUi = () => {
    installButtons.forEach(button => { button.hidden = true; button.setAttribute('aria-expanded', 'false'); });
    if (instructionsPanel) instructionsPanel.hidden = true;
    if (floatingInstructionsPanel) floatingInstructionsPanel.hidden = true;
  };

  const installationSteps = () => {
    if (isIos) {
      return {
        title: 'Add VC Fashion to your Home Screen',
        steps: [
          'In Safari, tap the Share button (a square with an upward arrow).',
          'Scroll down and choose “Add to Home Screen”, then tap Add.',
          'The VC Fashion app icon appears on your Home Screen.'
        ]
      };
    }
    if (isAndroid) {
      return {
        title: 'Install the VC Fashion app',
        steps: [
          'Tap the ⋮ menu in Chrome (or your browser).',
          'Choose “Install app” or “Add to Home screen”.',
          'Confirm with Install — the app opens in its own window.'
        ]
      };
    }
    return {
      title: 'Install VC Fashion on your computer',
      steps: [
        'Look for the install icon in your browser’s address bar, or',
        'Open the browser menu and choose “Install VC Fashion” / “Install this site as an app”.',
        'Some browsers do not offer an install option — you can keep browsing in a tab or bookmark the shop instead.'
      ]
    };
  };

  const showInstructions = () => {
    showInstructionsIn(instructionsPanel);
  };

  const showInstructionsIn = panel => {
    if (!panel) return;
    const { title, steps } = installationSteps();
    const heading = document.createElement('strong');
    heading.textContent = title;
    const list = document.createElement('ul');
    for (const step of steps) {
      const item = document.createElement('li');
      item.textContent = step;
      list.appendChild(item);
    }
    panel.replaceChildren(heading, list);
    panel.hidden = false;
  };

  if (isStandalone) {
    // Already installed: no install controls needed.
    hideInstallUi();
  } else {
    // Do not make visibility depend on beforeinstallprompt. Chrome may delay or
    // omit that event (for example before its installability checks complete),
    // and localhost is not always immediately installable. The button remains
    // useful because clicking without a captured event opens honest guidance.
    installButtons.forEach(button => { button.hidden = false; });
  }

  addEventListener('beforeinstallprompt', event => {
    // Chromium qualifies for the native prompt: keep it and reveal the button.
    event.preventDefault();
    deferredPrompt = event;
    if (!isStandalone) installButtons.forEach(button => { button.hidden = false; });
  });

  addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallUi();
  });

  installButtons.forEach(button => {
    button.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        let choice = null;
        try {
          choice = await deferredPrompt.userChoice;
        } catch {
          // The prompt was already handled; nothing further to do.
        }
        deferredPrompt = null;
        if (instructionsPanel) instructionsPanel.hidden = true;
        if (floatingInstructionsPanel) floatingInstructionsPanel.hidden = true;
        installButtons.forEach(installControl => installControl.setAttribute('aria-expanded', 'false'));
        if (choice?.outcome === 'accepted') hideInstallUi();
        return;
      }
      const panel = button === floatingInstallButton ? floatingInstructionsPanel : instructionsPanel;
      const wasOpen = panel && !panel.hidden;
      if (instructionsPanel) instructionsPanel.hidden = true;
      if (floatingInstructionsPanel) floatingInstructionsPanel.hidden = true;
      showInstructionsIn(wasOpen ? null : panel);
      button.setAttribute('aria-expanded', String(Boolean(panel && !wasOpen)));
    });
  });
})();
