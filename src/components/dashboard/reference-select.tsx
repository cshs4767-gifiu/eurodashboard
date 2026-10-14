import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronDown, Loader2 } from "lucide-react";
import { apiRequest, normalizeList } from "@/lib/api";
import { useReferenceStore, type Kind } from "@/lib/stores/reference-store";
import { isClientAdmin, useAuth, useClientScope } from "@/lib/use-auth";
import { cn } from "@/lib/utils";

const clientOperatorOptions = (scope: ReturnType<typeof useClientScope>) =>
  scope.clientAdmin && scope.clients.length > 0
    ? scope.clients.map((client) => ({
        value: String(client.id),
        label: client.name || `Client #${client.id}`,
      }))
    : [];

export type Option = { value: string; label: string };

export function useReferenceOptions(
  kind: Kind,
  disabled?: boolean,
  operatorId?: string,
  active = true,
) {
  const { user } = useAuth();
  const state = useReferenceStore((s) => s[kind]);
  const ensure = useReferenceStore((s) => s.ensure);
  const loaded = state ? state.loaded : false;
  const loading = state ? state.loading : false;
  useEffect(() => {
    if (!user) return;
    if (isClientAdmin(user) && (kind === "operator" || kind === "partner" || kind === "role" || kind === "permission")) {
      return;
    }
    if (!active) return;
    if (
      kind === "game" ||
      kind === "operatorFreebetGame" ||
      kind === "catalogGame" ||
      kind === "freebetCapabilityGame"
    )
      return;
    if (loaded || loading) return;
    void ensure(kind);
  }, [kind, ensure, active, loaded, loading, user]);
  return (
    state ?? {
      options: [],
      rows: [],
      loading: false,
      error: null,
      loaded: false,
      promise: null,
      total: null,
      page: 0,
      perPage: 0,
    }
  );
}

function rowId(row: Record<string, unknown> | undefined, kind?: Kind) {
  if (!row) return undefined;
  // Game rows must prefer the actual game identifier. `partner_id` is only a
  // relationship key, not the unique record id we want to render in the list.
  if (
    (kind === "game" ||
      kind === "catalogGame" ||
      kind === "operatorFreebetGame" ||
      kind === "freebetCapabilityGame") &&
    row.game_id !== undefined &&
    row.game_id !== null
  )
    return row.game_id;
  if (row.id !== undefined && row.id !== null) return row.id;
  return row.game_id ?? row.partner_id ?? row.operator_id ?? row.permission_id ?? row.role_id;
}

function rowLabel(row: Record<string, unknown> | undefined, options: Option[], kind?: Kind) {
  if (!row) return "";
  const id = rowId(row, kind);
  const value = id === undefined || id === null ? "" : String(id);
  const opt = options.find((option) => option.value === value)?.label;
  if (opt) return opt;
  // Try to derive a friendly label directly from the row when options are
  // not available (e.g. API returned rows but options weren't built yet).
  if (
    kind === "game" ||
    kind === "catalogGame" ||
    kind === "operatorFreebetGame" ||
    kind === "freebetCapabilityGame"
  ) {
    const nested = (row.game ?? row.games) as Record<string, unknown> | undefined;
    const candidate =
      (typeof row.master_game_name === "string" && row.master_game_name) ||
      (typeof row.game_name === "string" && row.game_name) ||
      (typeof row.name === "string" && row.name) ||
      (nested && typeof nested.name === "string" && nested.name) ||
      (typeof row.partner_game_name === "string" && row.partner_game_name) ||
      (typeof row.partner_game_id === "string" && row.partner_game_id) ||
      "";
    if (candidate) return String(candidate);
  }
  return `#${value}`;
}

