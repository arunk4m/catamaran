import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, Columns2, Layers3, Search, Settings, SquareTerminal } from "lucide-react";
import catamaranMark from "../assets/catamaran-mark.svg";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { listContexts, type ClusterContext } from "../lib/clusters";
import { ContextAvatar } from "./ContextAvatar";
import { contextDisplayName, orderContexts, type ContextProfiles } from "../lib/settings";

const EMPTY_LIST: string[] = [];

const workflowItems = [
  {
    icon: Layers3,
    title: "Discover",
    description: "Move through workloads, networking, storage, and access control without changing tools.",
  },
  {
    icon: Columns2,
    title: "Compare",
    description: "Split the deck into two panes — prod beside staging, or two pods' live logs side by side.",
  },
  {
    icon: SquareTerminal,
    title: "Operate",
    description: "Keep logs, shells, forwards, and edits beside the resource that started the task.",
  },
];

export function LandingPage({
  onOpenContext,
  onOpenSettings,
  contextProfiles = {},
  kubeconfigFiles = EMPTY_LIST,
  contextOrder = EMPTY_LIST,
}: {
  onOpenContext: (context: string) => void;
  onOpenSettings: () => void;
  contextProfiles?: ContextProfiles;
  kubeconfigFiles?: string[];
  contextOrder?: string[];
}) {
  const [contexts, setContexts] = useState<ClusterContext[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    void listContexts(kubeconfigFiles).then((outcome) => {
      if (!active) return;
      setContexts(orderContexts(outcome.contexts ?? [], contextOrder));
      setError(outcome.error ?? "");
    });
    return () => {
      active = false;
    };
  }, [contextOrder, kubeconfigFiles]);

  const currentContext = contexts?.find((context) => context.isCurrent) ?? contexts?.[0] ?? null;
  const filteredContexts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return contexts ?? [];
    return (contexts ?? []).filter((context) =>
      [context.name, contextDisplayName(context.name, contextProfiles[context.name]), context.cluster, context.server]
        .some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [contextProfiles, contexts, query]);

  const contextCount = contexts?.length ?? 0;

  return (
    <div className="cat-landing">
      <div className="cat-landing__frame">
        <header className="cat-landing__masthead">
          <div className="cat-landing__brand">
            <span className="cat-landing__brand-mark" aria-hidden="true">
              <img src={catamaranMark} alt="" />
            </span>
            <span>
              <strong>Catamaran</strong>
              <small>Twin-hull Kubernetes workspace</small>
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={onOpenSettings} aria-label="Workspace preferences">
            <Settings data-icon="inline-start" />
            Preferences
          </Button>
        </header>

        <main className="cat-landing__workspace">
          <section className="cat-landing__intro" aria-labelledby="landing-title">
            <Badge variant="outline">Local kubeconfig</Badge>
            <div className="cat-landing__copy">
              <p className="cat-landing__eyebrow">Ready when you are</p>
              <h1 id="landing-title">
                Two clusters.
                <span>One deck.</span>
              </h1>
              <p>
                A pure-Rust Kubernetes workspace with a split-screen deck — compare environments,
                tail two pods at once, and operate safely in context.
              </p>
            </div>

            <Card className="cat-landing__current-card" size="sm">
              <CardHeader>
                <CardTitle>Current context</CardTitle>
                <CardDescription>Continue from your active kubeconfig context.</CardDescription>
                {currentContext && (
                  <CardAction>
                    <Badge variant="secondary">Current</Badge>
                  </CardAction>
                )}
              </CardHeader>
              <CardContent>
                {currentContext ? (
                  <div className="cat-landing__current-context">
                    <ContextAvatar
                      context={currentContext.name}
                      profile={contextProfiles[currentContext.name]}
                      className="cat-landing__context-glyph"
                    />
                    <span>
                      <strong>{contextDisplayName(currentContext.name, contextProfiles[currentContext.name])}</strong>
                      <small>{currentContext.cluster}</small>
                    </span>
                  </div>
                ) : (
                  <p className="cat-landing__empty">No kube context is currently available.</p>
                )}
              </CardContent>
              <CardFooter className="cat-landing__current-footer">
                <Button
                  onClick={() => currentContext && onOpenContext(currentContext.name)}
                  disabled={!currentContext}
                  aria-label={`Open current context ${currentContext?.name ?? "cluster"}`}
                >
                  Open workspace
                  <ArrowRight data-icon="inline-end" />
                </Button>
                {currentContext?.server && <code>{currentContext.server}</code>}
              </CardFooter>
            </Card>
          </section>

          <Card className="cat-landing__contexts" aria-label="Available contexts">
            <CardHeader>
              <CardTitle>Contexts</CardTitle>
              <CardDescription>Select any context from your local kubeconfig.</CardDescription>
              <CardAction>
                <Badge variant="outline">
                  {contextCount} {contextCount === 1 ? "context" : "contexts"}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="cat-landing__contexts-content">
              <InputGroup>
                <InputGroupAddon>
                  <Search />
                </InputGroupAddon>
                <InputGroupInput
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter contexts"
                  aria-label="Filter contexts"
                />
              </InputGroup>

              <div className="cat-landing__context-list">
                {contexts === null ? (
                  <p className="cat-landing__empty">Reading kubeconfig…</p>
                ) : error ? (
                  <p className="cat-landing__empty">Unable to load kube contexts.</p>
                ) : filteredContexts.length > 0 ? (
                  filteredContexts.map((context) => (
                    <button
                      key={context.name}
                      type="button"
                      className="cat-landing__context-row"
                      onClick={() => onOpenContext(context.name)}
                      aria-label={`Open context ${context.name}`}
                    >
                      <span className="cat-landing__context-main">
                        <ContextAvatar
                          context={context.name}
                          profile={contextProfiles[context.name]}
                          className="cat-landing__context-list-avatar"
                        />
                        <span>
                          <strong>{contextDisplayName(context.name, contextProfiles[context.name])}</strong>
                          <small>{context.cluster}</small>
                        </span>
                      </span>
                      <span className="cat-landing__context-action" aria-hidden="true">
                        {context.isCurrent && <small>Current</small>}
                        <ArrowRight />
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="cat-landing__empty">No contexts match this filter.</p>
                )}
              </div>
            </CardContent>
            <CardFooter className="cat-landing__contexts-footer">
              <span>{filteredContexts.length} shown</span>
              <span>Source: local kubeconfig</span>
            </CardFooter>
          </Card>
        </main>

        <section className="cat-landing__capabilities" aria-labelledby="capabilities-title">
          <div className="cat-landing__section-heading">
            <p>Designed for operations</p>
            <h2 id="capabilities-title">Stay with the resource from signal to action.</h2>
          </div>
          <div className="cat-landing__capability-grid">
            {workflowItems.map(({ icon: Icon, title, description }) => (
              <Card key={title} className="cat-landing__capability" size="sm">
                <CardHeader>
                  <span className="cat-landing__capability-icon" aria-hidden="true">
                    <Icon />
                  </span>
                  <CardTitle>{title}</CardTitle>
                  <CardDescription>{description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
