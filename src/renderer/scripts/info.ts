import type { RtDrawApi } from '@renderer/state/types';

function getRtDrawApi(): RtDrawApi | null {
  return window.rtDraw && typeof window.rtDraw === 'object' ? window.rtDraw : null;
}

async function openExternalUrl(url: string | null) {
  const target = String(url || '').trim();
  if (!target) {
    return;
  }

  const api = getRtDrawApi();
  if (api && typeof api.openExternal === 'function') {
    const ok = await api.openExternal(target);
    if (!ok) {
      alert('외부 링크를 열지 못했습니다.');
    }
    return;
  }

  window.location.href = target;
}

function bindExternalLinkDelegation() {
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const trigger = target.closest('[data-external-url]');
    if (!trigger) {
      return;
    }

    if (trigger instanceof HTMLAnchorElement) {
      event.preventDefault();
    }

    const url = trigger.getAttribute('data-external-url');
    void openExternalUrl(url);
  });
}

function bindCloseButton() {
  const closeButton = document.getElementById('close-info');
  if (!(closeButton instanceof HTMLButtonElement)) {
    return;
  }

  closeButton.addEventListener('click', () => {
    const api = getRtDrawApi();
    if (api && typeof api.closeWindow === 'function') {
      void api.closeWindow();
      return;
    }

    window.close();
  });
}

async function syncAppVersion() {
  const versionTarget = document.getElementById('app-version');
  if (!versionTarget) {
    return;
  }

  const api = getRtDrawApi();
  if (!api || typeof api.getWindowState !== 'function') {
    return;
  }

  try {
    const result = await api.getWindowState();
    const appVersion =
      result && result.ok === true && result.state && typeof result.state.appVersion === 'string'
        ? result.state.appVersion.trim()
        : '';

    if (appVersion) {
      versionTarget.textContent = appVersion;
    }
  } catch {
    return;
  }
}

async function initInfoPage() {
  bindExternalLinkDelegation();
  bindCloseButton();
  await syncAppVersion();
}

void initInfoPage();

export {};

