import { describe, it, expect } from "vitest";
import { yamlDiagnostics, k8sDiagnostics } from "./CodeEditor";

describe("yamlDiagnostics", () => {
  it("returns no diagnostics for valid YAML", () => {
    const yaml = "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: my-app\n";
    expect(yamlDiagnostics(yaml)).toHaveLength(0);
  });

  it("returns none for empty/whitespace input", () => {
    expect(yamlDiagnostics("")).toHaveLength(0);
    expect(yamlDiagnostics("   \n  ")).toHaveLength(0);
  });

  it("flags a YAML syntax error with a position and message", () => {
    // Nested mapping in a compact/inline position is invalid YAML.
    const bad = "spec:\n  foo: bar: baz\n";
    const diags = yamlDiagnostics(bad);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].severity).toBe("error");
    expect(diags[0].to).toBeGreaterThan(diags[0].from);
    expect(typeof diags[0].message).toBe("string");
  });

  it("flags an unterminated flow sequence", () => {
    const diags = yamlDiagnostics("ports: [80, 443\n");
    expect(diags.some((d) => d.severity === "error")).toBe(true);
  });
});

const manifest = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: -1
  foo: bar
`;

describe("k8sDiagnostics (server validation → editor positions)", () => {
  it("positions an unknown-field error at that field in the YAML", () => {
    const diags = k8sDiagnostics(manifest, ['strict decoding error: unknown field "spec.foo"']);
    expect(diags).toHaveLength(1);
    // The range should cover the `foo: bar` value, not the top of the doc.
    const at = manifest.indexOf("bar");
    expect(diags[0].from).toBeLessThanOrEqual(at);
    expect(diags[0].to).toBeGreaterThanOrEqual(at);
    expect(diags[0].message).toContain("unknown field");
  });

  it("positions an invalid-value error at the offending field", () => {
    const diags = k8sDiagnostics(manifest, [
      'Deployment.apps "my-app" is invalid: spec.replicas: Invalid value: -1: must be >= 0',
    ]);
    expect(diags).toHaveLength(1);
    const at = manifest.indexOf("-1");
    expect(diags[0].from).toBeLessThanOrEqual(at);
    expect(diags[0].to).toBeGreaterThanOrEqual(at);
  });

  it("falls back to the top of the document when no field can be located", () => {
    const diags = k8sDiagnostics(manifest, ["admission webhook denied the request"]);
    expect(diags).toHaveLength(1);
    expect(diags[0].from).toBe(0);
    expect(diags[0].message).toContain("admission webhook");
  });

  it("returns nothing for no messages or empty text", () => {
    expect(k8sDiagnostics(manifest, [])).toHaveLength(0);
    expect(k8sDiagnostics("", ["some error"])).toHaveLength(0);
  });
});
