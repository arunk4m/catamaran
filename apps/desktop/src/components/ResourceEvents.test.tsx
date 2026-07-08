import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { ResourceEvents } from "./ResourceEvents";

const events = [
  { type: "Warning", reason: "BackOff", object: "Pod/web-1", message: "restarting", age: "2m" },
  { type: "Normal", reason: "Pulled", object: "other-9", message: "pulled image", age: "5m" },
  { type: "Normal", reason: "Scheduled", object: "Pod/web-1", message: "assigned", age: "6m" },
  { type: "Warning", reason: "Collision", object: "Service/web-1", message: "same name", age: "1m" },
];

describe("ResourceEvents", () => {
  it("shows only events involving the object", async () => {
    const listEventsFn = vi.fn().mockResolvedValue({ events });
    render(
      <ResourceEvents
        context="kind-dev"
        namespace="default"
        objectKind="Pod"
        objectName="web-1"
        listEventsFn={listEventsFn}
      />,
    );
    await waitFor(() => expect(screen.getByText("BackOff")).toBeDefined());
    expect(screen.getByText("Scheduled")).toBeDefined(); // matched "Pod/web-1"
    expect(screen.queryByText("Pulled")).toBeNull(); // other object filtered out
    expect(screen.queryByText("Collision")).toBeNull(); // same name, different kind
    expect(listEventsFn).toHaveBeenCalledWith("kind-dev", "default", {
      kind: "Pod",
      name: "web-1",
    });
  });

  it("shows an empty message when no events involve the object", async () => {
    const listEventsFn = vi.fn().mockResolvedValue({ events: [] });
    render(
      <ResourceEvents
        context="kind-dev"
        namespace="default"
        objectKind="Pod"
        objectName="web-1"
        listEventsFn={listEventsFn}
      />,
    );
    await waitFor(() => expect(screen.getByText("No events for this object")).toBeDefined());
  });
});
