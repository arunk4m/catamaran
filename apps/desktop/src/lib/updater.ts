import { invokeCommand, subscribe } from "../transport/transport";
import type { UpdateChannel } from "./settings";

/** Metadata for an update available on a channel. */
export interface UpdateMeta {
  version: string;
  currentVersion: string;
  notes: string;
}

interface RawUpdateMeta {
  version: string;
  current_version: string;
  notes: string | null;
}

interface RawProgress {
  downloaded: number;
  total: number | null;
}

/** Ask the channel's manifest whether a newer version exists (null = up to date). */
export async function checkForUpdate(channel: UpdateChannel): Promise<UpdateMeta | null> {
  const meta = await invokeCommand<RawUpdateMeta | null>("update_check", { channel });
  if (!meta) return null;
  return {
    version: meta.version,
    currentVersion: meta.current_version,
    notes: meta.notes ?? "",
  };
}

/**
 * Download and install the channel's available update. Progress is reported as
 * a whole percent, or null when the server didn't announce a total size. After
 * this resolves the app must be relaunched for the new version to run.
 */
export async function installUpdate(
  channel: UpdateChannel,
  onProgress?: (percent: number | null) => void,
): Promise<void> {
  // Subscribe before starting the install so the first progress event can't
  // race ahead of the listener.
  const dispose = await subscribe("update://progress", (payload) => {
    const progress = payload as RawProgress;
    onProgress?.(
      progress.total ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100)) : null,
    );
  });
  try {
    await invokeCommand("update_install", { channel });
  } finally {
    dispose();
  }
}
