import { useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { toast } from "sonner";
import { tokenStore } from "@/lib/api";

export type IssuedCredentials = {
  operatorId?: string | number;
  operatorName?: string;
  appKey?: string;
  apiKey?: string;
  message?: string;
};

function resolveStoredOperatorName(operatorId?: string | number): string | undefined {
  if (operatorId === undefined || operatorId === null || operatorId === "") return undefined;
  const user = tokenStore.user;
  if (!user) return undefined;

  const collections = [user.clients, user.operators, user.assigned_clients, user.client_ids, user.operator_ids];
  const normalized = String(operatorId).trim();
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const entry of collection) {
      if (!entry || typeof entry !== "object") continue;
      const obj = entry as Record<string, unknown>;
      const id = obj.operator_id ?? obj.client_id ?? obj.id;
      if (String(id) !== normalized) continue;
      const candidate = [obj.operator_name, obj.client_name, obj.name, obj.title].find(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      );
      if (candidate) return candidate.trim();
    }
  }

  return undefined;
}

/** Extracts onboarding credentials from an API response, if present. */
export function extractCredentials(data: unknown): IssuedCredentials | null {
  if (!data || typeof data !== "object") return null;
  const root = data as Record<string, unknown>;
  const payload = (root.data && typeof root.data === "object" ? root.data : root) as Record<string, unknown>;
  const appKey = payload.app_key;
  const apiKey = payload.api_key;
  if (typeof appKey !== "string" && typeof apiKey !== "string") return null;
  const operatorId = (payload.operator_id as string | number | undefined) ?? undefined;
  const operatorName =
    typeof payload.operator_name === "string" && payload.operator_name.trim()
      ? payload.operator_name.trim()
      : typeof payload.name === "string" && payload.name.trim()
        ? payload.name.trim()
        : resolveStoredOperatorName(operatorId);
  return {
    operatorId,
    operatorName,
    appKey: typeof appKey === "string" ? appKey : undefined,
    apiKey: typeof apiKey === "string" ? apiKey : undefined,
    message: typeof root.status_description === "string" ? root.status_description : undefined,
  };
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="label-eyebrow">{label}</p>
        <p className="num break-all text-sm">{value}</p>
      </div>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            toast.success(`${label} copied`);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            toast.error("Could not copy to clipboard");
          }
        }}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function CredentialsBanner({
  credentials,
  onDismiss,
}: {
  credentials: IssuedCredentials;
  onDismiss: () => void;
}) {
  return (
    <div className="panel space-y-3 border-primary/40 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{credentials.message ?? "Client onboarded successfully"}</p>
          <p className="text-xs text-muted-foreground">
            Warning: the previous API key will not work after this change. Copy these keys now — they are shown only once.
            {credentials.operatorName ? ` Operator: ${credentials.operatorName}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded-md border border-border p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="grid gap-2">
        {credentials.appKey ? <CopyRow label="App key" value={credentials.appKey} /> : null}
        {credentials.apiKey ? <CopyRow label="API key" value={credentials.apiKey} /> : null}
      </div>
    </div>
  );
}
