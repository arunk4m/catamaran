import { describe, expect, it } from "vitest";
import { cleanErrorMessage, describeError } from "./errors";

describe("cleanErrorMessage", () => {
  it("strips the internal handler-error prefix", () => {
    expect(cleanErrorMessage("handler error: list namespaces timed out")).toBe(
      "list namespaces timed out",
    );
  });

  it("reads the message off an Error instance", () => {
    expect(cleanErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("coerces non-string, non-Error values safely", () => {
    expect(cleanErrorMessage(null)).toBe("");
    expect(cleanErrorMessage(undefined)).toBe("");
    expect(cleanErrorMessage(42)).toBe("42");
  });
});

describe("describeError", () => {
  it("classifies a connection timeout and never leaks the handler prefix", () => {
    const result = describeError("handler error: list namespaces timed out");
    expect(result.title).toBe("Can't reach the cluster");
    expect(result.detail).toMatch(/didn't respond in time/);
    expect(result.detail).not.toMatch(/handler error/);
    expect(result.raw).toBe("list namespaces timed out");
  });

  it("classifies a refused connection", () => {
    expect(describeError("tcp connect error: connection refused").title).toBe(
      "Can't reach the cluster",
    );
  });

  it("classifies an unresolved host", () => {
    expect(describeError("failed to lookup address information: no such host").title).toBe(
      "Cluster address not found",
    );
  });

  it("classifies auth failures distinctly", () => {
    expect(describeError("Unauthorized").title).toBe("Not authorized");
    expect(describeError("forbidden: pods is forbidden").title).toBe("Access denied");
  });

  it("classifies TLS/certificate failures", () => {
    expect(describeError("x509: certificate signed by unknown authority").title).toBe(
      "Couldn't verify the cluster",
    );
  });

  it("falls back to the cleaned message for unrecognized errors", () => {
    const result = describeError("handler error: something weird happened");
    expect(result.title).toBe("Something went wrong");
    expect(result.detail).toBe("something weird happened");
  });

  it("gives a stable message when there is nothing to show", () => {
    expect(describeError("").detail).toBe("An unexpected error occurred.");
  });
});
