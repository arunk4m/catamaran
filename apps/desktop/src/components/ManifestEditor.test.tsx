import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React, { useState } from "react";

const { applyManifestMock, notifyMock } = vi.hoisted(() => ({
  applyManifestMock: vi.fn(),
  notifyMock: { success: vi.fn(), error: vi.fn(), info: vi.fn(), updateAvailable: vi.fn() },
}));
vi.mock("../lib/manifest", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/manifest")>()),
  applyManifest: applyManifestMock,
  validateManifest: vi.fn().mockResolvedValue({ valid: true }),
}));
vi.mock("../lib/notify", () => ({ notify: notifyMock }));
vi.mock("../lib/schema", () => ({ openApiSchema: vi.fn().mockResolvedValue({ error: "n/a" }) }));
vi.mock("../ui/CodeEditor", () => ({
  CodeEditor: ({ value, onChange, ariaLabel }: { value: string; onChange?: (v: string) => void; ariaLabel?: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange?.(e.target.value)} />
  ),
}));

import { ManifestEditor } from "./ManifestEditor";

function Harness({ mode }: { mode: "create" | "edit" }) {
  const [yaml, setYaml] = useState("kind: ConfigMap\nmetadata:\n  name: web\n");
  return (
    <ManifestEditor
      context="kind-dev"
      yaml={yaml}
      onYamlChange={setYaml}
      applyLabel={mode === "create" ? "Create" : "Apply"}
      confirm={mode === "edit" ? { kind: "ConfigMap", name: "web" } : undefined}
    />
  );
}

beforeEach(() => {
  applyManifestMock.mockReset();
  notifyMock.success.mockReset();
  notifyMock.error.mockReset();
});

describe("ManifestEditor", () => {
  it("create mode applies immediately (no confirm) and toasts success", async () => {
    applyManifestMock.mockResolvedValue({ kind: "ConfigMap", name: "web" });
    render(<Harness mode="create" />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(applyManifestMock).toHaveBeenCalledWith("kind-dev", expect.stringContaining("ConfigMap")));
    expect(notifyMock.success).toHaveBeenCalled();
  });

  it("edit mode confirms before applying", async () => {
    applyManifestMock.mockResolvedValue({ kind: "ConfigMap", name: "web" });
    render(<Harness mode="edit" />);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    // Apply doesn't fire until the confirm dialog is accepted.
    expect(applyManifestMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Apply manifest?")).toBeDefined());
    // Two "Apply" buttons now (header + dialog); the dialog's is last.
    fireEvent.click(screen.getAllByRole("button", { name: "Apply" }).at(-1)!);
    await waitFor(() => expect(applyManifestMock).toHaveBeenCalled());
    expect(notifyMock.success).toHaveBeenCalled();
  });

  it("toasts an error when apply fails", async () => {
    applyManifestMock.mockResolvedValue({ error: "conflict" });
    render(<Harness mode="create" />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(notifyMock.error).toHaveBeenCalled());
  });
});
