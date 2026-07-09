import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const { podLogsMock, getObjectMock, podsForSelectorMock, startLogStreamMock } = vi.hoisted(() => ({
  podLogsMock: vi.fn(),
  getObjectMock: vi.fn(),
  podsForSelectorMock: vi.fn(),
  startLogStreamMock: vi.fn(),
}));
vi.mock("../lib/workloads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/workloads")>();
  return { ...actual, podLogs: podLogsMock, podsForSelector: podsForSelectorMock };
});
vi.mock("../lib/logsStream", () => ({ startLogStream: startLogStreamMock }));

const { saveTextFileMock } = vi.hoisted(() => ({ saveTextFileMock: vi.fn() }));
vi.mock("../lib/files", () => ({ saveTextFile: saveTextFileMock }));
vi.mock("../lib/manifest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/manifest")>();
  return { ...actual, getObject: getObjectMock };
});

import { LogsView } from "./LogsView";

beforeEach(() => {
  podLogsMock.mockReset();
  getObjectMock.mockReset();
  podsForSelectorMock.mockReset();
  startLogStreamMock.mockReset();
  podLogsMock.mockResolvedValue({ logs: "" });
  getObjectMock.mockResolvedValue({ object: { spec: { containers: [{ name: "app" }] } } });
  podsForSelectorMock.mockResolvedValue({ pods: [] });
  startLogStreamMock.mockResolvedValue({ stop: vi.fn() });
  saveTextFileMock.mockReset();
  saveTextFileMock.mockResolvedValue("/tmp/web-1.log");
});

