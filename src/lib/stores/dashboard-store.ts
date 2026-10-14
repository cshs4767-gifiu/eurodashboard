import { create } from "zustand";
import { persist } from "zustand/middleware";
import { todayISO } from "@/lib/format";

/**
 * Available `type` values for GET /api/v1/stats/top.
 * Mirrors the swagger enum: clients, games, operator-games, partners, days, months.
 */
export const STATS_TOP_TYPES = ["operators", "games", "partners"] as const;
export type StatsTopType = (typeof STATS_TOP_TYPES)[number];

/**
 * Available `metric` values for GET /api/v1/stats/*.
 * Mirrors the swagger enum: ggr, total_bets, total_stake, players, total_won, total_voided.
 */
export const STATS_METRICS = [
  "ggr",
  "bet_count",
  "stake",
  "players",
  "voided_bets",
  "rtp",
] as const;
export type StatsMetric = (typeof STATS_METRICS)[number];

export type ChartVariant = "bar" | "line";

export type ExplorerCard = {
  id: string;
  title: string;
  type: StatsTopType;
  metric: StatsMetric;
  variant: ChartVariant;
};

/** "all" = no operator filter, "operator" = a single operator is selected. */
export type ExplorerScope = "all" | "operator";

type DashboardFilters = {
  dateFrom: string;
  dateTo: string;
  /** Operator id as a string, empty means "all operators". Parsed to number in the API payload. */
  operatorId: string;
  /** Partner id as a string, empty means "all partners". */
  partnerId: string;
  /** Game id as a string, empty means "all games". */
  gameId: string;
  explorer: ExplorerCard[];
  explorerOperator: ExplorerCard[];
  setDateFrom: (value: string) => void;
  setDateTo: (value: string) => void;
  setOperatorId: (value: string) => void;
  setPartnerId: (value: string) => void;
  setGameId: (value: string) => void;
  setRange: (from: string, to: string) => void;
  updateCard: (scope: ExplorerScope, id: string, patch: Partial<Omit<ExplorerCard, "id">>) => void;

  addCard: (scope: ExplorerScope) => void;
  removeCard: (scope: ExplorerScope, id: string) => void;
  resetExplorer: (scope: ExplorerScope) => void;
  reset: () => void;
};

/** Which chart types make sense depending on whether one operator is selected. */
export const TYPES_BY_SCOPE: Record<ExplorerScope, readonly StatsTopType[]> = {
  all: STATS_TOP_TYPES,
  operator: ["games", "operators", "partners"],
};

const defaultExplorer = (): ExplorerCard[] => [
  { id: "c1", title: "Top operators by GGR", type: "operators", metric: "ggr", variant: "bar" },
  { id: "c2", title: "Top games by GGR", type: "games", metric: "ggr", variant: "bar" },
  { id: "c3", title: "Top partners by GGR", type: "partners", metric: "ggr", variant: "bar" },
  {
    id: "c4",
    title: "Top partners by players",
    type: "partners",
    metric: "players",
    variant: "bar",
  },
];

const defaultOperatorExplorer = (): ExplorerCard[] => [
  { id: "o1", title: "Top games by GGR", type: "games", metric: "ggr", variant: "bar" },
  { id: "o2", title: "Top games by stake", type: "games", metric: "stake", variant: "bar" },
  {
    id: "o3",
    title: "Top operators by players",
    type: "operators",
    metric: "players",
    variant: "bar",
  },
  { id: "o4", title: "Top partners by GGR", type: "partners", metric: "ggr", variant: "bar" },
];

const listKey = (scope: ExplorerScope): "explorer" | "explorerOperator" =>
  scope === "operator" ? "explorerOperator" : "explorer";

const defaultsFor = (scope: ExplorerScope) =>
  scope === "operator" ? defaultOperatorExplorer() : defaultExplorer();

/** Dashboards default to the current day instead of the full month. */
export const DEFAULT_RANGE_DAYS = 1;

const pad = (n: number) => String(n).padStart(2, "0");

/** Start/end ISO dates for a month offset back from the current one (0 = this month). */
export function monthRange(offset = 0): { from: string; to: string; label: string; key: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const last = end > today ? today : end;
  const iso = (d: Date) =>
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return {
    from: iso(start),
    to: iso(last),
    key: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}`,
    label: start.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

export const defaultDateFrom = () => todayISO();
export const defaultDateTo = () => todayISO();

const initial = () => ({
  dateFrom: defaultDateFrom(),
  dateTo: defaultDateTo(),
  operatorId: "",
  partnerId: "",
  gameId: "",
  explorer: defaultExplorer(),
  explorerOperator: defaultOperatorExplorer(),
});

export const useDashboardStore = create<DashboardFilters>()(
  persist(
    (set) => ({
      ...initial(),
      setDateFrom: (value) => set({ dateFrom: value }),
      setDateTo: (value) => set({ dateTo: value }),
      setOperatorId: (value) => set({ operatorId: value, gameId: "" }),
      setPartnerId: (value) => set({ partnerId: value }),
      setGameId: (value) => set({ gameId: value }),
      setRange: (from, to) => set({ dateFrom: from, dateTo: to }),
      updateCard: (scope, id, patch) =>
        set((state) => {
          const key = listKey(scope);
          return {
            [key]: state[key].map((card) => (card.id === id ? { ...card, ...patch } : card)),
          } as Partial<DashboardFilters>;
        }),
      addCard: (scope) =>
        set((state) => {
          const key = listKey(scope);
          return {
            [key]: [
              ...state[key],
              {
                id: `c${Date.now()}`,
                title: "New chart",
                type: "days" as StatsTopType,
                metric: "ggr" as StatsMetric,
                variant: "bar" as ChartVariant,
              },
            ],
          } as Partial<DashboardFilters>;
        }),
      removeCard: (scope, id) =>
        set((state) => {
          const key = listKey(scope);
          return {
            [key]: state[key].filter((card) => card.id !== id),
          } as Partial<DashboardFilters>;
        }),
      resetExplorer: (scope) =>
        set(() => ({ [listKey(scope)]: defaultsFor(scope) }) as Partial<DashboardFilters>),
      reset: () => set(initial()),
    }),

    {
      name: "bk-dashboard-filters",
      version: 7,
      // Only persist dates and explorer cards, not operator/partner/game filters.
      // This makes each page independent while keeping useful date range selections.
      partialize: (state) => ({
        dateFrom: state.dateFrom,
        dateTo: state.dateTo,
        explorer: state.explorer,
        explorerOperator: state.explorerOperator,
      }),
      // Dates always start on today, even for returning sessions.
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as object),
        dateFrom: defaultDateFrom(),
        dateTo: defaultDateTo(),
      }),
    },
  ),
);

/** Convert operatorId string → number for API payloads. */
export function parseOperatorId(value: string): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
