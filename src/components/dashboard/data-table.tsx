import { AlertTriangle, ChevronRight, Inbox } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Dict } from "@/lib/api";
import {
  currencyCodesFromRow,
  deriveColumns,
  formatCellValue,
  humanizeKey,
  isIdKey,
  looksLikeStatus,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { statusMeta } from "@/lib/status-labels";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ReadableValue } from "./readable-value";
import { useAuth, isClientAdmin } from "@/lib/use-auth";
import {
  ExchangeRateCell,
  FreebetStatusCell,
  LocationCell,
  CallbackVersionCell,
  StatusCell,
  StatusPill,
  ThumbnailCell,
  TransactionTypeCell,
  MoneyCell,
} from "./cell-renderers";

import { useReferenceStore, type Kind } from "@/lib/stores/reference-store";

const REFERENCE_COLUMNS: Record<string, Kind> = {
  operator_id: "operator",
  client_id: "operator",
  game_id: "game",
  role_id: "role",
  permission_id: "permission",
};

const HIDDEN_DETAIL_KEYS = new Set(["extra_data", "is_posted_extra_data"]);

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function shouldSkipDetailField(key: string, value: unknown): boolean {
  if (HIDDEN_DETAIL_KEYS.has(key)) return true;
  if (typeof value === "string" && /\bextra_data\b/i.test(value)) return true;
  return false;
}

function slipMatchSummary(slip: Dict): { heading: string; subheading?: string } | null {
  const extra = parseJsonObject(slip.extra_data ?? slip.extraData ?? null);
  if (!extra) return null;

  const home =
    (typeof extra.HName === "string" && extra.HName) ||
    (typeof extra.HTeam === "string" && extra.HTeam) ||
    null;
  const away =
    (typeof extra.AName === "string" && extra.AName) ||
    (typeof extra.ATeam === "string" && extra.ATeam) ||
    null;

  if (!home && !away) return null;

  const heading = [home ?? "Home", away ?? "Away"].join(" vs ");
  const parts = [slip.outcome_name, slip.scores, slip.halftime_score].filter(
    (part) => typeof part === "string" && part.trim(),
  );
  return {
    heading,
    subheading: parts.length > 0 ? parts.join(" • ") : undefined,
  };
}

function useReferenceLookups(_rows: Dict[]) {
  // Label lookups reuse reference lists that are already in the store (loaded
  // on demand by the filter dropdowns). The table never fetches them itself —
  // each page only calls the API it is actually about.
  const operator = useReferenceStore((s) => s.operator);
  const game = useReferenceStore((s) => s.game);
  const role = useReferenceStore((s) => s.role);
  const permission = useReferenceStore((s) => s.permission);

  return useMemo(() => {
    const maps: Partial<Record<Kind, Map<string, string>>> = {};
    const build = (kind: Kind, state: { options: { value: string; label: string }[] }) => {
      const map = new Map<string, string>();
      for (const opt of state.options) map.set(opt.value, opt.label);
      maps[kind] = map;
    };
    build("operator", operator);
    build("game", game);
    build("role", role);
    build("permission", permission);
    return maps;
  }, [operator, game, role, permission]);
}

function lookupLabel(
  col: string,
  value: unknown,
  maps: Partial<Record<Kind, Map<string, string>>>,
): string | null {
  const kind = REFERENCE_COLUMNS[col];
  if (!kind) return null;
  if (value === null || value === undefined || value === "") return null;
  return maps[kind]?.get(String(value)) ?? null;
}

