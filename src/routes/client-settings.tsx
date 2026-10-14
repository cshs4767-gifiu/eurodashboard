import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ACTIONS } from "@/lib/actions";
import { COUNTRY_OPTIONS } from "@/lib/utils/countries";
import { apiRequest, type Dict } from "@/lib/api";
import { useAuth, useClientScope } from "@/lib/use-auth";

const CLIENT_SETTINGS_ACTION = ACTIONS.clients?.find((action) => action.key === "client-settings");

const EMPTY_FORM = {
  name: "",
  email: "",
  location_address: "",
  country: "",
  default_currency: "KES",
  currency_list: "",
  callback_version: "v2",
  callback_url: "",
  home_url: "",
  topup_url: "",
  login_url: "",
  url_type: "1",
};

type ClientSettingsForm = typeof EMPTY_FORM;

function normalizeClientSettings(row?: Dict): ClientSettingsForm {
  const next: ClientSettingsForm = { ...EMPTY_FORM };
  if (!row || typeof row !== "object") return next;

  const fallback = row.settings && typeof row.settings === "object" ? (row.settings as Dict) : undefined;
  const source = fallback && Object.keys(fallback).length > 0 ? fallback : row;

  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null || value === "") continue;
    if (key in next) {
      if (key === "currency_list") {
        const pair = Array.isArray(value)
          ? value.map((v) => String(v)).join(",")
          : typeof value === "string"
            ? value
            : JSON.stringify(value);
        next[key] = pair.replace(/\s+/g, "");
      } else if (key === "url_type") {
        next[key] = String(value);
      } else {
        next[key as keyof ClientSettingsForm] = String(value);
      }
    }
  }

  return next;
}

function toRequestBody(values: ClientSettingsForm): Dict {
  const body: Dict = {};
  for (const [key, raw] of Object.entries(values)) {
    const value = typeof raw === "string" ? raw.trim() : raw;
    if (value === "" || value === null || value === undefined) continue;

    if (key === "currency_list") {
      const normalized = String(value)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .join(",");
      if (normalized) body[key] = normalized;
      continue;
    }

    if (key === "url_type") {
      const parsed = Number.parseInt(String(value), 10);
      if (!Number.isNaN(parsed)) body[key] = parsed;
      continue;
    }

    body[key] = value;
  }
  return body;
}

export const Route = createFileRoute("/client-settings")({
  head: () => ({
    meta: [
      { title: "Client settings · Backoffice" },
      { name: "description", content: "Update your client settings as a client administrator." },
      { property: "og:title", content: "Client settings · Backoffice" },
    ],
  }),
  component: ClientSettingsPage,
});

