import { create } from "zustand";
import { apiRequest, normalizeList, metaNumber, tokenStore, type Dict } from "@/lib/api";
import { isClientAdmin, clientScope } from "@/lib/use-auth";

export type Option = { value: string; label: string };

export type Kind =
  | "operator"
  | "game"
  | "catalogGame"
  | "permission"
  | "role"
  | "partner"
  | "operatorFreebetGame"
  | "freebetCapabilityGame";

type ListState = {
  options: Option[];
  rows: Dict[];
  total: number | null;
  loading: boolean;
  error: string | null;
  loaded: boolean;
  promise: Promise<void> | null;
  page: number;
  perPage: number;
};

const emptyList = (): ListState => ({
  options: [],
  rows: [],
  total: null,
  loading: false,
  error: null,
  loaded: false,
  promise: null,
  page: 0,
  perPage: 0,
});

function toOptions(rows: Dict[], labelKeys: string[], kind: Kind): Option[] {
  const seen = new Set<string>();
  return rows
    .map((row) => {
      const id =
        kind === "game" ||
        kind === "catalogGame" ||
        kind === "operatorFreebetGame" ||
        kind === "freebetCapabilityGame"
          ? (row.game_id ??
            row.id ??
            row.partner_id ??
            row.operator_id ??
            row.permission_id ??
            row.role_id)
          : (row.partner_id ??
            row.id ??
            row.operator_id ??
            row.game_id ??
            row.permission_id ??
            row.role_id);
      if (id === undefined || id === null) return null;
      const baseLabel = labelKeys
        .map((key) => row[key])
        .find((value) => typeof value === "string" && value);
      let label = baseLabel ? String(baseLabel) : `#${id}`;

      if (kind === "partner") {
        const count =
          typeof row.total_games === "number"
            ? row.total_games
            : typeof row.games_count === "number"
              ? row.games_count
              : typeof row.partner_games_count === "number"
                ? row.partner_games_count
                : typeof row.game_count === "number"
                  ? row.game_count
                  : typeof row.total_games === "string" && /^\d+$/.test(row.total_games)
                    ? Number(row.total_games)
                    : typeof row.games_count === "string" && /^\d+$/.test(row.games_count)
                      ? Number(row.games_count)
                      : typeof row.partner_games_count === "string" &&
                          /^\d+$/.test(row.partner_games_count)
                        ? Number(row.partner_games_count)
                        : typeof row.game_count === "string" && /^\d+$/.test(row.game_count)
                          ? Number(row.game_count)
                          : undefined;
        if (typeof count === "number") {
          label = `${label} (${count} game${count === 1 ? "" : "s"})`;
        }
      }

      const value = String(id);
      if (seen.has(value)) return null;
      seen.add(value);
      return { value, label };
    })
    .filter((option): option is Option => option !== null)
    .sort((a, b) => a.label.localeCompare(b.label));
}

const CONFIG: Record<Kind, { path: string; perPage: number; labels: string[] }> = {
  operator: { path: "/api/v1/clients", perPage: 200, labels: ["name", "client_name", "email"] },
  // Client-admin screens must only show games available to their scoped operator.
  game: { path: "/api/v1/operator-games", perPage: 100, labels: ["game_name", "name", "master_game_name"] },
  permission: { path: "/api/v1/permissions", perPage: 500, labels: ["name", "slug"] },
  role: { path: "/api/v1/roles", perPage: 200, labels: ["name", "role_name", "slug"] },
  partner: { path: "/api/v1/partners", perPage: 200, labels: ["name", "partner_name"] },
  catalogGame: {
    path: "/api/v1/games",
    perPage: 100,
    labels: ["name", "game_name", "master_game_name"],
  },
  operatorFreebetGame: {
    path: "/api/v1/promotions/operator-game-freebets",
    perPage: 100,
    labels: ["game_name", "name"],
  },
  freebetCapabilityGame: {
    path: "/api/v1/promotions/freebet-capabilities",
    perPage: 2000,
    labels: ["game_name", "name"],
  },
};

const OPERATOR_GAMES_CONFIG = {
  path: "/api/v1/operator-games",
  perPage: 100,
  labels: ["game_name", "name", "master_game_name"],
};

