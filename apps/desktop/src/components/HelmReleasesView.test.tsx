import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const { listHelmReleasesMock, getHelmReleaseMock } = vi.hoisted(() => ({
  listHelmReleasesMock: vi.fn(),
  getHelmReleaseMock: vi.fn(),
}));
vi.mock("../lib/helm", () => ({
  listHelmReleases: listHelmReleasesMock,
  getHelmRelease: getHelmReleaseMock,
}));
// CodeMirror needs real layout; stand in a textarea.
vi.mock("../ui/CodeEditor", () => ({
  CodeEditor: ({ value, ariaLabel }: { value: string; ariaLabel?: string }) => (
    <textarea aria-label={ariaLabel} value={value} readOnly />
  ),
}));

import { HelmReleasesView } from "./HelmReleasesView";

const release = {
  name: "redis",
  namespace: "cache",
  revision: 2,
  status: "deployed",
  chart: "redis",
  chartVersion: "19.0.1",
  appVersion: "7.2.4",
  updated: "2026-07-01T00:00:00Z",
};

beforeEach(() => {
  listHelmReleasesMock.mockReset();
  getHelmReleaseMock.mockReset();
  listHelmReleasesMock.mockResolvedValue({ releases: [release] });
  getHelmReleaseMock.mockResolvedValue({
    release: {
      ...release,
      valuesYaml: "replicas: 1\n",
      manifest: "kind: Service\n",
      notes: "",
      history: [{ revision: 2, status: "deployed", updated: "", chartVersion: "19.0.1", description: "Upgrade complete" }],
    },
  });
});

describe("HelmReleasesView", () => {
  it("lists releases and opens values/manifest/history detail", async () => {
    render(<HelmReleasesView context="kind-dev" />);
    await waitFor(() => expect(screen.getByText("redis")).toBeDefined());
    expect(screen.getByText("redis-19.0.1")).toBeDefined();

    fireEvent.click(screen.getByText("redis"));

    // Values tab (default) shows the user values.
    await waitFor(() =>
      expect((screen.getByLabelText("Release values") as HTMLTextAreaElement).value).toContain(
        "replicas: 1",
      ),
    );
    expect(getHelmReleaseMock).toHaveBeenCalledWith("kind-dev", "cache", "redis");

    // Manifest tab.
    await userEvent.click(screen.getByRole("tab", { name: "Manifest" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Release manifest") as HTMLTextAreaElement).value).toContain(
        "kind: Service",
      ),
    );

    // History tab.
    await userEvent.click(screen.getByRole("tab", { name: /History/ }));
    expect(await screen.findByText("Upgrade complete")).toBeDefined();
  });

  it("shows an empty state when no releases", async () => {
    listHelmReleasesMock.mockResolvedValue({ releases: [] });
    render(<HelmReleasesView context="kind-dev" />);
    await waitFor(() => expect(screen.getByText(/No Helm releases/)).toBeDefined());
  });
});
