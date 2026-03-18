import type { RtDrawApi } from '@renderer/state/types';

declare global {
  interface Window {
    rtDraw?: RtDrawApi;
  }
}

export {};
