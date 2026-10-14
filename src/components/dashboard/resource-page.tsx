import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "./dashboard-shell";
import { ResourceView } from "./resource-view";
import { RESOURCES } from "@/lib/endpoints";
import { cn } from "@/lib/utils";
import { stripEndpoint } from "@/lib/format";
import { useAuth, isClientAdmin } from "@/lib/use-auth";

export function ResourcePage({ resourceKey }: { resourceKey: string }) {
  const resource = RESOURCES[resourceKey];
  return (
    <DashboardShell title={resource.title} subtitle={stripEndpoint(resource.description)}>
      <ResourceView resource={resource} />
    </DashboardShell>
  );
}

export function TabbedResourcePage({
  title,
  subtitle,
  resourceKeys,
}: {
  title: string;
  subtitle: string;
  resourceKeys: string[];
}) {
  const { user } = useAuth();

  // Hide global (non-clientScoped) resource tabs for client-admin accounts.
  const visibleKeys = useMemo(() => {
    const clientAdmin = isClientAdmin(user);
    return resourceKeys.filter((k) => {
      const res = RESOURCES[k];
      if (!res) return false;
      if (!clientAdmin) return true;
      return k === "partner-bets" ? false : Boolean(res.clientScoped);
    });
  }, [resourceKeys, user]);

  const [active, setActive] = useState<string | null>(visibleKeys[0] ?? null);
  const resource = active ? RESOURCES[active] : null;

  useEffect(() => {
    if (!active || !visibleKeys.includes(active)) {
      setActive(visibleKeys[0] ?? null);
    }
  }, [visibleKeys, active]);

  return (
    <DashboardShell title={title} subtitle={subtitle}>
      {visibleKeys.length > 1 ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {visibleKeys.map((key) => {
            const res = RESOURCES[key];
            if (!res) return null;
            const isActive = active === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActive(key)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                  isActive
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {res.title}
              </button>
            );
          })}
        </div>
      ) : null}

      {resource ? (
        <>
          <p className="num mb-4 text-xs text-muted-foreground">{stripEndpoint(resource.description)}</p>
          <ResourceView resource={resource} />
        </>
      ) : (
        <p className="num mb-4 text-xs text-muted-foreground">No resources available</p>
      )}
    </DashboardShell>
  );
}
