import { describe, it, expect, vi, beforeEach } from "vitest";

const { toastMock } = vi.hoisted(() => {
  const fn = vi.fn() as unknown as ReturnType<typeof vi.fn> & {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  fn.success = vi.fn();
  fn.error = vi.fn();
  return { toastMock: fn };
});
vi.mock("sonner", () => ({ toast: toastMock }));

import { notify } from "./notify";

beforeEach(() => {
  toastMock.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
});

describe("notify.updateAvailable", () => {
  it("shows a toast with a View-update action that runs the callback", () => {
    const onView = vi.fn();
    notify.updateAvailable("0.3.0", onView);
    expect(toastMock).toHaveBeenCalledTimes(1);
    const [message, opts] = toastMock.mock.calls[0];
    expect(String(message)).toContain("Update available");
    expect(opts.description).toContain("0.3.0");
    expect(opts.action.label).toBe("View update");
    opts.action.onClick();
    expect(onView).toHaveBeenCalled();
  });
});