describe("LogsView", () => {
  it("fetches and renders logs for the pod's container", async () => {
    podLogsMock.mockResolvedValue({ logs: "line one\nline two" });
    render(<LogsView context="kind-dev" namespace="default" source={{ type: "pod", pod: "web-1" }} />);
    await waitFor(() => expect(screen.getByText(/line two/)).toBeDefined());
    await waitFor(() =>
      expect(podLogsMock).toHaveBeenCalledWith("kind-dev", "default", "web-1", undefined, "app", expect.any(Object)),
    );
  });

  it("shows an error and can refresh", async () => {
    podLogsMock.mockResolvedValue({ error: "boom" });
    render(<LogsView context="kind-dev" namespace="default" source={{ type: "pod", pod: "web-1" }} />);
    await waitFor(() => expect(screen.getByText(/boom/)).toBeDefined());
    podLogsMock.mockResolvedValue({ logs: "now ok" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByText(/now ok/)).toBeDefined());
  });

  it("resolves a workload's pods and offers an all-pods selector", async () => {
    getObjectMock.mockImplementation((_ctx: string, kind: string) =>
      kind === "Deployment"
        ? Promise.resolve({ object: { spec: { selector: { matchLabels: { app: "web" } } } } })
        : Promise.resolve({ object: { spec: { containers: [{ name: "app" }] } } }),
    );
    podsForSelectorMock.mockResolvedValue({ pods: [{ name: "web-1" }, { name: "web-2" }] });
    podLogsMock.mockResolvedValue({ logs: "hello" });

    render(
      <LogsView
        context="kind-dev"
        namespace="default"
        source={{ type: "workload", kind: "Deployment", name: "web" }}
      />,
    );

    await waitFor(() =>
      expect(podsForSelectorMock).toHaveBeenCalledWith("kind-dev", "default", { app: "web" }),
    );
    // A pod picker appears with an "all pods" option, and logs are fetched per pod.
    expect(await screen.findByRole("combobox", { name: "Pod" })).toBeDefined();
    await waitFor(() =>
      expect(podLogsMock).toHaveBeenCalledWith("kind-dev", "default", "web-1", undefined, "app", expect.any(Object)),
    );
    await waitFor(() =>
      expect(podLogsMock).toHaveBeenCalledWith("kind-dev", "default", "web-2", undefined, "app", expect.any(Object)),
    );
  });

  it("saves logs to a file on download", async () => {
    podLogsMock.mockResolvedValue({ logs: "line one\nline two" });
    render(<LogsView context="kind-dev" namespace="default" source={{ type: "pod", pod: "web-1" }} />);
    await waitFor(() => expect(screen.getByText("line two")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() =>
      expect(saveTextFileMock).toHaveBeenCalledWith("web-1.log", "line one\nline two"),
    );
  });

  it("filters lines with the search box", async () => {
    podLogsMock.mockResolvedValue({ logs: "alpha line\nbeta line" });
    render(<LogsView context="kind-dev" namespace="default" source={{ type: "pod", pod: "web-1" }} />);
    await waitFor(() => expect(screen.getByText("alpha line")).toBeDefined());

    fireEvent.change(screen.getByLabelText("Search logs"), { target: { value: "beta" } });
    expect(screen.queryByText("alpha line")).toBeNull();
    expect(screen.getByText("beta line")).toBeDefined();
  });

  it("starts a live-tail stream and appends streamed lines", async () => {
    podLogsMock.mockResolvedValue({ logs: "" });
    let emit: ((source: string, line: string) => void) | undefined;
    const stop = vi.fn();
    startLogStreamMock.mockImplementation(async (_c, _n, _t, onLine) => {
      emit = onLine;
      return { stop };
    });
    render(<LogsView context="kind-dev" namespace="default" source={{ type: "pod", pod: "web-1" }} />);
    await waitFor(() => expect(screen.getByLabelText("Live tail")).toBeDefined());

    fireEvent.click(screen.getByLabelText("Live tail"));
    await waitFor(() => expect(startLogStreamMock).toHaveBeenCalled());

    act(() => emit?.("", "streamed line"));
    expect(await screen.findByText("streamed line")).toBeDefined();

    // Toggling off stops the stream.
    fireEvent.click(screen.getByLabelText("Pause live tail"));
    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  it("waits for container discovery before starting live mode", async () => {
    let resolvePod: ((value: unknown) => void) | undefined;
    getObjectMock.mockReturnValue(new Promise((resolve) => { resolvePod = resolve; }));

    render(<LogsView context="kind-dev" namespace="default" source={{ type: "pod", pod: "web-1" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Live tail" }));
    expect(startLogStreamMock).not.toHaveBeenCalled();

    await act(async () => {
      resolvePod?.({ object: { spec: { containers: [{ name: "app" }] } } });
    });
    await waitFor(() =>
      expect(startLogStreamMock).toHaveBeenCalledWith(
        "kind-dev",
        "default",
        [{ pod: "web-1", container: "app", label: "" }],
        expect.any(Function),
        expect.any(Function),
        expect.any(Object),
      ),
    );
  });

  it("scrolls to the newest streamed line while live", async () => {
    let emit: ((source: string, line: string) => void) | undefined;
    startLogStreamMock.mockImplementation(async (_c, _n, _t, onLine) => {
      emit = onLine;
      return { stop: vi.fn() };
    });

    render(<LogsView context="kind-dev" namespace="default" source={{ type: "pod", pod: "web-1" }} />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Container" })).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Live tail" }));
    await waitFor(() => expect(startLogStreamMock).toHaveBeenCalled());

    const viewport = screen.getByRole("log");
    Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 640 });
    act(() => emit?.("", "newest line"));
    expect(viewport.scrollTop).toBe(640);
  });

  it("reports a live-stream startup failure", async () => {
    startLogStreamMock.mockRejectedValue(new Error("stream unavailable"));
    render(<LogsView context="kind-dev" namespace="default" source={{ type: "pod", pod: "web-1" }} />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Container" })).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Live tail" }));
    expect(await screen.findByText(/stream unavailable/)).toBeDefined();
    // The initial fetch may still be in flight on slow runners; the spinner
    // must clear once everything settles, not synchronously with the error.
    await waitFor(() => expect(screen.queryByLabelText("Loading logs")).toBeNull());
  });

  it("offers a container picker for multi-container pods", async () => {
    getObjectMock.mockResolvedValue({
      object: { spec: { containers: [{ name: "app" }, { name: "sidecar" }] } },
    });
    podLogsMock.mockResolvedValue({ logs: "app logs" });
    render(<LogsView context="kind-dev" namespace="default" source={{ type: "pod", pod: "web-1" }} />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Container" })).toBeDefined());

    await userEvent.click(screen.getByRole("combobox", { name: "Container" }));
    await userEvent.click(await screen.findByRole("option", { name: "sidecar" }));
    await waitFor(() =>
      expect(podLogsMock).toHaveBeenCalledWith("kind-dev", "default", "web-1", undefined, "sidecar", expect.any(Object)),
    );
  });
});

describe("log window, timestamps, and previous instance", () => {
  it("decodes window selections", async () => {
    const { windowOptions } = await import("./LogsView");
    expect(windowOptions("tail:1000")).toEqual({ tailLines: 1000 });
    expect(windowOptions("since:3600")).toEqual({ sinceSeconds: 3600 });
    expect(windowOptions("junk:x")).toEqual({ tailLines: 200 });
  });

  it("refetches with the previous-instance flag and disables follow", async () => {
    podLogsMock.mockResolvedValue({ logs: "old instance line" });
    render(
      <LogsView context="kind-dev" namespace="default" source={{ type: "pod", pod: "web-1" }} />,
    );
    await waitFor(() => expect(podLogsMock).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText("Show previous instance"));
    await waitFor(() =>
      expect(podLogsMock).toHaveBeenCalledWith(
        "kind-dev",
        "default",
        "web-1",
        undefined,
        "app",
        expect.objectContaining({ previous: true }),
      ),
    );
    expect(screen.getByText("previous instance")).toBeDefined();
    expect(screen.getByLabelText("Live tail")).toHaveProperty("disabled", true);
  });

  it("passes timestamps through to snapshots", async () => {
    podLogsMock.mockResolvedValue({ logs: "2026-07-09T10:00:00Z hello" });
    render(
      <LogsView context="kind-dev" namespace="default" source={{ type: "pod", pod: "web-1" }} />,
    );
    await waitFor(() => expect(podLogsMock).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText("Show timestamps"));
    await waitFor(() =>
      expect(podLogsMock).toHaveBeenCalledWith(
        "kind-dev",
        "default",
        "web-1",
        undefined,
        "app",
        expect.objectContaining({ timestamps: true }),
      ),
    );
  });
});
