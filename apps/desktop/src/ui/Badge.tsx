import React from "react";
import { Badge as ShadBadge } from "@/components/ui/badge";

export type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "info";

// Our semantic variants → shadcn Badge variants (success/warning/info added locally).
const VARIANT: Record<BadgeVariant, "secondary" | "success" | "warning" | "destructive" | "info"> = {
  neutral: "secondary",
  success: "success",
  warning: "warning",
  danger: "destructive",
  info: "info",
};

export interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
}

/**
 * Small status pill. Local wrapper over shadcn's Badge — variant carries
 * semantic colour, not domain meaning.
 */
export function Badge({ children, variant = "neutral" }: BadgeProps) {
  return <ShadBadge variant={VARIANT[variant]}>{children}</ShadBadge>;
}
