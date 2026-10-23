// Where each document tab left its Thumbnails list (Story 3.5, AC 3): the
// scroll offset by `<tabId>:<documentId>`, restored when the tab is shown again.

const offsets = new Map<string, number>();

export const thumbnailScroll = {
  get: (key: string): number | undefined => offsets.get(key),
  set: (key: string, top: number): void => {
    offsets.set(key, top);
  },
  /** Forgets a closed tab's offsets. */
  forgetTab: (tabId: string): void => {
    for (const key of [...offsets.keys()]) if (key.startsWith(`${tabId}:`)) offsets.delete(key);
  },
  clear: (): void => offsets.clear(),
};
