import React from "react";
import {
  Activity,
  ArrowLeftRight,
  BellRing,
  Box,
  Boxes,
  BriefcaseBusiness,
  Bug,
  Circle,
  Clock3,
  Cloud,
  Copy,
  Cpu,
  Database,
  FileCog,
  FilePlus2,
  FolderTree,
  Gauge,
  GitBranch,
  HardDrive,
  History,
  KeyRound,
  Layers3,
  LayoutDashboard,
  LineChart,
  ListOrdered,
  Network,
  Radio,
  RadioTower,
  Route,
  Scaling,
  ScanEye,
  Server,
  ServerCog,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  ShipWheel,
  Signpost,
  SlidersHorizontal,
  Telescope,
  TimerReset,
  UserRoundCheck,
  UserRoundCog,
  Webhook,
  Wind,
  Workflow,
  type LucideIcon,
} from "lucide-react";

const RESOURCE_ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  nodes: Server,
  namespaces: FolderTree,
  events: BellRing,
  pods: Box,
  deployments: Layers3,
  statefulsets: Database,
  daemonsets: ServerCog,
  replicasets: Copy,
  jobs: BriefcaseBusiness,
  cronjobs: Clock3,
  configmaps: FileCog,
  secrets: KeyRound,
  resourcequotas: Gauge,
  limitranges: SlidersHorizontal,
  horizontalpodautoscalers: Scaling,
  poddisruptionbudgets: ShieldCheck,
  priorityclasses: ListOrdered,
  runtimeclasses: Cpu,
  leases: TimerReset,
  mutatingwebhookconfigurations: Webhook,
  validatingwebhookconfigurations: Webhook,
  services: Network,
  endpoints: RadioTower,
  endpointslices: GitBranch,
  ingresses: Route,
  ingressclasses: Signpost,
  networkpolicies: Shield,
  portforwards: ArrowLeftRight,
  persistentvolumeclaims: HardDrive,
  persistentvolumes: Database,
  storageclasses: Layers3,
  serviceaccounts: UserRoundCog,
  clusterroles: Shield,
  roles: ShieldCheck,
  clusterrolebindings: UserRoundCheck,
  rolebindings: UserRoundCheck,
  helmreleases: ShipWheel,
  settings: Settings,
  newresource: FilePlus2,
  spyglass: Telescope,
};

/**
 * lucide components for the observability icon picker, keyed by the names in
 * `SPYGLASS_ICON_CHOICES` (lib/settings.ts). Used for per-tool icons in the
 * launcher, palette, tabs and the custom-tool icon selector.
 */
export const SPYGLASS_ICON: Record<string, LucideIcon> = {
  telescope: Telescope,
  "share-2": Share2,
  gauge: Gauge,
  wind: Wind,
  radio: Radio,
  history: History,
  "scan-eye": ScanEye,
  activity: Activity,
  "line-chart": LineChart,
  database: Database,
  boxes: Boxes,
  network: Network,
  workflow: Workflow,
  bug: Bug,
  shield: Shield,
  cloud: Cloud,
  server: Server,
  "layout-dashboard": LayoutDashboard,
};

/** The lucide component for a spyglass icon name (telescope fallback). */
export function spyglassIcon(name: string): LucideIcon {
  return SPYGLASS_ICON[name] ?? Telescope;
}

export function iconForResourceKind(kind: string): LucideIcon {
  return RESOURCE_ICONS[kind] ?? Circle;
}

/** Small monochrome Lucide icon for a resource navigation item. */
export function NavIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon className="cat-nav__icon" aria-hidden="true" />;
}
