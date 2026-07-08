import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// Stub the three tab bodies so we test only the tab switching here.
vi.mock("./ResourceOverview", () => ({
  ResourceOverview: () => <div data-testid="overview" />,
}));
vi.mock("./YamlView", () => ({ YamlView: () => <div data-testid="yaml" /> }));
vi.mock("./ResourceEvents", () => ({ ResourceEvents: () => <div data-testid="events" /> }));

import { ResourceDetail } from "./ResourceDetail";

describe("ResourceDetail", () => {
  it("defaults to the Overview tab", () => {
    render(
      <ResourceDetail context="kind-dev" kind="Deployment" namespace="default" name="web" />,
    );
    expect(screen.getByTestId("overview")).toBeDefined();
    expect(screen.queryByTestId("yaml")).toBeNull();
  });

  it("switches to the YAML and Events tabs", async () => {
    render(
      <ResourceDetail context="kind-dev" kind="Deployment" namespace="default" name="web" />,
    );
    await userEvent.click(screen.getByRole("tab", { name: "YAML" }));
    expect(screen.getByTestId("yaml")).toBeDefined();
    expect(screen.queryByTestId("overview")).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: "Events" }));
    expect(screen.getByTestId("events")).toBeDefined();
  });
});
