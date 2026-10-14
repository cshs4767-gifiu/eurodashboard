import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  BadgeDollarSign,
  CalendarRange,
  CircleUserRound,
  Gamepad2,
  Tag,
} from "lucide-react";

import { useEffect, useMemo, useState } from "react";
import {
  apiRequest,
  ApiError,
  metaNumber,
  normalizeList,
  type Dict,
  type QueryValue,
} from "@/lib/api";
import type { ResourceDef } from "@/lib/endpoints";
import { actionsFor, type ActionDef } from "@/lib/actions";
import { useAuth, canAccess, useClientScope, roleAllowed, isClientAdmin } from "@/lib/use-auth";
import { useReferenceStore } from "@/lib/stores/reference-store";
import { DataTable } from "./data-table";
import { StakeLimitsCell } from "./stake-limits-cell";
import {
  ExchangeRateCell,
  FreebetStatusCell,
  LocationCell,
  CallbackVersionCell,
  OddsCell,
  BetStatusCell,
  StatusCell,
  ThumbnailCell,
  TransactionTypeCell,
  MoneyCell,
  NumCell,
  BetAttemptAmountCell,
} from "./cell-renderers";
import { ConfigCell } from "./config-cell";
import { FilterBar } from "./filter-bar";
import { ActionDialog } from "./action-dialog";
import {
  CredentialsBanner,
  extractCredentials,
  type IssuedCredentials,
} from "./credentials-banner";
import { ApiErrorBox } from "./api-error";
import { toast } from "sonner";
import { downloadCsv } from "@/lib/csv";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { deriveColumns, formatCellValue, isIdKey, humanizeKey, resolveColumn } from "@/lib/format";
import { todayISO } from "@/lib/format";

const PROMOTION_KEYS = new Set([
  "bonus-config",
  "freebet-capabilities",
  "operator-game-freebets",
  "freebet-campaigns",
  "freebet-awards",
]);

function isPromotion(resource: ResourceDef): boolean {
  return PROMOTION_KEYS.has(resource.key);
}

function initialValues(resource: ResourceDef): Record<string, QueryValue> {
  const values: Record<string, QueryValue> = {};
  // Date filters default to today so every screen opens on the current day.
  for (const filter of resource.filters ?? [])
    values[filter.name] = filter.type === "date" ? todayISO() : "";
  return { ...values, ...(resource.defaults ?? {}) };
}

function formatPlayerModalValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("en-GB") : String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function normalizePlayerModalData(data: unknown): Dict | null {
  if (!data) return null;
  if (Array.isArray(data)) return (data[0] as Dict) ?? null;
  if (typeof data === "object") {
    const candidate = data as Dict;
    return (
      (candidate.player as Dict | undefined) ??
      (candidate.profile as Dict | undefined) ??
      (candidate.data as Dict | undefined) ??
      candidate
    );
  }
  return null;
}

