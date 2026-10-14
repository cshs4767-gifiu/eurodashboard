import { Loader2, RotateCcw } from "lucide-react";
import type { FilterDef } from "@/lib/endpoints";
import type { QueryValue } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useReferenceStore } from "@/lib/stores/reference-store";
import { useAuth, useClientScope } from "@/lib/use-auth";
import { ReferenceSelect } from "./reference-select";
import { DateField } from "@/components/ui/date-field";
import { DateRangeField } from "@/components/ui/date-range-field";

export function FilterBar({
  filters,
  values,
  onChange,
  onReset,
  busy,
  locked,
}: {
  filters: FilterDef[];
  values: Record<string, QueryValue>;
  onChange: (name: string, value: string) => void;
  onReset: () => void;
  busy?: boolean;
  /** Filters pinned by the signed-in account's client scope. */
  locked?: string[];
}) {
  const { user } = useAuth();
  const scope = useClientScope(user);

  if (filters.length === 0) return null;

  const visibleFilters = filters.filter(
    (filter) => !(scope.clientAdmin && scope.singleClient && filter.type === "operator"),
  );

  const operatorSelected = filters
    .filter((filter) => filter.type === "operator")
    .some((filter) => String(values[filter.name] ?? "") !== "");
  const hasOperatorFilter = visibleFilters.some((filter) => filter.type === "operator");
  const hasGameFilter = visibleFilters.some((filter) => filter.type === "game");
  const hasPartnerFilter = filters.some((filter) => filter.type === "partner");
  const gameSelected = filters
    .filter((filter) => filter.type === "game")
    .some((filter) => String(values[filter.name] ?? "") !== "");

  const orderedFilters = [...visibleFilters].sort((a, b) => {
    const order = (filter: FilterDef) => {
      if (filter.name === "source") return 0;
      if (filter.type === "operator") return 1;
      if (filter.type === "game") return 2;
      if (filter.type === "partner") return 3;
      return 4;
    };
    return order(a) - order(b);
  });

  const hasRange =
    filters.some((f) => f.name === "date_from" && f.type === "date") &&
    filters.some((f) => f.name === "date_to" && f.type === "date");

  // When the bar has both a partner and a game filter, the game list is
  // narrowed to the selected partner's games.
  const partnerFilterName = filters.find((filter) => filter.type === "partner")?.name;
  const selectedPartnerId = partnerFilterName ? String(values[partnerFilterName] ?? "") : "";

  // When the partner changes, drop any selected game the new partner doesn't
  // offer. The store's game list is refreshed with partner_id first, so a
  // membership check against it answers "available for this partner".
  const handleChange = (name: string, value: string) => {
    onChange(name, value);

    const gameFilterNames = filters.filter((f) => f.type === "game").map((f) => f.name);
    if (name === "source") {
      const sourceValue = value.trim().toLowerCase();
      if (sourceValue) {
        for (const gameName of gameFilterNames) {
          onChange(gameName, "");
        }
      }
    }

    if (!partnerFilterName || name !== partnerFilterName) return;
    if (gameFilterNames.length === 0) return;
    void (async () => {
      const operatorId = scope.clientAdmin ? (scope.operatorId ?? undefined) : undefined;
      if (scope.clientAdmin && operatorId) {
        await useReferenceStore
          .getState()
          .refreshGamesForOperator(operatorId, "", 1, false, value || undefined);
      } else {
        await useReferenceStore.getState().refresh("game", "", 1, false, value || undefined);
      }
      if (!value) return;

      const gameState = useReferenceStore.getState().game;
      // Avoid clearing a valid game selection while the partner-scoped list is
      // still loading or hasn't resolved a fresh set of options yet.
      if (!gameState.loaded && gameState.loading) return;
      const available = new Set(gameState.options.map((o) => o.value));
      for (const gameName of gameFilterNames) {
        const current = String(values[gameName] ?? "");
        if (scope.clientAdmin) continue;
        if (current && gameState.loaded && !available.has(current)) onChange(gameName, "");
      }
    })();
  };

  const canShowGameFilter = (filter: FilterDef) => {
    if (filter.type !== "game") return true;
    // Partner filtering is optional for game lookups: users can search the
    // whole game catalog or narrow it only after choosing a partner.
    return true;
  };

  const operatorGamesPage =
    hasOperatorFilter &&
    filters.some((filter) => ["game_uuid", "game_name", "name"].includes(filter.name));

  return (
    <div className="panel grid grid-cols-1 items-end gap-3 p-3 sm:grid-cols-2 sm:p-4 lg:flex lg:flex-wrap">
      {orderedFilters
        .filter((filter) => !(hasRange && filter.name === "date_to"))
        .filter((filter) => {
          if (!canShowGameFilter(filter)) return false;

          // Show all filters by default so users can choose source, operator, game,
          // and other filters without a staged unlock flow.
          return true;
        })
        .map((filter) =>
          hasRange && filter.name === "date_from" ? (
            <div
              key="date-range"
              className="flex min-w-0 flex-col gap-1.5 lg:min-w-[16rem] lg:flex-1"
            >
              <label htmlFor="date-range" className="label-eyebrow">
                Date range
              </label>
              <DateRangeField
                id="date-range"
                from={String(values["date_from"] ?? "")}
                to={String(values["date_to"] ?? "")}
                disabled={locked?.includes("date_from")}
                onChange={(from, to) => {
                  onChange("date_from", from);
                  onChange("date_to", to);
                }}
              />
            </div>
          ) : (
            <div
              key={filter.name}
              className="flex min-w-0 flex-col gap-1.5 lg:min-w-[9.5rem] lg:flex-1"
            >
              <label htmlFor={filter.name} className="label-eyebrow">
                {filter.label}
                {locked?.includes(filter.name)
                  ? " · locked to your client"
                  : filter.required
                    ? " *"
                    : ""}
              </label>
              {filter.type === "operator" || filter.type === "game" || filter.type === "partner" ? (
                <ReferenceSelect
                  id={filter.name}
                  kind={filter.type}
                  required={filter.required}
                  disabled={locked?.includes(filter.name)}
                  operatorId={String(values["operator_id"] ?? "")}
                  catalog={filter.type === "game" ? (filter.catalog ?? false) : undefined}
                  value={String(values[filter.name] ?? "")}
                  onChange={(value) => handleChange(filter.name, value)}
                  sourceFilterValue={
                    filter.type === "game" ? String(values["source"] ?? "") : undefined
                  }
                  partnerFilter={filter.type === "game" && hasPartnerFilter}
                  showPartnerFilter={filter.type === "game"}
                  partnerFilterValue={
                    filter.type === "game" && hasPartnerFilter ? selectedPartnerId : undefined
                  }
                />
              ) : filter.type === "select" ? (
                <select
                  id={filter.name}
                  value={String(values[filter.name] ?? "")}
                  onChange={(event) => handleChange(filter.name, event.target.value)}
                  className="num h-9 rounded-md border border-input bg-surface px-2.5 text-sm outline-none focus:border-primary/70 focus:ring-2 focus:ring-ring"
                >
                  {(filter.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : filter.type === "date" ? (
                <DateField
                  id={filter.name}
                  value={String(values[filter.name] ?? "")}
                  disabled={locked?.includes(filter.name)}
                  placeholder={filter.placeholder ?? "Pick a date"}
                  onChange={(value) => handleChange(filter.name, value)}
                  className={cn(filter.required && "border-primary/40")}
                />
              ) : (
                <input
                  id={filter.name}
                  type={
                    filter.name === "player_id"
                      ? "text"
                      : filter.type === "number"
                        ? "number"
                        : "text"
                  }
                  value={String(values[filter.name] ?? "")}
                  placeholder={filter.placeholder}
                  disabled={locked?.includes(filter.name)}
                  onChange={(event) => handleChange(filter.name, event.target.value)}
                  className={cn(
                    "num h-9 rounded-md border border-input bg-surface px-2.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary/70 focus:ring-2 focus:ring-ring",
                    filter.required && "border-primary/40",
                  )}
                />
              )}
            </div>
          ),
        )}

      <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-1">
        {busy ? (
          <span className="inline-flex h-9 items-center gap-1.5 px-1 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
            Updating
          </span>
        ) : null}
        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <RotateCcw className="size-4" strokeWidth={1.75} />
          Reset
        </button>
      </div>
    </div>
  );
}
