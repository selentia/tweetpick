import { contextBridge, ipcRenderer } from 'electron';
import type { DrawProgressEvent, RtDrawApi, SaveResultImageRequest, WindowStatePayload } from '@shared/rtDraw';

const IPC_CHANNELS = {
  DRAW_RUN: 'draw:run',
  DRAW_PROGRESS: 'draw:progress',
  APP_OPEN_EXTERNAL: 'app:open-external',
  APP_LEGAL_DOCUMENTS_GET: 'app:legal-documents:get',
  APP_SAVE_RESULT_IMAGE: 'app:save-result-image',
  APP_OPEN_INFO_PAGE: 'app:open-info-page',
  APP_OPEN_LEGAL_PAGE: 'app:open-legal-page',
  APP_WINDOW_MINIMIZE: 'app:window-minimize',
  APP_WINDOW_TOGGLE_MAXIMIZE: 'app:window-toggle-maximize',
  APP_WINDOW_RESIZE_HEIGHT: 'app:window-resize-height',
  APP_WINDOW_CLOSE: 'app:window-close',
  APP_WINDOW_STATE_GET: 'app:window-state:get',
  APP_WINDOW_STATE: 'app:window-state',
} as const;

const api: RtDrawApi = {
  runDraw(input) {
    return ipcRenderer.invoke(IPC_CHANNELS.DRAW_RUN, input || {});
  },

  onProgress(handler) {
    if (typeof handler !== 'function') {
      return () => {};
    }

    const listener = (_: Electron.IpcRendererEvent, payload: DrawProgressEvent) => {
      handler(payload);
    };

    ipcRenderer.on(IPC_CHANNELS.DRAW_PROGRESS, listener);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.DRAW_PROGRESS, listener);
    };
  },

  openExternal(url) {
    return ipcRenderer.invoke(IPC_CHANNELS.APP_OPEN_EXTERNAL, String(url || ''));
  },

  getLegalDocuments() {
    return ipcRenderer.invoke(IPC_CHANNELS.APP_LEGAL_DOCUMENTS_GET);
  },

  openInfoPage() {
    return ipcRenderer.invoke(IPC_CHANNELS.APP_OPEN_INFO_PAGE);
  },

  openLegalPage() {
    return ipcRenderer.invoke(IPC_CHANNELS.APP_OPEN_LEGAL_PAGE);
  },

  saveResultImage(payload: SaveResultImageRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.APP_SAVE_RESULT_IMAGE, payload || {});
  },

  minimizeWindow() {
    return ipcRenderer.invoke(IPC_CHANNELS.APP_WINDOW_MINIMIZE);
  },

  toggleMaximizeWindow() {
    return ipcRenderer.invoke(IPC_CHANNELS.APP_WINDOW_TOGGLE_MAXIMIZE);
  },

  closeWindow() {
    return ipcRenderer.invoke(IPC_CHANNELS.APP_WINDOW_CLOSE);
  },

  getWindowState() {
    return ipcRenderer.invoke(IPC_CHANNELS.APP_WINDOW_STATE_GET);
  },

  resizeWindowHeight(height) {
    return ipcRenderer.invoke(IPC_CHANNELS.APP_WINDOW_RESIZE_HEIGHT, {
      height,
    });
  },

  onWindowState(handler) {
    if (typeof handler !== 'function') {
      return () => {};
    }

    const listener = (_: Electron.IpcRendererEvent, payload: WindowStatePayload) => {
      handler(payload);
    };

    ipcRenderer.on(IPC_CHANNELS.APP_WINDOW_STATE, listener);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.APP_WINDOW_STATE, listener);
    };
  },
};

contextBridge.exposeInMainWorld('rtDraw', Object.freeze(api));

declare global {
  interface Window {
    rtDraw?: RtDrawApi;
  }
}
