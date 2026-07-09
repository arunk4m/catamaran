import { describe, it, expect, vi } from "vitest";
import { ssoProfiles, ssoLogin, openExternalUrl, profileForContext } from "./aws";

describe("aws sso capabilities", () => {
  it("lists pinned profiles", async () => {
    const invoke = vi.fn().mockResolvedValue({
      profiles: [{ profile: "tusk-dev", contexts: ["dev-eks"] }],
    });
    const out = await ssoProfiles(["/tmp/extra"], invoke);
    expect(invoke).toHaveBeenCalledWith("aws.ssoProfiles", { paths: ["/tmp/extra"] });
    expect(out.profiles?.[0].profile).toBe("tusk-dev");
  });

  it("runs an SSO login and surfaces failures as outcomes", async () => {
    const ok = vi.fn().mockResolvedValue({ ok: true });
    expect(await ssoLogin("tusk-dev", ok)).toEqual({ ok: true });
    expect(ok).toHaveBeenCalledWith("aws.ssoLogin", { profile: "tusk-dev" });

    const bad = vi.fn().mockRejectedValue(new Error("Token has expired"));
    expect((await ssoLogin("tusk-dev", bad)).error).toContain("expired");
  });

  it("opens external URLs through the capability", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    await openExternalUrl("https://deepinsightai.awsapps.com/start/#/", invoke);
    expect(invoke).toHaveBeenCalledWith("system.openUrl", {
      url: "https://deepinsightai.awsapps.com/start/#/",
    });
  });
});

describe("profileForContext", () => {
  const profiles = [
    { profile: "tusk-dev", contexts: ["dev-eks", "tusk-dev"] },
    { profile: "tusk-prod", contexts: ["prod-eks"] },
  ];

  it("prefers the focused context's own profile", () => {
    expect(profileForContext(profiles, "prod-eks")).toBe("tusk-prod");
  });

  it("falls back to the first profile for unknown or missing contexts", () => {
    expect(profileForContext(profiles, "kind-local")).toBe("tusk-dev");
    expect(profileForContext(profiles, null)).toBe("tusk-dev");
  });

  it("returns null when nothing is pinned", () => {
    expect(profileForContext([], "dev-eks")).toBeNull();
  });
});