export function DataTable({
  rows,
  columns,
  isLoading,
  error,
  emptyHint,
  rowActions,
  hideColumns,
  cellRenderers,
  total,
  statusContext,
  suppressSyntheticSource = false,
}: {
  rows: Dict[];
  columns?: string[];
  hideColumns?: string[];
  isLoading?: boolean;
  error?: string | null;
  emptyHint?: string;
  rowActions?: (row: Dict) => ReactNode;
  cellRenderers?: Record<string, (row: Dict) => ReactNode>;
  total?: number | null;
  statusContext?: string;
  suppressSyntheticSource?: boolean;
}) {
  const { user } = useAuth();
  const clientAdmin = isClientAdmin(user);
  const [selected, setSelected] = useState<Dict | null>(null);
  const [selectedSlips, setSelectedSlips] = useState<Dict[] | null>(null);
  const lookupMaps = useReferenceLookups(rows);
  // Adds a synthetic `currency` field derived from per-currency amount fields.
  const syntheticKeys = useMemo(() => Object.keys(cellRenderers ?? {}), [cellRenderers]);
  const displayRows = useMemo(
    () =>
      rows.map((row) => {
        let next = row;
        if (!next.currency) {
          const codes = currencyCodesFromRow(next);
          if (codes.length) next = { ...next, currency: codes.join(", ") };
        }
        if (!next.game_name) {
          const nested = (next.game ?? next.games) as Record<string, unknown> | undefined;
          const name =
            (typeof next.master_game_name === "string" && next.master_game_name) ||
            (typeof next.partner_game_name === "string" && next.partner_game_name) ||
            (nested && typeof nested.name === "string" && nested.name) ||
            "";
          if (name) next = { ...next, game_name: name };
        }
        if (!suppressSyntheticSource && next.source === undefined) {
          const partnerId = next.partner_id;
          const isInHouse = partnerId === undefined || partnerId === null || partnerId === 0 || partnerId === "0" || partnerId === "";
          next = { ...next, source: isInHouse ? "in_house" : "partner" };
        }
        // Bet records nest settlement data inside `results[]` (won/lost) or a
        // `rollback` object. Hoist the odds, payout and posting state to
        // top-level synthetic keys so the configured columns resolve correctly.
        if (next.results || next.rollback) {
          const source =
            next.rollback && typeof next.rollback === "object" && !Array.isArray(next.rollback)
              ? (next.rollback as Dict)
              : Array.isArray(next.results) && next.results.length > 0
                ? (next.results[0] as Dict)
                : null;
          if (source) {
            if (next.odds === undefined && source.total_odd !== undefined) {
              next = { ...next, odds: source.total_odd };
            }
            if (next.won_amount === undefined && source.amount !== undefined) {
              next = { ...next, won_amount: source.amount };
            }
            if (next.is_posted === undefined && source.is_posted !== undefined) {
              next = { ...next, is_posted: source.is_posted };
            }
          }
        }
        for (const key of syntheticKeys) {
          if (next[key] === undefined) next = { ...next, [key]: "" };
        }
        return next;
      }),
    [rows, syntheticKeys],
  );

  if (isLoading) {
    return (
      <div className="panel space-y-2 p-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-9 w-full bg-muted/60" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel flex items-start gap-3 border-destructive/40 p-6">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" strokeWidth={1.75} />
        <div>
          <p className="font-display text-sm font-semibold">Request failed</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (displayRows.length === 0) {
    return (
      <div className="panel flex flex-col items-center gap-2 px-6 py-14 text-center">
        <Inbox className="size-6 text-muted-foreground" strokeWidth={1.5} />
        <p className="font-display text-sm font-semibold">No records returned</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {emptyHint ?? "Adjust the filters above and run the query again."}
        </p>
      </div>
    );
  }

  const hiddenForClientAdmin = clientAdmin
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
        "bet_reference",
        "operator_bet_reference",
        "partner_bet_reference",
      ]
    : [];
  const cols = deriveColumns(displayRows, columns, 9, [
    ...(hideColumns ?? []),
    ...hiddenForClientAdmin,
    "config",
    "configs",
  ]);

  return (
    <>
      {typeof total === "number" ? (
        <p className="num text-xs text-muted-foreground">{total.toLocaleString("en-GB")} games</p>
      ) : null}
      <div className="panel overflow-hidden">
        <div className="w-full overflow-x-auto [-webkit-overflow-scrolling:touch]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface/60">
                {cols.map((col) => (
                  <th
                    key={col}
                    className="label-eyebrow whitespace-nowrap px-3 py-3 text-left font-normal sm:px-4"
                  >
                    {humanizeKey(col)}
                  </th>
                ))}
                {rowActions ? (
                  <th className="label-eyebrow whitespace-nowrap px-3 py-3 text-right font-normal sm:px-4">
                    Actions
                  </th>
                ) : null}
                <th className="w-10 px-2" />
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, index) => (
                <tr
                  key={index}
                  className="border-b border-border/60 transition-colors last:border-0 hover:bg-surface/40"
                >
                  {cols.map((col) => {
                    const raw = row[col];
                    const label = lookupLabel(col, raw, lookupMaps);
                    const renderer = cellRenderers?.[col];
                    const valueText = formatCellValue(raw, { useGrouping: !isIdKey(col) });
                    return (
                      <td key={col} className="whitespace-nowrap px-3 py-2.5 align-middle sm:px-4">
                        {renderer ? (
                          renderer(row)
                        ) : looksLikeStatus(col) ? (
                          <StatusPill value={raw} column={col} context={statusContext} />
                        ) : label ? (
                          <span
                            className="block max-w-[12rem] truncate sm:max-w-[22rem]"
                            title={`${label} · #${valueText}`}
                          >
                            {label}
                            <span className="num ml-1 text-[11px] text-muted-foreground">
                              #{valueText}
                            </span>
                          </span>
                        ) : (
                          <span
                            className={cn(
                              "block max-w-[12rem] truncate sm:max-w-[22rem]",
                              typeof raw === "number" && "num",
                              isIdKey(col) && "num text-primary",
                            )}
                            title={valueText}
                          >
                            {valueText}
                          </span>
                        )}
                      </td>
                    );
                  })}

                  {rowActions || (Array.isArray(row.slips) && row.slips.length > 0) ? (
                    <td
                      className="whitespace-nowrap px-3 py-2 text-right sm:px-4"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="flex justify-end gap-1.5">
                        {Array.isArray(row.slips) && row.slips.length > 0 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedSlips(
                                Array.isArray(row.slips) ? (row.slips as Dict[]) : null,
                              )
                            }
                            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                          >
                            View betslip
                          </button>
                        ) : null}
                        {rowActions ? rowActions(row) : null}
                      </div>
                    </td>
                  ) : null}
                  <td className="px-2 text-muted-foreground">
                    {!clientAdmin ? (
                      <button
                        type="button"
                        aria-label="Open record detail"
                        title="Open record detail"
                        onClick={() => setSelected(row)}
                        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
                      >
                        <ChevronRight className="size-4" strokeWidth={1.75} />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!clientAdmin ? (
        <>
          <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
            <SheetContent className="w-full overflow-y-auto border-border bg-card sm:max-w-xl">
              <SheetHeader>
                <SheetTitle className="font-display">Record detail</SheetTitle>
              </SheetHeader>
              <div className="space-y-3 px-4 pb-8">
                {selected
                  ? Object.entries(selected).map(([key, value]) => {
                      if (shouldSkipDetailField(key, value)) return null;
                      const label = lookupLabel(key, value, lookupMaps);
                      const status = statusMeta(key, value, statusContext);
                      const valueText = formatCellValue(value, { useGrouping: !isIdKey(key) });
                      if (!label && value && typeof value === "object") {
                        return (
                          <div key={key} className="border-b border-border/60 pb-2">
                            <p className="label-eyebrow">{humanizeKey(key)}</p>
                            <div className="mt-1.5 max-h-32 overflow-auto rounded-md border border-border bg-surface/50 p-2">
                              <ReadableValue value={value} />
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div key={key} className="border-b border-border/60 pb-2">
                          <p className="label-eyebrow">{humanizeKey(key)}</p>
                          <p className="num mt-1 break-all text-sm">
                            {label
                              ? `${label} · #${valueText}`
                              : status
                                ? `${status.label} (${valueText})`
                                : valueText}
                          </p>
                        </div>
                      );
                    })
                  : null}
              </div>
            </SheetContent>
          </Sheet>

          <Dialog
            open={Boolean(selectedSlips)}
            onOpenChange={(open) => !open && setSelectedSlips(null)}
          >
            <DialogContent
              className="max-h-[70vh] overflow-y-auto border-border bg-card sm:max-w-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <DialogHeader>
                <DialogTitle className="font-display">Betslip</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pb-2">
                {selectedSlips && selectedSlips.length > 0 ? (
                  selectedSlips.map((slip, index) => {
                    const summary = slipMatchSummary(slip);
                    return (
                      <div
                        key={String(slip.id ?? slip.bet_id ?? `${index}`)}
                        className="rounded-lg border border-border bg-surface/60 p-3"
                      >
                        <div className="mb-2 rounded-md border border-border/60 bg-background/50 px-2.5 py-2">
                          <p className="font-display text-sm font-semibold">Slip #{index + 1}</p>
                          {summary ? (
                            <>
                              <p className="mt-1 text-sm font-medium text-foreground">
                                {summary.heading}
                              </p>
                              {summary.subheading ? (
                                <p className="num text-xs text-muted-foreground">
                                  {summary.subheading}
                                </p>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                          {Object.entries(slip).map(([key, value]) => {
                            if (shouldSkipDetailField(key, value)) return null;
                            if (value === null || value === undefined || value === "") return null;
                            const valueText = formatCellValue(value, {
                              useGrouping: !isIdKey(key),
                            });
                            if (typeof value === "object") {
                              return (
                                <div
                                  key={key}
                                  className="rounded-md border border-border/60 bg-background/40 p-2"
                                >
                                  <p className="label-eyebrow">{humanizeKey(key)}</p>
                                  <div className="mt-1 max-h-24 overflow-auto rounded-md border border-border bg-surface/50 p-2">
                                    <ReadableValue value={value} />
                                  </div>
                                </div>
                              );
                            }
                            return (
                              <div
                                key={key}
                                className="rounded-md border border-border/60 bg-background/40 p-2"
                              >
                                <p className="label-eyebrow">{humanizeKey(key)}</p>
                                <p className="num mt-1 break-all text-sm">{valueText}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-muted-foreground">No slip data available.</p>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </>
  );
}
