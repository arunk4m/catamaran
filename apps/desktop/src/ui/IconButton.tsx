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
  disabled?: boolean;
}

/**
 * A compact icon-only button (shadcn Button, ghost). The label is both the
 * accessible name and the hover tooltip, so the icon never stands alone.
 */
export function IconButton({ icon, label, onClick, danger, disabled }: IconButtonProps) {
  const Icon = icon;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={danger ? "text-destructive hover:text-destructive" : undefined}
    >
      <Icon aria-hidden="true" />
    </Button>
  );
}
