import { describe, it, expect } from "vitest";
import { fuzzyScore, frecencyBoost, rankItems, NO_MATCH } from "./paletteRank";

describe("fuzzyScore", () => {
  it("rejects non-subsequences and accepts subsequences", () => {
    expect(fuzzyScore("xyz", "Deployments")).toBe(NO_MATCH);
    expect(fuzzyScore("dpl", "Deployments")).not.toBe(NO_MATCH);
  });

  it("ranks prefix matches above substring matches", () => {
    expect(fuzzyScore("ser", "Services")).toBeGreaterThan(fuzzyScore("ser", "Users"));
  });

  it("ranks word-boundary matches above scattered ones", () => {
    // "sa" hits the two word starts of "Service Accounts".
    expect(fuzzyScore("sa", "Service Accounts")).toBeGreaterThan(fuzzyScore("sa", "Sandcastles"));
  });

  it("prefers consecutive runs over gaps", () => {
    expect(fuzzyScore("pod", "Pods")).toBeGreaterThan(fuzzyScore("pod", "Port Forwards"));
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(fuzzyScore("  PODS ", "pods")).toBeGreaterThan(0);
  });

  it("gives an empty query a neutral score", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });
});

describe("frecencyBoost", () => {
  it("boosts recent items, decaying with age, and ignores unknown ids", () => {
    const recents = ["a", "b", "c"];
    expect(frecencyBoost("a", recents)).toBeGreaterThan(frecencyBoost("b", recents));
    expect(frecencyBoost("b", recents)).toBeGreaterThan(frecencyBoost("c", recents));
    expect(frecencyBoost("zzz", recents)).toBe(0);
  });
});

describe("rankItems", () => {
  const items = [
    { id: "k:pods", label: "Pods" },
    { id: "k:portforwards", label: "Port Forwards" },
    { id: "k:poddisruptionbudgets", label: "Pod Disruption Budgets" },
  ];

  it("drops non-matches and orders by score", () => {
    const ranked = rankItems(items, "pod", (i) => i.label, (i) => i.id);
    expect(ranked.map((i) => i.label)).toEqual(["Pods", "Pod Disruption Budgets", "Port Forwards"]);
  });

  it("floats a recently-used item over an equal match", () => {
    const twins = [
      { id: "a", label: "Rollouts A" },
      { id: "b", label: "Rollouts B" },
    ];
    const plain = rankItems(twins, "roll", (i) => i.label, (i) => i.id);
    expect(plain.map((i) => i.id)).toEqual(["a", "b"]); // stable: input order on ties
    const boosted = rankItems(twins, "roll", (i) => i.label, (i) => i.id, ["b"]);
    expect(boosted.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("returns everything (frecency-first) for an empty query", () => {
    const ranked = rankItems(items, "", (i) => i.label, (i) => i.id, ["k:portforwards"]);
    expect(ranked).toHaveLength(3);
    expect(ranked[0].id).toBe("k:portforwards");
  });
});
