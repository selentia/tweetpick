export const IPC_CHANNELS = {
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

export const IPC_COMMAND_CHANNELS = [
  IPC_CHANNELS.DRAW_RUN,
  IPC_CHANNELS.APP_OPEN_EXTERNAL,
  IPC_CHANNELS.APP_LEGAL_DOCUMENTS_GET,
  IPC_CHANNELS.APP_SAVE_RESULT_IMAGE,
  IPC_CHANNELS.APP_OPEN_INFO_PAGE,
  IPC_CHANNELS.APP_OPEN_LEGAL_PAGE,
  IPC_CHANNELS.APP_WINDOW_MINIMIZE,
  IPC_CHANNELS.APP_WINDOW_TOGGLE_MAXIMIZE,
  IPC_CHANNELS.APP_WINDOW_RESIZE_HEIGHT,
  IPC_CHANNELS.APP_WINDOW_CLOSE,
  IPC_CHANNELS.APP_WINDOW_STATE_GET,
] as const;

export const IPC_EVENT_CHANNELS = [IPC_CHANNELS.DRAW_PROGRESS, IPC_CHANNELS.APP_WINDOW_STATE] as const;

export type RtDrawCommandChannel = (typeof IPC_COMMAND_CHANNELS)[number];
export type RtDrawEventChannel = (typeof IPC_EVENT_CHANNELS)[number];
