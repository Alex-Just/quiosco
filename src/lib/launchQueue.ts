/**
 * The slice of the File Handling API the app uses.
 *
 * Chrome for Android does not expose `launchQueue`, so the Android wrapper
 * delivers "Open with" EPUBs through the share target instead. Where a browser
 * does support it, the file arrives on the main thread and never passes
 * through the service worker.
 */
export type LaunchedFileHandle = {
  getFile(): Promise<File>;
};

export type FileLaunch = {
  files?: LaunchedFileHandle[];
};

export type FileLaunchQueue = {
  setConsumer(consumer: (launch: FileLaunch) => void): void;
};

type WindowWithLaunchQueue = Window & {
  launchQueue?: FileLaunchQueue;
};

/** Chrome exposes `launchQueue` only where file handling exists. */
export function fileLaunchQueue(
  scope: WindowWithLaunchQueue = window,
): FileLaunchQueue | null {
  const queue = scope.launchQueue;
  return queue && typeof queue.setConsumer === "function" ? queue : null;
}

/**
 * The first file of a launched set, or null when the launch carried none
 * (an icon or URL launch) or the read grant is gone. One epub per launch keeps
 * the importer's single-book flow honest.
 */
export async function firstLaunchedFile(
  launch: FileLaunch,
): Promise<File | null> {
  const handle = launch.files?.[0];
  if (!handle) return null;
  try {
    return await handle.getFile();
  } catch {
    return null;
  }
}

/**
 * Store a launched file through `save` and report whether one arrived. A
 * failed save propagates: the caller logs it and the user still has the Add
 * page to pick the file.
 */
export async function acceptLaunchedFile(
  launch: FileLaunch,
  save: (file: File) => Promise<void>,
): Promise<boolean> {
  const file = await firstLaunchedFile(launch);
  if (!file) return false;
  await save(file);
  return true;
}