function ClientSettingsPage() {
  const { user, ready } = useAuth();
  const scope = useClientScope(user);
  const queryClient = useQueryClient();
  const [values, setValues] = useState<ClientSettingsForm>(EMPTY_FORM);

  const selectedClientId = useMemo(() => {
    const candidates = [
      scope.activeClientId,
      scope.operatorId,
      scope.ids[0] ? String(scope.ids[0]) : null,
      user?.client_id ?? null,
      user?.operator_id ?? null,
      // Single-client admins do not carry a client object in the login payload; the
      // API resolves that from the session. Only use the real client ids from the
      // client list for multi-client accounts.
      scope.clients[0]?.id ?? null,
    ];
    return candidates.find(
      (value): value is string => Boolean(value !== undefined && value !== null && String(value).trim() !== ""),
    );
  }, [scope, user]);

  const requiredOperatorId = useMemo(() => {
    const loginOperator =
      user?.operator_id ??
      user?.operatorId ??
      user?.current_operator_id ??
      user?.active_operator_id ??
      user?.operator?.id ??
      (Array.isArray(user?.operators) && user.operators.length > 0
        ? (user.operators[0] as Dict)?.operator_id ?? (user.operators[0] as Dict)?.id ?? null
        : null);
    const resolved = String(loginOperator ?? scope.operatorId ?? "").trim();
    return scope.clientAdmin && !scope.singleClient && resolved ? resolved : null;
  }, [scope.clientAdmin, scope.operatorId, scope.singleClient, user]);

  useEffect(() => {
    if (!scope.clientAdmin || !scope.ids.length || scope.activeClientId) return;
    const fallback = String(scope.ids[0]);
    if (fallback && fallback !== "0") scope.setActiveClientId(fallback);
  }, [scope]);

  const clientViewPath = "/api/v1/clients/view";
  const settingsPath = scope.singleClient ? "/api/v1/clients/settings" : `/api/v1/clients/${selectedClientId}/settings`;

  const clientDetail = useQuery({
    queryKey: ["client-settings", scope.singleClient ? "session" : selectedClientId, requiredOperatorId ?? "none"],
    enabled: ready && scope.clientAdmin && (scope.singleClient || Boolean(selectedClientId)),
    retry: false,
    queryFn: () =>
      apiRequest(clientViewPath, {
        query: requiredOperatorId ? { operator_id: Number(requiredOperatorId) || requiredOperatorId } : undefined,
      }),
  });

  const clientRow = (() => {
    if (!clientDetail.data || typeof clientDetail.data !== "object") return undefined;
    const payload = clientDetail.data as Dict;
    const data = payload.data && typeof payload.data === "object" ? (payload.data as Dict) : payload;
    return data && typeof data === "object" ? data : undefined;
  })();

  useEffect(() => {
    if (!clientRow) return;
    const normalized = normalizeClientSettings(clientRow);
    // Resolve country values: API may return full country name or code.
    const incoming = (clientRow.country ?? (clientRow.settings && (clientRow.settings as Dict).country) ?? normalized.country) as unknown;
    const incomingStr = typeof incoming === "string" ? incoming.trim() : "";
    if (incomingStr) {
      const lower = incomingStr.toLowerCase();
      const match = COUNTRY_OPTIONS.find(
        (c) => c.value.toLowerCase() === lower || c.label.toLowerCase() === lower,
      );
      if (match) normalized.country = match.value;
      else normalized.country = incomingStr;
    }
    setValues(normalized);
  }, [clientRow]);

  const mutation = useMutation({
    mutationFn: async (payload: Dict) => {
      const nextPayload = { ...payload };
      if (requiredOperatorId) {
        nextPayload.operator_id = Number.isNaN(Number(requiredOperatorId))
          ? requiredOperatorId
          : Number(requiredOperatorId);
      }
      return apiRequest(settingsPath, {
        method: "PATCH",
        body: nextPayload,
      });
    },
    onSuccess: async () => {
      toast.success("Client settings saved.");
      await queryClient.invalidateQueries({
        queryKey: ["client-settings", scope.singleClient ? "session" : selectedClientId, requiredOperatorId ?? "none"],
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Unable to save client settings.";
      toast.error(message);
    },
  });

  if (!ready) return <div aria-hidden />;

  if (!scope.clientAdmin) {
    return (
      <DashboardShell title="Client settings">
        <div className="mx-auto mt-10 max-w-md rounded-lg border border-border bg-card p-8 text-center">
          <h2 className="mt-3 font-display text-base font-semibold">Not available</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This page is restricted to client administrator accounts.
          </p>
        </div>
      </DashboardShell>
    );
  }

  const formFields = CLIENT_SETTINGS_ACTION?.fields ?? [
    { name: "name", label: "Name", type: "text" },
    { name: "email", label: "Email", type: "text" },
    { name: "location_address", label: "Address", type: "text" },
    { name: "country", label: "Country", type: "select" },
    { name: "default_currency", label: "Default currency", type: "select" },
    { name: "currency_list", label: "Currency list", type: "text" },
    { name: "callback_version", label: "Callback version", type: "select" },
    { name: "callback_url", label: "Callback URL", type: "text" },
    { name: "home_url", label: "Home URL", type: "text" },
    { name: "topup_url", label: "Top-up URL", type: "text" },
    { name: "login_url", label: "Login URL", type: "text" },
    { name: "url_type", label: "URL type", type: "select" },
  ];

  const handleChange = (field: string, nextValue: string) => {
    setValues((current) => ({ ...current, [field]: nextValue }));
  };

  return (
    <DashboardShell title="Client settings" subtitle="Client configuration and branding">
      <div className="space-y-6">
        <section className="panel space-y-5 rounded-3xl border border-border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="label-eyebrow">Client configuration</p>
              <p className="text-sm text-muted-foreground">
                Update the active client configuration, including branding and callback settings.
              </p>
            </div>
            {scope.clients.length > 1 ? (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Client</span>
                <select
                  value={selectedClientId ?? ""}
                  onChange={(event) => scope.setActiveClientId(event.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                >
                  {scope.clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {selectedClientId ? (
            <p className="text-xs text-muted-foreground">Active client ID: {selectedClientId}</p>
          ) : null}

          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!scope.singleClient && !selectedClientId) return;
              mutation.mutate(toRequestBody(values));
            }}
          >
            {formFields.map((field) => {
              const commonClassName =
                "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30";
              const value = values[field.name as keyof ClientSettingsForm] ?? "";

              if (field.type === "select") {
                const options =
                    field.name === "country"
                      ? [
                          { label: "Select country", value: "" },
                          ...COUNTRY_OPTIONS.map((c) => ({ label: c.label, value: c.value })),
                        ]
                    : field.name === "default_currency"
                      ? [
                          { label: "Select currency", value: "" },
                          ...(CLIENT_SETTINGS_ACTION?.fields?.find((item) => item.name === "default_currency")?.options ?? []),
                        ]
                      : field.name === "callback_version"
                        ? [
                            { label: "Select version", value: "" },
                            { label: "v1", value: "v1" },
                            { label: "v2", value: "v2" },
                          ]
                        : field.name === "url_type"
                          ? [
                              { label: "Choose URL type", value: "" },
                              { label: "Redirect to Top Up URL", value: "1" },
                              { label: "Send a window postMessage", value: "2" },
                            ]
                          : [
                              { label: "Select", value: "" },
                            ];

                return (
                  <label key={field.name} className="flex flex-col gap-1.5 text-sm">
                    <span className="label-eyebrow">{field.label}</span>
                    <select
                      value={String(value)}
                      onChange={(event) => handleChange(field.name, event.target.value)}
                      className={commonClassName}
                    >
                      {options.map((option) => (
                        <option key={`${field.name}-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {field.name === "country" && String(value) ? (
                      <p className="mt-1 text-xs text-muted-foreground">Selected country: {(
                        COUNTRY_OPTIONS.find((c) => c.value === String(value))?.label ?? String(value)
                      )}</p>
                    ) : null}
                  </label>
                );
              }

              return (
                <label key={field.name} className="flex flex-col gap-1.5 text-sm">
                  <span className="label-eyebrow">{field.label}</span>
                  <Input
                    value={String(value)}
                    onChange={(event) => handleChange(field.name, event.target.value)}
                    placeholder={field.name === "currency_list" ? "KES,USD" : undefined}
                  />
                </label>
              );
            })}

            <div className="md:col-span-2 flex items-center justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setValues(normalizeClientSettings(clientRow))}>
                Reset
              </Button>
              <Button type="submit" disabled={!selectedClientId || mutation.isPending}>
                {mutation.isPending ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </DashboardShell>
  );
}
