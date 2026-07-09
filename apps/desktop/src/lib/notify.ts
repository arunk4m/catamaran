import { toast } from "sonner";

/**
 * Thin wrapper over the toast library so components depend on this stable
 * surface (and tests can mock it) rather than sonner directly. Toasts appear
 * top-right (see the `<Toaster>` mount in App).
 */
export const notify = {
  /** A completed operation, e.g. "Scaled web to 3". */
  success(message: string, description?: string): void {
    toast.success(message, description ? { description } : undefined);
  },
  /** A failed operation; `description` carries the error detail. */
  error(message: string, description?: string): void {
    toast.error(message, description ? { description } : undefined);
  },
  /** Neutral information. */
  info(message: string, description?: string): void {
    toast(message, description ? { description } : undefined);
  },
  /** Start a long-running operation; pass the returned id to `resolve`. */
  loading(message: string): string | number {
    return toast.loading(message);
  },
  /** Settle a `loading` toast in place with the operation's outcome. */
  resolve(id: string | number, ok: boolean, message: string, description?: string): void {
    if (ok) toast.success(message, { id, description, duration: 4000 });
    else toast.error(message, { id, description, duration: 8000 });
  },
  /**
   * A newer app version is available. Carries a "View update" action that takes
   * the user to the Updates section; stays up for a while since it's passive.
   */
  updateAvailable(version: string, onView: () => void): void {
    toast("Update available", {
      description: `catamaran ${version} is ready to install.`,
      action: { label: "View update", onClick: () => onView() },
      duration: 12000,
    });
  },
};