export function ResourceView({ resource }: { resource: ResourceDef }) {
  const [values, setValues] = useState<Record<string, QueryValue>>(() => initialValues(resource));
  const [applied, setApplied] = useState<Record<string, QueryValue>>(() => initialValues(resource));
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  const [pending, setPending] = useState<{
    action: ActionDef;
    row?: Dict;
    initialValues?: Dict;
  } | null>(null);
  const [issued, setIssued] = useState<IssuedCredentials | null>(null);
  const [confirming, setConfirming] = useState<{ action: ActionDef; row?: Dict } | null>(null);
  const [lastOperatorId, setLastOperatorId] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  useEffect(() => {
    const fresh = initialValues(resource);
    setValues(fresh);
    setApplied(fresh);
    setPage(1);
  }, [resource.key]);

  const { user, ready } = useAuth();
  const scope = useClientScope(user);
  const hidePartner = isClientAdmin(user);
  const lockOperator = Boolean(scope.operatorId) && scope.mode !== "none";
  const singleClient = scope.singleClient;
  const isAdmin = roleAllowed(user, ["admin"]);

  const filters = resource.filters ?? [];
  const visibleFilters =
    (resource.key === "bets" || resource.key === "partner-bets") && scope.clientAdmin
      ? filters.filter((filter) => {
          if (filter.type === "operator" || filter.type === "partner") return false;
          if (resource.key === "bets" && filter.name === "source") return false;
          return true;
        })
      : filters;
  const collectionActions = (actionsFor(resource.key, "collection") ?? []).filter(
    (a) => canAccess(user, a.permission) && roleAllowed(user, a.roles),
  );
  const rowActions = (actionsFor(resource.key, "row") ?? []).filter(
    (a) => canAccess(user, a.permission) && roleAllowed(user, a.roles),
  );

  // Filters are reactive: changes debounce into the applied query, no Apply button.
  useEffect(() => {
    const timer = setTimeout(() => {
      setApplied((prev) => {
        const same =
          Object.keys(values).length === Object.keys(prev).length &&
          Object.keys(values).every((key) => values[key] === prev[key]);
        if (same) return prev;
        setPage(1);
        return values;
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [values]);

  // clear any pre-filled date values from the local state so they don't leak
  // into the query.
  useEffect(() => {
    const hasDateFilter = filters.some(
      (f) => f.type === "date" || f.name === "date_from" || f.name === "date_to",
    );
    if (hasDateFilter) return;
    let changed = false;
    const nextValues = { ...values };
    const nextApplied = { ...applied };
    if (nextValues["date_from"] !== undefined) {
      delete nextValues["date_from"];
      changed = true;
    }
    if (nextValues["date_to"] !== undefined) {
      delete nextValues["date_to"];
      changed = true;
    }
    if (nextApplied["date_from"] !== undefined) {
      delete nextApplied["date_from"];
      changed = true;
    }
    if (nextApplied["date_to"] !== undefined) {
      delete nextApplied["date_to"];
      changed = true;
    }
    if (changed) {
      setValues(nextValues);
      setApplied(nextApplied);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // Sync the locked operator into the filter state so the UI and query track the
  // active client from the header switcher for multi-client admins.
  useEffect(() => {
    if (lockOperator && scope.operatorId) {
      const current = String(values["operator_id"] ?? "").trim();
      if (current !== scope.operatorId) {
        setValues((prev) => ({ ...prev, operator_id: scope.operatorId }));
      }
    }
  }, [lockOperator, scope.operatorId, values]);

  const selectedOperatorId = String(
    applied.operator_id ?? values.operator_id ?? scope.operatorId ?? "",
  ).trim();
  const missingRequired = filters
    .filter((filter) => filter.required)
    .filter((filter) => !applied[filter.name] && applied[filter.name] !== 0)
    .map((filter) => filter.label);
  const requiresOperatorAndGame = resource.key === "bets";
  const hasActiveBetSelection =
    requiresOperatorAndGame &&
    Boolean(applied.game_id || values.game_id) &&
    Boolean(applied.operator_id || scope.operatorId);
  const waitForBetSelection =
    requiresOperatorAndGame && !hasActiveBetSelection;

  const requiresPartnerSelection = resource.key === "partner-bets";
  const hasActivePartnerSelection =
    requiresPartnerSelection &&
    [
      applied.source,
      values.source,
      applied.operator_id,
      values.operator_id,
      applied.partner_id,
      values.partner_id,
      applied.player_id,
      values.player_id,
      applied.transaction,
      values.transaction,
    ].some((value) => value !== "" && value !== null && value !== undefined);
  const waitForPartnerSelection = requiresPartnerSelection && !hasActivePartnerSelection;

  const query = useMemo(() => {
    const params: Record<string, QueryValue> = {};
    // Empty filters are dropped so the query key stays stable and we don't
    // refetch just because a blank input changed shape.
    for (const [key, value] of Object.entries(applied)) {
      if (value === "" || value === null || value === undefined) continue;
      if (key === "source" && scope.clientAdmin) continue;
      if (key === "source" && String(value).toLowerCase() === "without_source") continue;
      params[key] = value;
      if ((key === "name" || key === "game_name") && params[key] !== undefined) {
        params.name = params.name ?? String(value);
      }
    }
    // Prefer the active operator chosen in the filter bar; if the account is
    // pinned to one operator, that scope still wins, but do not drop a user
    // selection when the list is merely filtered by operator.
    const selectedOperator = String(applied.operator_id ?? values.operator_id ?? scope.operatorId ?? "").trim();
    if (selectedOperator) params.operator_id = selectedOperator;
    else if (lockOperator && scope.operatorId) params.operator_id = scope.operatorId;
    if (singleClient && !isAdmin) delete params.operator_id;
    if (resource.paginated) {
      params.page = page;
      params.per_page = perPage;
    }
    return params;
  }, [
    applied,
    page,
    perPage,
    resource.paginated,
    singleClient,
    lockOperator,
    scope.operatorId,
    isAdmin,
  ]);

  const queryKey = useMemo(() => JSON.stringify(query), [query]);

  const request = useQuery({
    queryKey: [resource.key, queryKey],
    // Wait for the cached session: firing before it resolves would run once
    // unscoped and again with the client scope applied.
    enabled: ready && missingRequired.length === 0 && !waitForBetSelection && !waitForPartnerSelection,
    queryFn: () => apiRequest(resource.path, { query }),
    retry: false,
  });

  const selectedPlayerQuery = useQuery({
    queryKey: ["player-profile-modal", selectedPlayerId],
    enabled: resource.key === "players" && Boolean(selectedPlayerId),
    queryFn: () => {
      const id = String(selectedPlayerId ?? "");
      return apiRequest<Dict | Dict[]>(`/api/v1/players/${id}`);
    },
    retry: false,
  });

  const selectedPlayer = useMemo(
    () => normalizePlayerModalData(selectedPlayerQuery.data ?? null),
    [selectedPlayerQuery.data],
  );

  const rawList = useMemo(() => normalizeList(request.data ?? null), [request.data]);
  // Rates are quoted against USD, so the USD → USD row carries no information.
  const list = useMemo(
    () =>
      resource.key === "exchange-rates"
        ? {
            ...rawList,
            rows: rawList.rows.filter((row) => String(row.currency ?? "").toUpperCase() !== "USD"),
          }
        : rawList,
    [rawList, resource.key],
  );
  const tableList = waitForBetSelection ? { rows: [], meta: {} } : list;

  const total =
    metaNumber(tableList.meta, ["total", "total_items", "count", "total_records"]) ??
    (resource.key === "operator-games" ? tableList.rows.length : null);
  const hasMore =
    tableList.meta && typeof tableList.meta === "object"
      ? (() => {
          const value =
            (tableList.meta as Dict).has_more ?? (tableList.meta as Dict).hasMore ?? undefined;
          if (typeof value === "boolean") return value;
          if (typeof value === "string") return value.toLowerCase() === "true" || value === "1";
          if (typeof value === "number") return value === 1;
          return undefined;
        })()
      : undefined;
  const lastPage = metaNumber(tableList.meta, ["last_page", "total_pages", "pages"]);

  const extraCellRenderers = useMemo(() => {
    if (resource.key === "players") {
      return {
        id: (row: Dict) => {
          const value = row.id === undefined || row.id === null || row.id === "" ? "" : String(row.id);
          if (!value) return <span className="text-muted-foreground">—</span>;
          return (
            <button
              type="button"
              onClick={() => setSelectedPlayerId(value)}
              className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/5 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
            >
              {value}
              <ArrowUpRight className="size-3" strokeWidth={1.75} />
            </button>
          );
        },
      };
    }
    if (resource.key === "operator-games") {
      return {
        thumbnail: (row: Dict) => <ThumbnailCell row={row} />,
        stake_limits: (row: Dict) => <StakeLimitsCell row={row} />,
        status: (row: Dict) => <StatusCell row={row} />,
      };
    }
    if (resource.key === "games")
      return {
        thumbnail: (row: Dict) => <ThumbnailCell row={row} />,
        status: (row: Dict) => <StatusCell row={row} />,
      };
    if (resource.key === "partners")
      return {
        thumbnail: (row: Dict) => <ThumbnailCell row={row} />,
        status: (row: Dict) => <StatusCell row={row} />,
      };
    if (resource.key === "exchange-rates")
      return { exchange_rate: (row: Dict) => <ExchangeRateCell row={row} /> };
    if (resource.key === "clients")
      return {
        location: (row: Dict) => <LocationCell row={row} />,
        callback_version: (row: Dict) => <CallbackVersionCell row={row} />,
        status: (row: Dict) => <StatusCell row={row} />,
      };
    if (resource.key === "transactions")
      return {
        transaction_type_id: (row: Dict) => <TransactionTypeCell row={row} />,
        transaction_type: (row: Dict) => <TransactionTypeCell row={row} />,
        type: (row: Dict) => <TransactionTypeCell row={row} />,
      };
    if (resource.key === "freebets")
      return { status: (row: Dict) => <FreebetStatusCell row={row} /> };
    return {};
  }, [resource.key]);

  // Actions flagged `confirmFromFilters` reuse the current filter values, so we
  // only confirm instead of opening the parameter modal.
  const confirmParams = useMemo(() => {
    if (!confirming) return {} as Record<string, QueryValue>;
    const params: Record<string, QueryValue> = {};
    for (const field of confirming.action.fields ?? []) {
      const raw = confirming.row?.[field.name] ?? applied[field.name];
      const value = raw as QueryValue | undefined;
      if (value !== undefined && value !== "" && value !== null) params[field.name] = value;
    }
    for (const [queryKey, rowKey] of Object.entries(confirming.action.queryFromRow ?? {})) {
      const raw = confirming.row?.[rowKey];
      if (raw !== undefined && raw !== null && raw !== "") params[queryKey] = raw as QueryValue;
    }
    return params;
  }, [confirming, applied]);

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!confirming) return null;
      const path = confirming.action.path.replace(/\{(\w+)\}/g, (_m, key: string) =>
        String(confirming.row?.[key] ?? ""),
      );
      return apiRequest(path, {
        method: confirming.action.method,
        query: Object.keys(confirmParams).length > 0 ? confirmParams : undefined,
      });
    },
    onSuccess: (data) => {
      const dict = data && typeof data === "object" && !Array.isArray(data) ? (data as Dict) : null;
      const description =
        (typeof dict?.status_description === "string" && dict.status_description) ||
        (typeof dict?.message === "string" && dict.message) ||
        undefined;
      toast.success(description ?? `${confirming?.action.label ?? "Request"} succeeded`);
      setConfirming(null);
      void request.refetch();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Request failed");
    },
  });

  const handleChange = (name: string, value: string) => {
    setValues((prev) => {
      const next = { ...prev, [name]: value };
      if (name === "source" && (value === "partner" || value === "without_source")) {
        next.game_id = "";
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <FilterBar
        filters={visibleFilters}
        locked={lockOperator ? ["operator_id"] : undefined}
        values={values}
        onChange={handleChange}
        busy={request.isFetching}
        onReset={() => {
          const fresh = initialValues(resource);
          if (lockOperator && scope.operatorId) fresh.operator_id = scope.operatorId;
          setValues(fresh);
          setApplied(fresh);
          setPage(1);
        }}
      />

      {collectionActions.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-2">
          {collectionActions
            .filter((action) => {
              if (resource.key !== "operator-games") return true;
              if (action.key !== "operator-game-create") return true;
              return Boolean(selectedOperatorId);
            })

            .filter((action) => {
              if (resource.key !== "bonus-config") return true;
              if (action.key !== "bonus-config-create") return true;
              return Boolean(selectedOperatorId);
            })
            .filter((action) => {
              if (resource.key !== "freebet-campaigns") return true;
              if (action.key !== "freebet-campaign-create") return true;
              if (scope.clientAdmin && scope.mode === "single") return true;
              return Boolean(selectedOperatorId);
            })
            .filter((action) => {
              if (resource.key !== "operator-game-freebets") return true;
              if (action.key !== "operator-game-freebet-create") return true;
              return !hidePartner;
            })
            .filter((action) => {
              if (resource.key !== "bets") return true;
              if (action.key !== "bets-bulk-posting") return true;
              return Boolean(selectedOperatorId && applied.game_id && tableList.rows.length > 0);
            })
            .map((action) => (
              <button
                key={action.key}
                onClick={() =>
                  setPending({
                    action,
                    row: undefined,
                    initialValues:
                      action.key === "bets-bulk-posting" && selectedOperatorId && applied.game_id
                        ? { operator_id: selectedOperatorId, game_id: String(applied.game_id) }
                        : action.key === "operator-game-create" && selectedOperatorId
                          ? { operator_id: selectedOperatorId }
                          : action.key === "freebet-campaign-create" && selectedOperatorId
                            ? { operator_id: selectedOperatorId }
                            : action.key === "bonus-config-create" && selectedOperatorId
                              ? { operator_id: selectedOperatorId }
                              : action.key === "operator-game-freebet-create"
                                ? { operator_id: selectedOperatorId || lastOperatorId }
                                : undefined,
                  })
                }
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                {action.label}
              </button>
            ))}
        </div>
      ) : null}
      {resource.key === "bets" || resource.key === "partner-bets" ? (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={tableList.rows.length === 0}
            onClick={async () => {
              try {
                const exportQuery: Record<string, QueryValue> = {};
                for (const [key, value] of Object.entries(applied)) {
                  if (value === "" || value === null || value === undefined) continue;
                  exportQuery[key] = value;
                }
                if (lockOperator && scope.operatorId) {
                  exportQuery.operator_id = scope.operatorId;
                }
                if (singleClient && !isAdmin) delete exportQuery.operator_id;
                exportQuery.export = 1;

                const response = await apiRequest<Dict>(resource.path, { query: exportQuery });
                const exportedRows = normalizeList(response).rows as Dict[];

                const flattenedRows = exportedRows.map((r) => {
                  const results = r.results;
                  let row = { ...r } as Dict;
                  const partnerId = row.partner_id;
                  const isInHouse =
                    partnerId === undefined ||
                    partnerId === null ||
                    partnerId === 0 ||
                    partnerId === "0" ||
                    partnerId === "";
                  row.source = isInHouse ? "in_house" : "partner";
                  if (Array.isArray(results) && results.length > 0) {
                    const first = results[0];
                    if (first && typeof first === "object") {
                      return { ...row, ...(first as Dict), source: row.source };
                    }
                  }
                  return row;
                });

                const hideColumns = hidePartner
                  ? [
                      ...(resource.hideColumns ?? []),
                      "partner_name",
                      "partner_id",
                      ...(isPromotion(resource) ? ["config", "configs"] : []),
                    ]
                  : (resource.hideColumns ?? []);
                const hiddenForClientAdmin = isClientAdmin(user)
                  ? [
                      "operator_id",
                      "operator",
                      "operatorId",
                      "operator_id_hash",
                      "client_id",
                      "clientId",
                      "id",
                      "balance",
                      "prev_balance",
                      "external_id",
                      "player_token",
                      "last_balance_update",
                      "operator_bet_reference",
                      "partner_bet_reference",
                    ]
                  : [];
                const cols =
                  resource.exportColumns ??
                  deriveColumns(flattenedRows, resource.columns, 999, [
                    ...hideColumns,
                    ...hiddenForClientAdmin,
                  ]).filter((col) => !["operator_bet_reference", "updated", "id"].includes(col));
                const exported = flattenedRows.map((r) => {
                  const out: Record<string, string | number | null> = {};
                  for (const col of cols) {
                    const key = resolveColumn(r, col) ?? col;
                    out[humanizeKey(col)] = formatCellValue(r[key], {
                      useGrouping: !isIdKey(col),
                    });
                  }
                  return out;
                });
                downloadCsv(
                  `bets-export-${String(applied.date_from ?? "all")}_${String(applied.date_to ?? "all")}.csv`,
                  exported,
                );
              } catch (err) {
                toast.error("Export failed", {
                  description:
                    err instanceof ApiError
                      ? `API error ${err.status}: ${err.message}`
                      : err instanceof Error
                        ? err.message
                        : "Unknown error",
                });
              }
            }}
            className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
          >
            Export
          </button>
        </div>
      ) : null}

      {issued ? <CredentialsBanner credentials={issued} onDismiss={() => setIssued(null)} /> : null}

      <Dialog
        open={resource.key === "players" && Boolean(selectedPlayerId)}
        onOpenChange={(open) => {
          if (!open) setSelectedPlayerId(null);
        }}
      >
        <DialogContent className="max-w-[92vw] sm:max-w-2xl md:max-w-3xl overflow-hidden p-0 sm:rounded-xl">
          <div className="border-b border-border bg-card px-4 py-3">
            <DialogHeader className="text-left">
              <DialogTitle className="font-display text-lg">Player profile</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {selectedPlayerId ? `Player ${selectedPlayerId}` : "Player details"}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="max-h-[70vh] overflow-y-auto bg-background p-3 sm:p-4">
            <div className="space-y-4">
            {selectedPlayerQuery.isLoading ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="h-16 animate-pulse rounded-lg border border-border bg-card" />
                ))}
              </div>
            ) : selectedPlayer ? (
              <>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    {
                      label: "Player ID",
                      value: formatPlayerModalValue(selectedPlayer.player_id ?? selectedPlayer.id ?? selectedPlayerId),
                      icon: CircleUserRound,
                    },
                    {
                      label: "Operator",
                      value: formatPlayerModalValue(selectedPlayer.operator_name ?? selectedPlayer.operator_id),
                      icon: Tag,
                    },
                    {
                      label: "Balance",
                      value: formatPlayerModalValue(`${selectedPlayer.balance ?? "0"} ${selectedPlayer.currency ?? ""}`.trim()),
                      icon: BadgeDollarSign,
                    },
                    {
                      label: "Status",
                      value: formatPlayerModalValue(selectedPlayer.status),
                      icon: CalendarRange,
                    },
                  ].map(({ label, value, icon: Icon }) => (
                    <div key={label} className="rounded-md border border-border bg-card p-3">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="num text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                          {label}
                        </span>
                        <Icon className="size-3.5 text-primary" strokeWidth={1.8} />
                      </div>
                      <div className="font-display text-sm font-semibold text-foreground">{value}</div>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3 lg:grid-cols-[1.3fr_0.9fr]">
                  <div className="rounded-md border border-border bg-card p-3">
                    <div className="mb-2 font-display text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Attributes
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {[
                        ["Player name", selectedPlayer.player_name],
                        ["External ID", selectedPlayer.external_id],
                        ["Currency", selectedPlayer.currency],
                        ["Player token", selectedPlayer.player_token],
                        ["Auth token", selectedPlayer.token],
                        ["Created", selectedPlayer.created],
                        ["Updated", selectedPlayer.updated],
                        ["Prev balance", selectedPlayer.prev_balance],
                        ["Last balance update", selectedPlayer.last_balance_update],
                        ["Operator name", selectedPlayer.operator_name],
                        ["Operator ID", selectedPlayer.operator_id],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-sm border border-border bg-background/40 p-2">
                          <div className="num mb-1 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                            {label}
                          </div>
                          <div className="break-words text-xs text-foreground">
                            {formatPlayerModalValue(value)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-md border border-border bg-card p-3">
                    <div className="mb-2 font-display text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Stats
                    </div>
                    <div className="space-y-2 text-xs text-muted-foreground">
                      {[
                        ["Date from", selectedPlayer.stats?.date_from],
                        ["Date to", selectedPlayer.stats?.date_to],
                        ["Game ID", selectedPlayer.stats?.game_id],
                        ["Partner ID", selectedPlayer.stats?.partner_id],
                        ["Sources", (selectedPlayer.stats?.sources ?? []).join(", ") || "—"],
                        ["Total bets", selectedPlayer.stats?.bet_count?.total ?? 0],
                        ["Pending", selectedPlayer.stats?.bet_count?.pending ?? 0],
                        ["Won bets", selectedPlayer.stats?.bet_count?.won ?? 0],
                        ["Lost bets", selectedPlayer.stats?.bet_count?.lost ?? 0],
                        ["Refunded", selectedPlayer.stats?.bet_count?.refunded ?? 0],
                        ["Stake USD", selectedPlayer.stats?.amounts_usd?.stake ?? 0],
                        ["Won USD", selectedPlayer.stats?.amounts_usd?.won ?? 0],
                        ["Refunded USD", selectedPlayer.stats?.amounts_usd?.refunded ?? 0],
                        ["Bet attempts", selectedPlayer.stats?.bet_attempts?.total ?? 0],
                      ].map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between rounded-sm border border-border bg-background/40 px-2 py-1.5">
                          <span>{label}</span>
                          <span className="num text-foreground">{formatPlayerModalValue(value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-md border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
                No player details were returned for this profile.
              </div>
            )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {missingRequired.length === 0 ? (
        <>
          {resource.key === "exchange-rates" ? (
            <p className="panel px-4 py-2.5 text-xs text-muted-foreground">
              Note: all conversions are done in USD — rates shown are per 1 USD, so the USD row is
              omitted.
            </p>
          ) : null}

          {!waitForBetSelection && request.error ? (
            <ApiErrorBox error={request.error} />
          ) : (
            <>
              {resource.key === "partner-launch-resolver" ? (
                <div className="panel space-y-4 rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between">
                    <h3 className="text-sm font-medium">Launch resolver</h3>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const full = JSON.stringify(request.data ?? list.rows[0] ?? {}, null, 2);
                          const blob = new Blob([full], { type: "application/json" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = "launch-resolver.json";
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                          URL.revokeObjectURL(url);
                        }}
                        className="rounded-md border border-border bg-card px-2 py-1 text-xs"
                      >
                        Download JSON
                      </button>
                    </div>
                  </div>

                  {request.data && typeof request.data === "object" ? (
                    <div className="text-xs text-muted-foreground">
                      {String((request.data as Dict)["status_description"] ?? "")} (code:{" "}
                      {(request.data as Dict)["status_code"] ?? ""})
                    </div>
                  ) : null}

                  {list.rows.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No matching configuration found.
                    </p>
                  ) : (
                    (() => {
                      const row = list.rows[0] as Dict;
                      const resolved = (row["resolved_config"] ??
                        row["resolvedConfig"] ??
                        row["resolved"] ??
                        {}) as Dict;
                      const defaults = (row["partner_default_configs"] ??
                        row["partnerDefaults"] ??
                        {}) as Dict;
                      const prettyResolved = JSON.stringify(resolved, null, 2);
                      const prettyDefaults = JSON.stringify(defaults, null, 2);
                      return (
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                            <div className="text-xs">
                              <div className="num font-medium">Game</div>
                              <div className="text-sm">
                                {String(row["game_name"] ?? row["game_id"] ?? "-")}
                              </div>
                            </div>
                            <div className="text-xs">
                              <div className="num font-medium">Partner</div>
                              <div className="text-sm">
                                {String(row["partner_name"] ?? row["partner_id"] ?? "-")}
                              </div>
                            </div>
                            <div className="text-xs">
                              <div className="num font-medium">Operator</div>
                              <div className="text-sm">{String(row["operator_id"] ?? "-")}</div>
                            </div>
                            <div className="text-xs">
                              <div className="num font-medium">Operator game ID</div>
                              <div className="text-sm">
                                {String(row["operator_game_id"] ?? "-")}
                              </div>
                            </div>
                            <div className="text-xs md:col-span-2">
                              <div className="num font-medium">Config source</div>
                              <div className="text-sm">{String(row["config_source"] ?? "-")}</div>
                            </div>
                          </div>

                          <div>
                            <div className="num mb-2 text-xs font-medium">
                              Partner default configs
                            </div>
                            <div className="relative rounded-md border border-border bg-surface p-3">
                              <pre className="max-h-56 overflow-auto text-xs">
                                <code>{prettyDefaults}</code>
                              </pre>
                              <div className="absolute right-2 top-2 flex gap-2">
                                <button
                                  onClick={() => navigator.clipboard?.writeText(prettyDefaults)}
                                  className="rounded-md border border-border bg-card px-2 py-1 text-xs"
                                >
                                  Copy
                                </button>
                              </div>
                            </div>
                          </div>

                          <div>
                            <div className="num mb-2 text-xs font-medium">Resolved config</div>
                            <div className="relative rounded-md border border-border bg-surface p-3">
                              <pre className="max-h-72 overflow-auto text-xs">
                                <code>{prettyResolved}</code>
                              </pre>
                              <div className="absolute right-2 top-2 flex gap-2">
                                <button
                                  onClick={() => navigator.clipboard?.writeText(prettyResolved)}
                                  className="rounded-md border border-border bg-card px-2 py-1 text-xs"
                                >
                                  Copy
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  )}
                </div>
              ) : (
                <DataTable
                  rows={tableList.rows}
                  columns={resource.columns}
                  suppressSyntheticSource={
                    resource.key === "operator-game-freebets" ||
                    resource.key === "freebet-capabilities" ||
                    resource.key === "freebet-campaigns" ||
                    resource.key === "freebet-awards" ||
                    resource.key === "bonus-config"
                  }
                  hideColumns={
                    hidePartner
                      ? [...(resource.hideColumns ?? []), "partner_name", "partner_id"]
                      : resource.hideColumns
                  }
                  total={resource.key === "operator-games" ? total : undefined}
                  statusContext={
                    resource.key.includes("freebet")
                      ? "freebet"
                      : resource.key.includes("slip")
                        ? "slip"
                        : resource.key.includes("bet")
                          ? "bet"
                          : undefined
                  }
                  cellRenderers={{
                    config: (row) => <ConfigCell row={row} field="config" />,
                    configs: (row) => <ConfigCell row={row} field="configs" />,
                    ...(/bets$|bet-attempts|slip/.test(resource.key)
                      ? {}
                      : { status: (row: Dict) => <StatusCell row={row} /> }),
                    ...(resource.key === "bet-attempts"
                      ? {
                          amount: (row: Dict) => <BetAttemptAmountCell row={row} />,
                          partner_bet_reference: (row: Dict) => {
                            const value = row.partner_bet_reference;
                            const text =
                              value === null || value === undefined || value === ""
                                ? "—"
                                : String(value);
                            return (
                              <span className="block max-w-[16rem] truncate" title={text === "—" ? undefined : text}>
                                {text}
                              </span>
                            );
                          },
                        }
                      : {}),
                    ...(resource.key === "bets"
                      ? {
                          odds: (row: Dict) => <OddsCell row={row} />,
                          stake: (row: Dict) => <MoneyCell row={row} field="stake" />,
                          bet_amount: (row: Dict) => <MoneyCell row={row} field="stake" />,
                          stake_amount: (row: Dict) => <MoneyCell row={row} field="stake" />,
                          amount: (row: Dict) => <MoneyCell row={row} field="stake" />,
                          won_amount: (row: Dict) => <MoneyCell row={row} field="won_amount" />,
                          settlement_amount: (row: Dict) => (
                            <MoneyCell row={row} field="won_amount" />
                          ),
                          win_amount: (row: Dict) => <MoneyCell row={row} field="won_amount" />,
                          payout: (row: Dict) => <MoneyCell row={row} field="won_amount" />,
                          status: (row: Dict) => <BetStatusCell row={row} />,
                        }
                      : {}),
                    ...(resource.key === "games"
                      ? {
                          face_off: (row: Dict) => {
                            const val = String(row["face_off"] ?? "");
                            if (val === "0")
                              return (
                                <span className="text-green-500" title="No face-off">
                                  ✓
                                </span>
                              );
                            if (val === "1")
                              return (
                                <span className="text-red-500" title="Face-off enabled">
                                  ✕
                                </span>
                              );
                            return <span>{formatCellValue(row["face_off"])}</span>;
                          },
                        }
                      : {}),
                    ...extraCellRenderers,
                  }}

                  isLoading={request.isLoading}
                  rowActions={
                    // Disable row actions for client-admin accounts to prevent
                    // exposing operator-level actions in client-scoped views.
                    !isClientAdmin(user) && rowActions.length > 0
                      ? (row) => {
                          const statusKey = String(row["status"] ?? "")
                            .trim()
                            .toLowerCase();
                          const freebetActive = ["1", "active", "true", "yes"].includes(statusKey);
                          if (resource.key === "freebets" && !freebetActive) return null;

                          return (
                            <>
                              {rowActions.map((action) => {
                                // Already queued for posting (is_posted = 10) — no re-queueing.
                                const queued =
                                  action.key === "bet-request-posting" &&
                                  String(row["is_posted"] ?? "") === "10";
                                return (
                                  <button
                                    key={action.key}
                                    disabled={queued}
                                    title={queued ? "Already queued" : undefined}
                                    onClick={() =>
                                      action.confirmFromFilters
                                        ? setConfirming({ action, row })
                                        : setPending({ action, row })
                                    }
                                    className={cn(
                                      "rounded-md border px-2 py-1 text-xs transition-colors disabled:pointer-events-none disabled:opacity-40",
                                      action.danger
                                        ? "border-destructive/40 text-destructive hover:bg-destructive/10"
                                        : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
                                    )}
                                  >
                                    {queued ? "Queued" : action.label}
                                  </button>
                                );
                              })}
                            </>
                          );
                        }
                      : undefined
                  }
                />
              )}
            </>
          )}

          {resource.paginated ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="num text-xs text-muted-foreground">
                Page {page}
                {lastPage ? ` of ${lastPage}` : ""} · {tableList.rows.length} rows
              </p>
              <div className="flex items-center gap-2">
                <select
                  value={perPage}
                  onChange={(event) => {
                    setPerPage(Number(event.target.value));
                    setPage(1);
                  }}
                  className="num h-8 rounded-md border border-input bg-surface px-2 text-xs"
                >
                  {[10, 25, 50, 100].map((size) => (
                    <option key={size} value={size}>
                      {size} / page
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={page === 1 || request.isFetching}
                  className="h-8 rounded-md border border-border px-3 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((prev) => prev + 1)}
                  disabled={
                    request.isFetching ||
                    tableList.rows.length === 0 ||
                    (hasMore === false ||
                      (hasMore !== true && lastPage !== null && page >= lastPage))
                  }
                  className="h-8 rounded-md border border-border px-3 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <AlertDialog
        open={Boolean(confirming)}
        onOpenChange={(open) => {
          if (!open) {
            confirmMutation.reset();
            setConfirming(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming?.action.label ?? "Confirm"}
              {confirming?.row && confirming.action.idKey ? (
                <span className="num ml-2 text-xs text-muted-foreground">
                  #{String(confirming.row[confirming.action.idKey] ?? "")}
                </span>
              ) : null}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will run “{confirming?.action.label ?? "this action"}”. Do you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                confirmMutation.mutate();
              }}
            >
              {confirmMutation.isPending ? "Sending…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {pending ? (
        <ActionDialog
          key={`${pending.action.key}-${String(pending.row?.[pending.action.idKey ?? "id"] ?? "new")}-${selectedOperatorId || "no-operator"}`}
          action={pending.action}
          row={pending.row}
          initialValues={pending.initialValues}
          open
          onOpenChange={(open) => !open && setPending(null)}
          onValuesChange={(values) => {
            const opId = values.operator_id;
            if (typeof opId === "string" && opId && opId !== selectedOperatorId) {
              setLastOperatorId(opId);
            }
          }}
          onSuccess={(data) => {
            const creds = extractCredentials(data);
            if (creds) setIssued(creds);
            void request.refetch();
          }}
        />
      ) : null}
    </div>
  );
}
