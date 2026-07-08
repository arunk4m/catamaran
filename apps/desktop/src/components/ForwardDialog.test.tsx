import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const { startPortForwardMock } = vi.hoisted(() => ({ startPortForwardMock: vi.fn() }));
vi.mock("../lib/forward", () => ({ startPortForward: startPortForwardMock }));

import { ForwardDialog } from "./ForwardDialog";

beforeEach(() => startPortForwardMock.mockReset());

const base = { context: "kind-dev", namespace: "default", kind: "Pod", name: "web-1" };

describe("ForwardDialog", () => {
  it("starts a forward with the entered remote port", async () => {
    startPortForwardMock.mockResolvedValue({ id: 1, localPort: 5000 });
    const onClose = vi.fn();
    render(<ForwardDialog {...base} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("Remote port"), { target: { value: "8080" } });
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));

    await waitFor(() =>
      expect(startPortForwardMock).toHaveBeenCalledWith({
        context: "kind-dev",
        namespace: "default",
        kind: "Pod",
        name: "web-1",
        remotePort: 8080,
        localPort: undefined,
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("passes an explicit local port when provided", async () => {
    startPortForwardMock.mockResolvedValue({ id: 1, localPort: 3000 });
    render(<ForwardDialog {...base} defaultRemotePort={80} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Local port"), { target: { value: "3000" } });
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));

    await waitFor(() =>
      expect(startPortForwardMock).toHaveBeenCalledWith(
        expect.objectContaining({ remotePort: 80, localPort: 3000 }),
      ),
    );
  });

  it("rejects an out-of-range port without calling the backend", () => {
    render(<ForwardDialog {...base} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Remote port"), { target: { value: "99999" } });
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));

    expect(screen.getByText(/between 1 and 65535/)).toBeDefined();
    expect(startPortForwardMock).not.toHaveBeenCalled();
  });
});
