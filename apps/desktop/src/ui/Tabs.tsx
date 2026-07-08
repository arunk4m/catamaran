import React from "react";
import { Tabs as ShadTabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface TabItem {
  id: string;
  label: string;
}

export interface TabsProps {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
}

/**
 * Horizontal tab strip for switching views. Local wrapper over shadcn's Tabs
 * (the underline `line` variant). The app keeps the simple `tabs`/`active`/
 * `onChange` API; panels are rendered by callers, so this only owns the list.
 */
export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <ShadTabs value={active} onValueChange={onChange}>
      <TabsList variant="line" className="cat-tabs">
        {tabs.map((t) => (
          <TabsTrigger key={t.id} value={t.id} className="cat-tab">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </ShadTabs>
  );
}
