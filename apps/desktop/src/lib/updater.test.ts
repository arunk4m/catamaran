import { describe, it, expect, vi, beforeEach } from "vitest";

const { invokeCommandMock, subscribeMock } = vi.hoisted(() => ({
  invokeCommandMock: vi.fn(),
  subscribeMock: vi.fn(),
}));
vi.mock("../transport/transport", () => ({
  invokeCommand: invokeCommandMock,
  subscribe: subscribeMock,
}));

import { checkForUpdate, installUpdate } from "./updater";

beforeEach(() => {
  invokeCommandMock.mockReset();
  subscribeMock.mockReset();
});

describe("checkForUpdate", () => {
  it("returns null when the channel is up to date", async () => {
    invokeCommandMock.mockResolvedValue(null);
    expect(await checkForUpdate("stable")).toBeNull();
    expect(invokeCommandMock).toHaveBeenCalledWith("update_check", { channel: "stable" });
  });

  it("checks the requested channel and maps the metadata", async () => {
    invokeCommandMock.mockResolvedValue({
      version: "0.2.0",
      current_version: "0.1.0",
      notes: "### Features\n- things",
    });
    const meta = await checkForUpdate("dev");
    expect(invokeCommandMock).toHaveBeenCalledWith("update_check", { channel: "dev" });
    expect(meta).toEqual({
      version: "0.2.0",
      currentVersion: "0.1.0",
      notes: "### Features\n- things",
    });
  });

  it("defaults notes to an empty string", async () => {
    invokeCommandMock.mockResolvedValue({ version: "0.2.0", current_version: "0.1.0", notes: null });
    expect((await checkForUpdate("stable"))?.notes).toBe("");
  });
});

describe("installUpdate", () => {
  it("subscribes to progress before starting and reports whole percents", async () => {
    let emit: ((payload: unknown) => void) | undefined;
    const dispose = vi.fn();
    subscribeMock.mockImplementation(async (_ch: string, handler: (p: unknown) => void) => {
      emit = handler;
      return dispose;
    });
    invokeCommandMock.mockImplementation(async () => {
      emit?.({ downloaded: 50, total: 200 });
      emit?.({ downloaded: 200, total: 200 });
    });

    const seen: Array<number | null> = [];
    await installUpdate("dev", (pct) => seen.push(pct));

    expect(subscribeMock).toHaveBeenCalledWith("update://progress", expect.any(Function));
    expect(subscribeMock.mock.invocationCallOrder[0]).toBeLessThan(
      invokeCommandMock.mock.invocationCallOrder[0],
    );
    expect(invokeCommandMock).toHaveBeenCalledWith("update_install", { channel: "dev" });
    expect(seen).toEqual([25, 100]);
    expect(dispose).toHaveBeenCalled();
  });

  it("reports null percent when the total size is unknown", async () => {
    let emit: ((payload: unknown) => void) | undefined;
    subscribeMock.mockImplementation(async (_ch: string, handler: (p: unknown) => void) => {
      emit = handler;
      return vi.fn();
    });
    invokeCommandMock.mockImplementation(async () => {
      emit?.({ downloaded: 10, total: null });
    });

    const seen: Array<number | null> = [];
    await installUpdate("stable", (pct) => seen.push(pct));
    expect(seen).toEqual([null]);
  });

  it("disposes the progress listener when the install fails", async () => {
    const dispose = vi.fn();
    subscribeMock.mockResolvedValue(dispose);
    invokeCommandMock.mockRejectedValue(new Error("boom"));

    await expect(installUpdate("stable")).rejects.toThrow("boom");
    expect(dispose).toHaveBeenCalled();
  });
});
