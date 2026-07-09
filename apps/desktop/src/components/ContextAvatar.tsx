import React, { useEffect, useState } from "react";
import { Boxes, Cloud, Database, Globe2, Server, Shield } from "lucide-react";
import { avatarColor, avatarInitials } from "../ui";
import type { ContextLogo, ContextProfile } from "../lib/settings";

const LOGOS: Record<Exclude<ContextLogo, "initials" | "custom">, React.ElementType> = {
  cluster: Boxes,
  cloud: Cloud,
  shield: Shield,
  database: Database,
  globe: Globe2,
};

export const CONTEXT_LOGO_OPTIONS: Array<{ value: ContextLogo; label: string }> = [
  { value: "initials", label: "Initials" },
  { value: "cluster", label: "Cluster" },
  { value: "cloud", label: "Cloud" },
  { value: "shield", label: "Shield" },
  { value: "database", label: "Database" },
  { value: "globe", label: "Globe" },
  { value: "custom", label: "Custom" },
];

function safeImageSource(value?: string): string | null {
  const source = value?.trim();
  if (!source) return null;
  if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(source)) return source;
  if (/^https?:\/\//i.test(source)) return source;
  return null;
}

export function ContextAvatar({
  context,
  profile,
  className = "cat-avatar",
  showShortName = true,
}: {
  context: string;
  profile?: ContextProfile;
  className?: string;
  showShortName?: boolean;
}) {
  const logo = profile?.logo ?? "initials";
  const source = logo === "custom" ? safeImageSource(profile?.logoUrl) : null;
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [source]);
  const Icon = logo === "initials" || logo === "custom" ? null : LOGOS[logo] ?? Server;
  const shortName = profile?.shortName?.trim().slice(0, 3).toUpperCase() ?? "";
  const label = shortName || avatarInitials(context);
  const showBadge = showShortName && logo !== "initials" && !!shortName;
  // The context colour flows through a CSS variable so the design system can
  // render soft-tint circles (background at low alpha, glyph in full colour).
  const contextColor = profile?.color || avatarColor(context);
  return (
    <span
      className={`${className}${showBadge ? " cat-context-avatar--has-short" : ""}`}
      style={{ "--ctx-color": contextColor } as React.CSSProperties}
      aria-hidden="true"
    >
      {source && !imageFailed ? (
        <img
          className="cat-context-avatar__image"
          src={source}
          alt=""
          onError={() => setImageFailed(true)}
        />
      ) : Icon ? <Icon /> : label}
      {showBadge && <span className="cat-context-avatar__short">{shortName}</span>}
    </span>
  );
}