function filterRows(
  rows: Array<Record<string, unknown> | undefined>,
  options: Option[],
  query: string,
  groupBy?: string,
  kind?: Kind,
) {
  const lowerQuery = query.trim().toLowerCase();
  const matchedRows = rows.filter(
    (row): row is Record<string, unknown> => {
      if (!row) return false;
      if (!lowerQuery) return true;
      const label = rowLabel(row, options, kind).toLowerCase();
      if (label.includes(lowerQuery)) return true;
      if (groupBy) {
        const groupValue = row[groupBy];
        if (typeof groupValue === "string" && groupValue.toLowerCase().includes(lowerQuery))
          return true;
      }
      return false;
    },
  );

  if (!groupBy) {
    const seen = new Set<string>();
    const list: Option[] = [];
    for (const row of matchedRows) {
      const id = rowId(row, kind);
      if (id === undefined || id === null) continue;
      const value = String(id);
      if (seen.has(value)) continue;
      seen.add(value);
      list.push({ value, label: rowLabel(row, options, kind) });
    }
    return list;
  }

  const groups = new Map<string, { label: string; options: Option[] }>();
  const seenValues = new Set<string>();
  for (const row of matchedRows) {
    const id = rowId(row, kind);
    if (id === undefined || id === null) continue;
    const value = String(id);
    if (seenValues.has(value)) continue;
    seenValues.add(value);

    const rawGroup = row[groupBy];
    const fallbackGroup =
      groupBy !== "partner_name" && typeof row.partner_name === "string" && row.partner_name
        ? row.partner_name
        : undefined;
    const groupLabel =
      typeof rawGroup === "string" && rawGroup
        ? rawGroup
        : typeof fallbackGroup === "string" && fallbackGroup
          ? fallbackGroup
          : typeof row.partner_id === "number" || typeof row.partner_id === "string"
            ? String(row.partner_id)
            : "Other";
    const key = groupLabel || "Other";
    const group = groups.get(key) ?? { label: key, options: [] };
    group.options.push({ value, label: rowLabel(row, options, kind) });
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

export function ReferenceSelect({
  kind,
  id,
  value,
  onChange,
  className,
  required,
  operatorId,
  disabled,
  groupBy,
  extraGroup,
  multiple,
  values,
  onChangeMulti,
  sourceFilterValue,
  partnerFilter,
  partnerFilterValue,
  partnerScope,
  showPartnerFilter,
  catalog,
}: {
  kind: Kind;
  id?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  required?: boolean;
  operatorId?: string;
  disabled?: boolean;
  groupBy?: string;
  /** Extra, non-API options rendered as their own group at the top of the list. */
  extraGroup?: { label: string; options: Option[] };
  /** Render checkboxes so several records can be picked at once. */
  multiple?: boolean;
  values?: string[];
  onChangeMulti?: (value: string[]) => void;
  /** When the parent game filter is scoped by source, limit the dropdown rows to the chosen source. */
  sourceFilterValue?: string;
  /** Show a "Filter by partner" picker above the list (game lists only). */
  partnerFilter?: boolean;
  partnerFilterValue?: string;
  /** Narrow the game list to one partner without rendering a partner picker. */
  partnerScope?: string;
  /** Render a partner selector inside the dropdown even when the page does not require partner-first filtering. */
  showPartnerFilter?: boolean;
  /** Force game lists to use the operator-scoped games API instead of the global catalog. */
  catalog?: boolean;
}) {
  const allowCatalogFallback = catalog ?? false;
  // Game dropdowns should default to the operator-scoped API and only use the
  // global catalogue when a caller explicitly opts in with `catalog: true`.
  const isGameKind =
    kind === "game" ||
    kind === "catalogGame" ||
    kind === "operatorFreebetGame" ||
    kind === "freebetCapabilityGame";
  const { user } = useAuth();
  const scope = useClientScope(user);
  const suppressPartnerFilter = Boolean(scope.clientAdmin);
  const clientOperatorList = useMemo(() => clientOperatorOptions(scope), [scope]);
  const [partnerFilterId, setPartnerFilterId] = useState(partnerFilterValue ?? partnerScope ?? "");
  const partnerScopeActive = partnerScope !== undefined && partnerScope !== "";
  const partnerScoped =
    !suppressPartnerFilter &&
    (!!partnerFilter || !!showPartnerFilter || partnerScopeActive);
  const hasPartnerSelection = Boolean(partnerFilterId || partnerScope);
  const sourceValue = String(sourceFilterValue ?? "").trim().toLowerCase();
  const inHousePartnerScope =
    isGameKind && sourceValue === "in_house" ? "0" : partnerFilterId || undefined;
  const singleOperatorClientAdmin = scope.clientAdmin && scope.mode === "single";
  const effectiveOperatorId =
    operatorId || (scope.clientAdmin ? (scope.operatorId ?? undefined) : undefined);
  const useCatalogGameSource = kind === "catalogGame" || (kind === "game" && allowCatalogFallback);
  const dataKind: Kind = useCatalogGameSource ? "catalogGame" : kind;
  const [open, setOpen] = useState(false);
  const partnerFilterRequired =
    !multiple &&
    !!partnerFilter &&
    !showPartnerFilter &&
    !partnerScopeActive &&
    !partnerFilterId &&
    partnerScoped &&
    !effectiveOperatorId;
  const shouldLoad =
    !isGameKind ||
    !partnerScoped ||
    Boolean(effectiveOperatorId) ||
    !partnerFilterId ||
    singleOperatorClientAdmin ||
    !partnerFilterRequired;
  const query = useReferenceOptions(dataKind, disabled, effectiveOperatorId, shouldLoad);
  const listRef = useRef<HTMLDivElement | null>(null);
  const scopeKey = scope.ids.join(",");
  // Client admins may only pick the operators assigned to their account.
  const scopedRows = useMemo(() => {
    if (kind !== "operator" || !scope.clientAdmin || scope.ids.length === 0) return query.rows;
    const allowed = new Set(scopeKey.split(",").filter(Boolean));
    return query.rows.filter((row) => allowed.has(String(row.id ?? row.operator_id ?? "")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.rows, kind, scope.clientAdmin, scopeKey]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);
  const lastRequestRef = useRef<string>("");
  const refresh = useReferenceStore((s) => s.refresh);
  const refreshGamesForOperator = useReferenceStore((s) => s.refreshGamesForOperator);
  const refreshOperatorFreebetGamesForOperator = useReferenceStore(
    (s) => s.refreshOperatorFreebetGamesForOperator,
  );

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  const requirePartnerFirst =
    kind !== "operatorFreebetGame" &&
    kind !== "catalogGame" &&
    isGameKind &&
    partnerFilterRequired;
  const needsOperatorFirst =
    isGameKind &&
    !useCatalogGameSource &&
    kind !== "freebetCapabilityGame" &&
    !effectiveOperatorId &&
    !singleOperatorClientAdmin;

  const runFetch = (signature: string, fetcher: () => void) => {
    if (lastRequestRef.current === signature) return;
    lastRequestRef.current = signature;
    fetcher();
  };

  const fetchGamePage = (page: number, append: boolean) => {
    const term = debouncedSearch.trim();
    if (term.length > 0 && term.length <= 2) return;
    const partnerId = inHousePartnerScope;
    const operatorScope = effectiveOperatorId || (singleOperatorClientAdmin ? "single-client-scope" : undefined);

    if (kind === "freebetCapabilityGame") {
      void refresh("freebetCapabilityGame", term, page, append, partnerId);
      return;
    }
    if (kind === "operatorFreebetGame") {
      if (!operatorScope) return;
      void refreshOperatorFreebetGamesForOperator(effectiveOperatorId, term, page, append, partnerId);
      return;
    }
    if (useCatalogGameSource) {
      void refresh("catalogGame", term, page, append, partnerId);
      return;
    }
    if (operatorScope) {
      void refreshGamesForOperator(effectiveOperatorId, term, page, append, partnerId);
    }
  };

  useEffect(() => {
    if (suppressPartnerFilter) {
      setPartnerFilterId("");
      return;
    }
    if (partnerScope !== undefined) {
      setPartnerFilterId(partnerScope);
      return;
    }
    const hasPartnerSelector = Boolean(partnerFilter || showPartnerFilter);
    if (!hasPartnerSelector) return;
    if (!partnerFilterValue) {
      setPartnerFilterId("");
      return;
    }
    setPartnerFilterId(partnerFilterValue);
  }, [suppressPartnerFilter, partnerFilter, showPartnerFilter, partnerFilterValue, partnerScope]);

  useEffect(() => {
    if (disabled) return;
    if (requirePartnerFirst || needsOperatorFirst) return;
    const needsData = open || required || Boolean(value) || (multiple && (values?.length ?? 0) > 0);
    if (!needsData) return;
    const term = debouncedSearch.trim();
    if (term.length > 0 && term.length <= 2) return;

    if (!isGameKind) {
      if (!open && query.loaded && !term) return;
      runFetch(`${kind}:${term}:1`, () => void refresh(kind, term, 1, false));
      return;
    }

    const signature = JSON.stringify({
      kind: dataKind,
      term,
      operatorId: effectiveOperatorId ?? "",
      partnerId: inHousePartnerScope ?? "",
      catalog: useCatalogGameSource,
      page: 1,
    });
    runFetch(signature, () => fetchGamePage(1, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    required,
    value,
    disabled,
    kind,
    dataKind,
    isGameKind,
    useCatalogGameSource,
    effectiveOperatorId,
    singleOperatorClientAdmin,
    debouncedSearch,
    inHousePartnerScope,
    requirePartnerFirst,
    needsOperatorFirst,
    multiple,
  ]);

  useEffect(() => {
    const el = listRef.current;
    if (!open || !el || !isGameKind || query.loading || !query.total) return;
    const shouldLoadMore =
      el.scrollTop + el.clientHeight >= el.scrollHeight - 48 &&
      (Array.isArray(query.rows) ? query.rows.length : 0) < query.total;
    if (!shouldLoadMore) return;
    fetchGamePage((query.page || 0) + 1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    isGameKind,
    query.loading,
    query.total,
    query.page,
    query.rows,
    debouncedSearch,
    kind,
    effectiveOperatorId,
    inHousePartnerScope,
  ]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!query.error) return;
    const msg = String(query.error);
    if (kind === "operator" && /(Network error|API is unreachable)/i.test(msg)) {
      const timer = setTimeout(() => {
        try {
          window.location.reload();
        } catch (err) {
          // ignore
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [query.error, kind]);

  const baseOptions = Array.isArray(query.options) ? query.options : [];
  const safeOptions =
    kind === "operator" && scope.clientAdmin && clientOperatorList.length > 0
      ? clientOperatorList
      : baseOptions;
  const selected = safeOptions.find((option) => option.value === value);
  const placeholder =
    kind === "operator"
      ? "Select operator"
      : kind === "partner"
        ? "Select partner group"
        : needsOperatorFirst
          ? "Select an operator first"
          : kind === "game" || kind === "catalogGame" || kind === "freebetCapabilityGame"
            ? "Select a game"
            : kind === "role"
              ? "Select role"
              : "Select permission";

  // Optional "filter by partner" picker: narrows the game rows to one partner.
  const partnerState = useReferenceStore((s) => s.partner);
  const ensurePartners = useReferenceStore((s) => s.ensure);
  useEffect(() => {
    if (!partnerScoped || disabled) return;
    void ensurePartners("partner");
  }, [partnerScoped, disabled, ensurePartners]);

  const safeScopedRows = Array.isArray(scopedRows) ? scopedRows : [];
  const partnerOptions = Array.isArray(partnerState?.options) ? partnerState.options : [];

  const partnerScopedRows = useMemo(() => {
    const selectedPartner = partnerOptions.find((option) => option.value === partnerFilterId);
    const selectedPartnerName = selectedPartner?.label?.trim().toLowerCase() ?? "";

    // The API already narrows game lists by partner_id, and rows don't always
    // carry partner_id/partner_name — so never re-filter them client-side.
    const clientFiltered =
      !partnerScoped || !partnerFilterId
        ? safeScopedRows
        : safeScopedRows.filter((row) => {
            if (!row) return false;
            const rowPartnerId = row.partner_id;
            const rowPartnerName =
              typeof row.partner_name === "string" ? row.partner_name.trim().toLowerCase() : "";
            const matchesId =
              rowPartnerId !== undefined &&
              rowPartnerId !== null &&
              String(rowPartnerId) === String(partnerFilterId);
            const matchesName =
              selectedPartnerName !== "" &&
              rowPartnerName &&
              rowPartnerName === selectedPartnerName;
            return matchesId || matchesName;
          });
    // Rows that expose partner information can be trusted: if none of them
    // belong to the selected partner, the partner truly has no games and the
    // list stays empty. Only fall back to the unfiltered rows when the API
    // returns no partner information at all.
    const rowsCarryPartnerInfo = safeScopedRows.some(
      (row) =>
        !!row &&
        ((row.partner_id !== undefined && row.partner_id !== null) ||
          (typeof row.partner_name === "string" && row.partner_name.trim() !== "")),
    );
    const rows =
      isGameKind &&
      partnerScoped &&
      partnerFilterId &&
      clientFiltered.length === 0 &&
      !rowsCarryPartnerInfo
        ? safeScopedRows
        : clientFiltered;

    // The API request is already narrowed to the relevant source scope (for
    // in-house games this is `partner_id=0`). Re-filtering the fetched rows here
    // causes the UI to drop valid entries even when the backend returned all 14.
    return [...rows].sort((a, b) => {
      const aLabel = rowLabel(a, safeOptions, kind).toLocaleLowerCase();
      const bLabel = rowLabel(b, safeOptions, kind).toLocaleLowerCase();
      return aLabel.localeCompare(bLabel);
    });
  }, [
    safeScopedRows,
    partnerScoped,
    partnerFilterId,
    safeOptions,
    kind,
    isGameKind,
    partnerOptions,
    sourceFilterValue,
  ]);

  const filtered = useMemo(() => {
    const result = filterRows(partnerScopedRows, safeOptions, search, groupBy, kind);
    if (!groupBy) return [...(result as Option[])].sort((a, b) => a.label.localeCompare(b.label));
    return (result as Array<{ label: string; options: Option[] }>).map((group) => ({
      ...group,
      options: [...group.options].sort((a, b) => a.label.localeCompare(b.label)),
    }));
  }, [partnerScopedRows, safeOptions, search, groupBy, kind]);

  const options = useMemo(
    () => (!groupBy ? (filtered as Option[]) : ([] as Option[])),
    [filtered, groupBy],
  );

  const groups = useMemo(
    () => (groupBy ? (filtered as Array<{ label: string; options: Option[] }>) : []),
    [filtered, groupBy],
  );

  const extra = useMemo(() => {
    if (!extraGroup) return null;
    const q = search.trim().toLowerCase();
    const options = q
      ? extraGroup.options.filter(
          (o) => o.label.toLowerCase().includes(q) || extraGroup.label.toLowerCase().includes(q),
        )
      : extraGroup.options;
    return options.length > 0
      ? {
          label: extraGroup.label,
          options: [...options].sort((a, b) => a.label.localeCompare(b.label)),
        }
      : null;
  }, [extraGroup, search]);

  const visibleCount = groupBy
    ? groups.reduce((sum, group) => sum + group.options.length, 0)
    : options.length;

  const multiValues = useMemo(() => (multiple ? (values ?? []) : []), [multiple, values]);
  const selectedSet = useMemo(() => new Set(multiValues), [multiValues]);
  const allVisibleSelected =
    Boolean(multiple) &&
    !groupBy &&
    options.length > 0 &&
    options.every((option) => selectedSet.has(option.value));
  const fetchAllSelectableValues = async () => {
    if (!isGameKind || !multiple) return [] as string[];

    const targetKind =
      kind === "game" && !effectiveOperatorId && !hasPartnerSelection && !scope.clientAdmin
        ? "catalogGame"
        : kind;
    const useCatalogEndpoint =
      targetKind === "catalogGame" ||
      (kind === "game" && !effectiveOperatorId && !scope.clientAdmin && !hasPartnerSelection);
    const endpoint = useCatalogEndpoint ? "/api/v1/games" : "/api/v1/operator-games";
    const queryParams: Record<string, string | number> = { page: 1, per_page: 100000 };
    if (effectiveOperatorId) queryParams.operator_id = effectiveOperatorId;
    const partnerScopeValue = partnerFilterId || partnerScope || "";
    if (partnerScopeValue) queryParams.partner_id = partnerScopeValue;
    const term = search.trim();
    if (term.length > 2) {
      queryParams.name = term;
    }

    try {
      const payload = await apiRequest(endpoint, { query: queryParams });
      const rows = Array.isArray(normalizeList(payload).rows) ? normalizeList(payload).rows : [];
      const values = rows
        .map((row) =>
          row.game_id ?? row.id ?? row.partner_id ?? row.operator_id ?? row.permission_id ?? row.role_id,
        )
        .filter((id): id is string | number => id !== undefined && id !== null)
        .map(String);
      return Array.from(new Set(values));
    } catch {
      return options.map((option) => option.value);
    }
  };
  const toggleAll = async () => {
    if (!onChangeMulti || !multiple || groupBy) return;

    const targetValues = isGameKind
      ? await fetchAllSelectableValues()
      : options.map((option) => option.value);

    if (targetValues.length === 0) return;

    const next = new Set(multiValues);
    const shouldClear = targetValues.every((value) => next.has(value));
    if (shouldClear) {
      for (const value of targetValues) next.delete(value);
    } else {
      for (const value of targetValues) next.add(value);
    }
    onChangeMulti(Array.from(next));
  };
  const toggleValue = (v: string) => {
    if (!onChangeMulti) return;
    const next = new Set(selectedSet);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChangeMulti(Array.from(next));
  };
  const labelFor = (v: string) =>
    safeOptions.find((o) => o.value === v)?.label ??
    extraGroup?.options.find((o) => o.value === v)?.label ??
    `#${v}`;

  // When the list is narrowed to one partner, a selected game the partner
  // doesn't offer must not linger as a stale label — it reads as cleared.
  const selectedRowFallback =
    !selected &&
    value &&
    Array.isArray(query.rows)
      ? query.rows.find((row) => {
          if (!row) return false;
          return (
            String(row.game_id ?? row.id ?? row.partner_id ?? row.operator_id ?? row.permission_id ?? row.role_id) ===
            String(value)
          );
        })
      : undefined;
  const notAvailableForPartner =
    partnerScoped &&
    !!partnerFilterId &&
    !!value &&
    query.loaded &&
    !safeOptions.some((option) => option.value === value);
  const selectedRowLabel = selectedRowFallback
    ? rowLabel(selectedRowFallback, safeOptions, kind)
    : extraGroup?.options.find((o) => o.value === value)?.label ?? (value ? String(value) : "");
  const singleLabel = notAvailableForPartner
    ? ""
    : selected?.label ?? selectedRowLabel;
  const selectedLabel = multiple
    ? multiValues.length === 0
      ? ""
      : multiValues.length <= 2
        ? multiValues.map(labelFor).join(", ")
        : `${multiValues.length} selected`
    : singleLabel;
  const emptyMessage = query.loading ? "Loading…" : "No results found.";

  const renderOption = (option: Option) =>
    multiple ? (
      <label
        key={option.value}
        className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent/50"
      >
        <input
          type="checkbox"
          className="size-4 accent-[var(--color-primary)]"
          checked={selectedSet.has(option.value)}
          onChange={() => toggleValue(option.value)}
        />
        <span className="truncate">{option.label}</span>
      </label>
    ) : (
      <button
        key={option.value}
        type="button"
        onClick={() => {
          onChange(option.value);
          setOpen(false);
        }}
        className={cn(
          "flex w-full items-center rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/50",
          value === option.value && "bg-primary/10",
        )}
      >
        {option.label}
      </button>
    );

  return (
    <div className={cn("relative flex flex-col gap-1", className)} ref={ref}>
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-busy={query.loading}
        aria-disabled={disabled || query.loading || requirePartnerFirst}
        disabled={disabled || query.loading || requirePartnerFirst}
        onClick={() => {
          if (disabled || query.loading || requirePartnerFirst) return;
          setOpen((current) => !current);
        }}
        className={cn(
          "num flex h-9 w-full items-center justify-between rounded-md border bg-surface px-3 text-sm text-left outline-none transition-colors focus:border-primary/70 focus:ring-2 focus:ring-ring",
          required && !value && "border-primary/40",
          (disabled || query.loading) && "cursor-not-allowed opacity-60",
        )}
      >
        <span
          className={cn("truncate", !selectedLabel && !query.loading && "text-muted-foreground")}
        >
          {query.loading ? "Loading…" : selectedLabel || placeholder}
        </span>
        <ChevronDown className="h-4 w-4 opacity-70" />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-input bg-surface shadow-xl">
          {isGameKind && (partnerFilter || showPartnerFilter) && !scope.clientAdmin ? (
            <div className="flex items-center gap-2 border-b border-muted/20 px-2 py-2">
              <label className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Partner
              </label>
              <select
                value={partnerFilterId}
                onChange={(event) => setPartnerFilterId(event.target.value)}
                className="h-8 w-full rounded-md border border-input bg-surface px-2 text-xs outline-none focus:border-primary/70 focus:ring-2 focus:ring-ring"
              >
                <option value="">All</option>
                {partnerOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="flex items-center justify-between border-b border-muted/20 px-2 py-2">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Search ${placeholder.toLowerCase()}...`}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:border-primary/70 focus:ring-0"
              />
            </div>
            {multiple && !groupBy && options.length > 0 ? (
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs font-medium text-primary hover:text-primary/80"
              >
                {allVisibleSelected ? "Clear all" : "Select all"}
              </button>
            ) : isGameKind && !query.loading && typeof query.total === "number" ? (
              <div className="ml-3 text-xs text-muted-foreground">
                {query.total.toLocaleString("en-GB")} games
              </div>
            ) : null}
          </div>

          <div ref={listRef} className="max-h-64 overflow-y-auto px-1 py-1">
            {extra ? (
              <div className="space-y-1 py-1">
                <div className="px-3 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  {extra.label}
                </div>
                {extra.options.map((option) => renderOption(option))}
              </div>
            ) : null}
            {query.loading && visibleCount === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">Loading…</p>
            ) : groupBy ? (
              groups.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">{emptyMessage}</p>
              ) : (
                groups.map((group) => (
                  <div key={group.label} className="space-y-1 py-1">
                    <div className="px-3 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      {group.label}
                    </div>
                    <div className="space-y-1">
                      {group.options.map((option) => renderOption(option))}
                    </div>
                  </div>
                ))
              )
            ) : options.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">{emptyMessage}</p>
            ) : (
              <>
                {options.map((option) => renderOption(option))}
                {!isGameKind &&
                typeof query.total === "number" &&
                query.page > 0 &&
                query.perPage > 0 &&
                (Array.isArray(query.rows) ? query.rows.length : 0) < (query.total ?? 0) ? (
                  <div className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        const term = search.trim();
                        if (term.length > 0 && term.length <= 2) return;
                        const next = (query.page || 0) + 1;
                        if (isGameKind) {
                          if (
                            (kind === "game" || kind === "operatorFreebetGame") &&
                            operatorId &&
                            operatorScoped
                          ) {
                            if (kind === "operatorFreebetGame") {
                              void refreshOperatorFreebetGamesForOperator(
                                operatorId,
                                term,
                                next,
                                true,
                                partnerFilterId || undefined,
                              );
                              return;
                            }
                            void refreshGamesForOperator(
                              operatorId,
                              term,
                              next,
                              true,
                              partnerFilterId || undefined,
                            );
                            return;
                          }
                          void refresh(
                            kind,
                            term,
                            next,
                            true,
                            partnerFilterId || undefined,
                            effectiveOperatorId,
                          );
                          return;
                        }
                        void refresh(kind, term, next, true);
                      }}
                      className="text-sm text-primary"
                    >
                      Load more
                    </button>
                  </div>
                ) : null}
              </>
            )}
            {query.loading ? (
              <p className="px-3 py-2 text-center text-xs text-muted-foreground">Loading…</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {query.error &&
      !/(operator_id is required)/i.test(query.error) &&
      !(kind === "operator" && scope.clientAdmin) &&
      !(kind === "operator" && /(Network error|API is unreachable)/i.test(String(query.error))) ? (
        <p className="text-[11px] text-warning">
          Could not load {kind} list — {query.error}
        </p>
      ) : null}
    </div>
  );
}

export function MultiReferenceSelect({
  kind,
  id,
  value,
  onChange,
  className,
}: {
  kind: Kind;
  id?: string;
  value: string[];
  onChange: (value: string[]) => void;
  className?: string;
}) {
  const { user } = useAuth();
  const scope = useClientScope(user);
  const [open, setOpen] = useState(false);
  const query = useReferenceOptions(kind, false, undefined, open || value.length > 0);
  const options =
    kind === "operator" && scope.clientAdmin && scope.clients.length > 0
      ? clientOperatorOptions(scope)
      : Array.isArray(query.options)
        ? query.options
        : [];
  const selected = new Set(value);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  // Preserve the user's active search text while the dropdown is mounted; do not
  // clear it just because a parent rerender or reopen causes the panel to re-render.

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!query.error) return;
    const msg = String(query.error);
    if (kind === "operator" && /(Network error|API is unreachable)/i.test(msg)) {
      const timer = setTimeout(() => {
        try {
          window.location.reload();
        } catch (err) {
          // ignore
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [query.error, kind]);

  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(Array.from(next));
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => option.label.toLowerCase().includes(q));
  }, [options, search]);

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((option) => selected.has(option.value));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allVisibleSelected) {
      for (const option of filtered) next.delete(option.value);
    } else {
      for (const option of filtered) next.add(option.value);
    }
    onChange(Array.from(next));
  };

  const summary =
    value.length === 0
      ? `Select ${kind}s`
      : value.length <= 2
        ? options
            .filter((option) => selected.has(option.value))
            .map((option) => option.label)
            .join(", ") || `${value.length} selected`
        : `${value.length} selected`;

  return (
    <div className={cn("relative flex flex-col gap-1", className)} ref={ref} id={id}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={query.loading}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "num flex h-9 w-full items-center justify-between rounded-md border border-input bg-surface px-3 text-left text-sm outline-none transition-colors focus:border-primary/70 focus:ring-2 focus:ring-ring",
          query.loading && "cursor-not-allowed opacity-60",
        )}
      >
        <span className={cn("truncate", value.length === 0 && "text-muted-foreground")}>
          {query.loading ? "Loading…" : summary}
        </span>
        <ChevronDown className="h-4 w-4 opacity-70" />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-input bg-surface shadow-xl">
          <div className="flex items-center gap-2 border-b border-muted/20 px-2 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search..."
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:border-primary/70 focus:ring-0"
            />
          </div>
          <div className="border-b border-muted/20 px-2 py-2">
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs font-medium text-primary hover:text-primary/80"
            >
              {allVisibleSelected ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto px-1 py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">No results found.</p>
            ) : (
              filtered.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-sm hover:bg-accent/50"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-primary)]"
                    checked={selected.has(option.value)}
                    onChange={() => toggle(option.value)}
                  />
                  <span className="truncate">{option.label}</span>
                </label>
              ))
            )}
          </div>
        </div>
      ) : null}
      {query.error &&
      !/(operator_id is required)/i.test(query.error) &&
      !(kind === "operator" && scope.clientAdmin) &&
      !(kind === "operator" && /(Network error|API is unreachable)/i.test(String(query.error))) ? (
        <p className="mt-1 text-[11px] text-warning">
          Could not load {kind} list — {query.error}
        </p>
      ) : null}
    </div>
  );
}
