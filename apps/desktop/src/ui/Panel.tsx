import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export interface PanelProps {
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * A bordered surface section with an optional title. Local wrapper over shadcn's
 * Card so the app keeps a simple `title`/`children` API.
 */
export function Panel({ title, children, className }: PanelProps) {
  return (
    <Card className={className}>
      {title != null && (
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent>{children}</CardContent>
    </Card>
  );
}