type ReferenceStore = {
  operator: ListState;
  game: ListState;
  catalogGame: ListState;
  operatorFreebetGame: ListState;
  freebetCapabilityGame: ListState;
  permission: ListState;
  role: ListState;
  partner: ListState;
  gameScope: string | null;
  gamePartnerScope: string | null;
  freebetGameScope: string | null;
  freebetGamePartnerScope: string | null;
  ensure: (kind: Kind) => Promise<void>;
  refresh: (
    kind: Kind,
    searchText?: string,
    page?: number,
    append?: boolean,
    partnerId?: string,
    operatorId?: string,
  ) => Promise<void>;
  ensureGamesForOperator: (operatorId?: string, partnerId?: string) => Promise<void>;
  refreshGamesForOperator: (
    operatorId?: string,
    searchText?: string,
    page?: number,
    append?: boolean,
    partnerId?: string,
  ) => Promise<void>;
  ensureOperatorFreebetGamesForOperator: (operatorId?: string, partnerId?: string) => Promise<void>;
  refreshOperatorFreebetGamesForOperator: (
    operatorId?: string,
    searchText?: string,
    page?: number,
    append?: boolean,
    partnerId?: string,
  ) => Promise<void>;
};

export const useReferenceStore = create<ReferenceStore>((set, get) => {
  const inFlight = new Map<string, Promise<void>>();

  const dedupeRequest = <T>(key: string, runner: () => Promise<T>): Promise<T> => {
    const existing = inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = runner().finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, promise as Promise<void>);
    return promise;
  };

  const load = async (
    kind: Kind,
    searchText?: string,
    page = 1,
    append = false,
    partnerId?: string,
    operatorId?: string,
  ) => {
    const user = tokenStore.user ?? null;
    // Do not load reference lists until auth has hydrated from storage.
    if (!user) return;
    // Client-admin accounts are scoped to their operator/client and should not
    // preload platform-wide lists like operators, partners, roles, or permissions.
    if (
      isClientAdmin(user) &&
      (kind === "operator" || kind === "partner" || kind === "role" || kind === "permission")
    )
      return;
    // Reference lists are bearer-protected: skip silently when signed out so
    // the login screen never shows "Missing bearer token" warnings.
    if (!tokenStore.access) return;
    // Game reference lists are optional partner-scoped: by default they should
    // show the full catalogue, and a partner selection can narrow the search when
    // the user chooses it. This keeps the dropdown usable without forcing a
    // partner filter first.
    let cfg = CONFIG[kind];
    if (kind === "game") {
      const singleClientAdmin = isClientAdmin(user) && clientScope(user).mode === "single";
      // GET /api/v1/operator-games requires operator_id except for single-client admins.
      if (!operatorId && !singleClientAdmin) return;
      cfg = OPERATOR_GAMES_CONFIG;
    }
    if (kind === "catalogGame") cfg = CONFIG.catalogGame;
    const trimmed = searchText?.trim() ?? "";
    const shouldSearch = trimmed.length > 2;
    const query = { page } as Record<string, string | number>;
    // First page stays compact for a quick initial list. Once the user moves past
    // the first page, use a much larger page size to avoid the constant small-page
    // churn that otherwise produces many API calls.
    if (page === 1) query.per_page = cfg.perPage;
    else query.per_page = 3000;
    if (shouldSearch) {
      query.name = trimmed;
    }
    if ((kind === "game" || kind === "catalogGame") && partnerId) query.partner_id = partnerId;
    if (kind === "game" && operatorId) query.operator_id = operatorId;

    const requestKey = JSON.stringify({
      kind,
      path: cfg.path,
      name: trimmed,
      page,
      append,
      partnerId: partnerId ?? null,
      operatorId: operatorId ?? null,
      perPage: cfg.perPage,
    });

    return dedupeRequest(requestKey, async () => {
      set(
        (state) =>
          ({ [kind]: { ...state[kind], loading: true, error: null } }) as Partial<ReferenceStore>,
      );
      try {
        // Games have two sources: operator-scoped `/api/v1/operator-games` and
        // the global catalogue `/api/v1/games`. When loading the generic
        // reference list (no operator selected) use the global endpoint with
        // a modest page size and allow incremental load-more.
        // Use normal paginated requests for all reference lists. For games the
        // catalogue can be large; load the configured `perPage` and allow
        // incremental load-more behavior via the `append` flag.
        const payload = await apiRequest(cfg.path, { query });
        const normalized = normalizeList(payload);
        const rows = normalized.rows;
        const total = metaNumber(normalized.meta, [
          "total",
          "total_items",
          "count",
          "total_records",
        ]);
        const existing = append ? get()[kind].rows : [];
        const mergedRows = append ? [...existing, ...rows] : rows;
        const options = toOptions(mergedRows, cfg.labels, kind);
        set(
          () =>
            ({
              [kind]: {
                options,
                rows: mergedRows,
                total,
                loading: false,
                error: null,
                loaded: true,
                promise: null,
                page,
                perPage: cfg.perPage,
              },
              ...(kind === "game"
                ? {
                    gameScope: operatorId || null,
                    gamePartnerScope: partnerId || null,
                  }
                : {}),
            }) as Partial<ReferenceStore>,
        );
      } catch (error) {
        set(
          () =>
            ({
              [kind]: {
                options: [],
                rows: [],
                total: null,
                loading: false,
                error: error instanceof Error ? error.message : "Failed to load",
                loaded: false,
                promise: null,
                page: 0,
                perPage: 0,
              },
            }) as Partial<ReferenceStore>,
        );
      }
    });
  };

  const gameLabel = (row: Dict, nameById: Map<string, string>) => {
    const id = row.game_id ?? row.id;
    if (id === undefined || id === null) return null;
    const nested = (row.game ?? row.games) as Record<string, unknown> | undefined;
    const candidate =
      (typeof row.master_game_name === "string" && row.master_game_name) ||
      (typeof row.game_name === "string" && row.game_name) ||
      (typeof row.name === "string" && row.name) ||
      (nested && typeof nested.name === "string" && nested.name) ||
      nameById.get(String(id)) ||
      (typeof row.partner_game_name === "string" && row.partner_game_name) ||
      (typeof row.partner_game_id === "string" && row.partner_game_id) ||
      "";
    return { value: String(id), label: candidate ? String(candidate) : `#${id}` } as Option;
  };

  // Game dropdown reads operator-scoped `/api/v1/operator-games` when an
  // operator is selected; otherwise it loads the global catalogue from
  // `/api/v1/operator-games` — the per-operator game assignment endpoint.
  const loadGamesForOperator = async (
    operatorId?: string,
    searchText?: string,
    page = 1,
    append = false,
    partnerId?: string,
  ) => {
    const user = tokenStore.user ?? null;
    const singleClientAdmin = isClientAdmin(user) && clientScope(user).mode === "single";
    if (!tokenStore.access || (!operatorId && !singleClientAdmin)) return;
    const cfg = OPERATOR_GAMES_CONFIG;
    const trimmed = searchText?.trim() ?? "";
    const shouldSearch = trimmed.length > 2;
    const query: Record<string, string | number | undefined> = {
      page,
      ...(singleClientAdmin ? {} : { operator_id: operatorId || undefined }),
    };
    if (page === 1) query.per_page = cfg.perPage;
    else query.per_page = 3000;
    if (shouldSearch) {
      query.name = trimmed;
    }
    if (partnerId) query.partner_id = partnerId;

    const requestKey = JSON.stringify({
      kind: "operatorGame",
      scope: "operator",
      operatorId,
      partnerId: partnerId ?? null,
      name: trimmed,
      page,
      append,
    });

    return dedupeRequest(requestKey, async () => {
      set(
        (state) =>
          ({ game: { ...state.game, loading: true, error: null } }) as Partial<ReferenceStore>,
      );
      try {
        const payload = await apiRequest(cfg.path, { query });
        const normalized = normalizeList(payload);
        const rows = normalized.rows;
        const total = metaNumber(normalized.meta, [
          "total",
          "total_items",
          "count",
          "total_records",
        ]);

        const nameById = new Map<string, string>();
        for (const row of rows) {
          const id = row.game_id ?? row.id;
          const name =
            (typeof row.game_name === "string" && row.game_name) ||
            (typeof row.name === "string" && row.name);
          if (id !== undefined && id !== null && name) nameById.set(String(id), String(name));
        }

        const existing = append ? get().game.rows : [];
        const mergedRows = append ? [...existing, ...rows] : rows;
        const deduped = mergedRows.filter((row, index, array) => {
          const id = String(row.game_id ?? row.id ?? "");
          return (
            id && array.findIndex((item) => String(item.game_id ?? item.id ?? "") === id) === index
          );
        });
        const options = deduped
          .map((row) => gameLabel(row, nameById))
          .filter((o): o is Option => o !== null)
          .sort((a, b) => a.label.localeCompare(b.label));

        set(
          () =>
            ({
              game: {
                options,
                rows: deduped,
                total,
                loading: false,
                error: null,
                loaded: true,
                promise: null,
                page,
                perPage: cfg.perPage,
              },
              gameScope: operatorId || null,
              gamePartnerScope: partnerId || null,
            }) as Partial<ReferenceStore>,
        );
      } catch (error) {
        set(
          () =>
            ({
              game: {
                options: [],
                rows: [],
                total: null,
                loading: false,
                error: error instanceof Error ? error.message : "Failed to load",
                loaded: false,
                promise: null,
                page: 0,
                perPage: 0,
              },
              gameScope: operatorId || null,
              gamePartnerScope: partnerId || null,
            }) as Partial<ReferenceStore>,
        );
        throw error;
      }
    });
  };

  const loadOperatorFreebetGamesForOperator = async (
    operatorId?: string,
    searchText?: string,
    page = 1,
    append = false,
    partnerId?: string,
  ) => {
    const user = tokenStore.user ?? null;
    const singleClientAdmin = isClientAdmin(user) && clientScope(user).mode === "single";
    if (!tokenStore.access || (!operatorId && !singleClientAdmin)) return;
    const cfg = CONFIG.operatorFreebetGame;
    const trimmed = searchText?.trim() ?? "";
    const shouldSearch = trimmed.length > 2;
    const query: Record<string, string | number | undefined> = {
      page,
      ...(singleClientAdmin ? {} : { operator_id: operatorId || undefined }),
    };
    if (page === 1) query.per_page = cfg.perPage;
    else query.per_page = 3000;
    if (shouldSearch) query.name = trimmed;
    if (partnerId) query.partner_id = partnerId;

    const requestKey = JSON.stringify({
      kind: "operatorFreebetGame",
      scope: "operator",
      operatorId,
      partnerId: partnerId ?? null,
      name: trimmed,
      page,
      append,
    });

    return dedupeRequest(requestKey, async () => {
      set(
        (state) =>
          ({
            operatorFreebetGame: { ...state.operatorFreebetGame, loading: true, error: null },
          }) as Partial<ReferenceStore>,
      );
      try {
        const payload = await apiRequest(cfg.path, { query });
        const normalized = normalizeList(payload);
        const rows = normalized.rows;
        const total = metaNumber(normalized.meta, [
          "total",
          "total_items",
          "count",
          "total_records",
        ]);

        const nameById = new Map<string, string>();
        for (const row of rows) {
          const id = row.game_id ?? row.id;
          const name =
            (typeof row.game_name === "string" && row.game_name) ||
            (typeof row.name === "string" && row.name);
          if (id !== undefined && id !== null && name) nameById.set(String(id), String(name));
        }

        const existing = append ? get().operatorFreebetGame.rows : [];
        const mergedRows = append ? [...existing, ...rows] : rows;
        const deduped = mergedRows.filter((row, index, array) => {
          const id = String(row.game_id ?? row.id ?? "");
          return (
            id && array.findIndex((item) => String(item.game_id ?? item.id ?? "") === id) === index
          );
        });
        const options = deduped
          .map((row) => gameLabel(row, nameById))
          .filter((o): o is Option => o !== null)
          .sort((a, b) => a.label.localeCompare(b.label));

        set(
          () =>
            ({
              operatorFreebetGame: {
                options,
                rows: deduped,
                total,
                loading: false,
                error: null,
                loaded: true,
                promise: null,
                page,
                perPage: cfg.perPage,
              },
              freebetGameScope: operatorId || null,
              freebetGamePartnerScope: partnerId || null,
            }) as Partial<ReferenceStore>,
        );
      } catch (error) {
        set(
          () =>
            ({
              operatorFreebetGame: {
                options: [],
                rows: [],
                total: null,
                loading: false,
                error: error instanceof Error ? error.message : "Failed to load",
                loaded: false,
                promise: null,
                page: 0,
                perPage: 0,
              },
              freebetGameScope: operatorId || null,
              freebetGamePartnerScope: partnerId || null,
            }) as Partial<ReferenceStore>,
        );
        throw error;
      }
    });
  };

  return {
    operator: emptyList(),
    game: emptyList(),
    catalogGame: emptyList(),
    operatorFreebetGame: emptyList(),
    freebetCapabilityGame: emptyList(),
    permission: emptyList(),
    role: emptyList(),
    partner: emptyList(),
    gameScope: null,
    gamePartnerScope: null,
    freebetGameScope: null,
    freebetGamePartnerScope: null,
    ensure: (kind) => {
      const current = get()[kind] ?? emptyList();
      const user = tokenStore.user ?? null;
      if (
        isClientAdmin(user) &&
        (kind === "operator" || kind === "partner" || kind === "role" || kind === "permission")
      )
        return current.promise ?? Promise.resolve();
      if (kind === "game" || kind === "operatorFreebetGame") {
        const scopedOperator =
          kind === "operatorFreebetGame" ? get().freebetGameScope : get().gameScope;
        if (scopedOperator) {
          return kind === "operatorFreebetGame"
            ? loadOperatorFreebetGamesForOperator(scopedOperator)
            : loadGamesForOperator(scopedOperator);
        }
        // Operator-scoped game kinds need an operator to load. Without one the
        // bare endpoint returns unexpected results — wait for the mount effect
        // to supply the operator via refreshOperatorFreebetGamesForOperator.
        return current.promise ?? Promise.resolve();
      }
      if (current.loading || current.loaded) return current.promise ?? Promise.resolve();
      const promise = load(kind);
      set((state) => ({ [kind]: { ...state[kind], promise } }) as Partial<ReferenceStore>);
      return promise;
    },
    refresh: (kind, searchText, page = 1, append = false, partnerId?: string, operatorId?: string) => {
      if (kind === "game") {
        const scopedUser = tokenStore.user ?? null;
        const singleClientAdmin = isClientAdmin(scopedUser) && clientScope(scopedUser).mode === "single";
        if (operatorId || singleClientAdmin) {
          return loadGamesForOperator(operatorId, searchText, page, append, partnerId);
        }
        return Promise.resolve();
      }
      if (kind === "operatorFreebetGame") {
        return loadOperatorFreebetGamesForOperator(operatorId, searchText, page, append, partnerId);
      }
      return load(kind, searchText, page, append, partnerId, operatorId);
    },
    ensureGamesForOperator: async (operatorId?: string, partnerId?: string) => {
      const user = tokenStore.user ?? null;
      const singleClientAdmin = isClientAdmin(user) && clientScope(user).mode === "single";
      if (!operatorId && !singleClientAdmin) return;
      const state = get();
      const scopeKey = operatorId || "single-client-scope";
      if (
        state.gameScope === scopeKey &&
        state.gamePartnerScope === (partnerId || null) &&
        (state.game.loaded || state.game.loading)
      )
        return;
      await loadGamesForOperator(operatorId, undefined, 1, false, partnerId);
    },
    refreshGamesForOperator: (
      operatorId?: string,
      searchText?: string,
      page = 1,
      append = false,
      partnerId?: string,
    ) => loadGamesForOperator(operatorId, searchText, page, append, partnerId),
    ensureOperatorFreebetGamesForOperator: async (operatorId?: string, partnerId?: string) => {
      const user = tokenStore.user ?? null;
      const singleClientAdmin = isClientAdmin(user) && clientScope(user).mode === "single";
      if (!operatorId && !singleClientAdmin) return;
      const state = get();
      const scopeKey = operatorId || "single-client-scope";
      if (
        state.freebetGameScope === scopeKey &&
        state.freebetGamePartnerScope === (partnerId || null) &&
        (state.operatorFreebetGame.loaded || state.operatorFreebetGame.loading)
      )
        return;
      await loadOperatorFreebetGamesForOperator(operatorId, undefined, 1, false, partnerId);
    },
    refreshOperatorFreebetGamesForOperator: (
      operatorId?: string,
      searchText?: string,
      page = 1,
      append = false,
      partnerId?: string,
    ) => loadOperatorFreebetGamesForOperator(operatorId, searchText, page, append, partnerId),
  };
});

/**
 * Parse currency codes from a client row's default_currency + currency_list.
 * Supports strings ("KES,USD"), arrays, or JSON blobs.
 */
export function currenciesFromClient(row: Dict | undefined): string[] {
  if (!row) return [];
  const set = new Set<string>();
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) set.add(v.trim().toUpperCase());
  };
  push(row.default_currency);
  const list = row.currency_list;
  if (Array.isArray(list)) list.forEach(push);
  else if (typeof list === "string") {
    const trimmed = list.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) parsed.forEach(push);
      } catch {
        /* ignore */
      }
    } else {
      trimmed.split(/[,\s]+/).forEach(push);
    }
  }
  return Array.from(set);
}
