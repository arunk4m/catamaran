import React from "react";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

export interface IconButtonProps {
  icon: LucideIcon;
  /** Accessible name + tooltip (e.g. "Logs", "Delete"). */
  label: string;
  onClick?: () => void;
  /** Tints the icon with the danger colour (e.g. Delete). */
  danger?: boolean;
  /** Toggle-style buttons: render pressed with the accent colour. */
  active?: boolean;
  disabled?: boolean;
}

/**
 * A compact icon-only button (shadcn Button, ghost). The label is both the
 * accessible name and the hover tooltip, so the icon never stands alone.
 * With `active` it behaves as a toggle (aria-pressed + accent tint).
 */
export function IconButton({ icon, label, onClick, danger, active, disabled }: IconButtonProps) {
  const Icon = icon;
  const tint = danger
    ? "text-destructive hover:text-destructive"
    : active
      ? "text-primary bg-accent hover:text-primary"
      : undefined;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={tint}
    >
      <Icon aria-hidden="true" />
    </Button>
  );
}
