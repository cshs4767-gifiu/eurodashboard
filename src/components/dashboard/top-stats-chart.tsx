import { useEffect } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { type Dict } from "@/lib/api";
import { useReferenceStore } from "@/lib/stores/reference-store";
import {
  type StatsFilters,
  type StatsMetricKey,
  metricOf,
  rowsFrom,
  useStatsTop,
} from "@/lib/stats";
import { formatCompact } from "@/lib/format";

type TopType = "operators" | "games" | "partners";

function labelFor(row: Dict, clientRows: Dict[] = []): string {
  for (const key of [
    "name",
    "client_name",
    "operator_name",
    "game_name",
    "partner_name",
    "label",
    "day",
    "date",
    "month",
    "period",
  ]) {
    const value = row[key];
    if (typeof value === "string" && value)
      return value.length > 18 ? `${value.slice(0, 17)}…` : value;
    if (typeof value === "number") return String(value);
  }

  const candidateIds = [row.client_id, row.operator_id, row.id, row.partner_id, row.game_id].filter(
    (value): value is string | number => value !== undefined && value !== null,
  );

  for (const candidateId of candidateIds) {
    const match = clientRows.find((client) => {
      const id = client.id ?? client.client_id ?? client.operator_id;
      return id !== undefined && id !== null && String(id) === String(candidateId);
    });
    if (match) {
      for (const key of ["name", "client_name", "operator_name", "title"]) {
        const value = match[key];
        if (typeof value === "string" && value) {
          return value.length > 18 ? `${value.slice(0, 17)}…` : value;
        }
      }
    }
  }

  const id = row.id ?? row.client_id ?? row.operator_id ?? row.game_id;
  return id !== undefined ? `#${String(id)}` : "—";
}

const LABEL_KEYS = new Set([
  "id",
  "operator_id",
  "partner_id",
  "game_id",
  "client_id",
  "period",
  "day",
  "date",
  "month",
]);

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

/**
 * Stats rows can nest the metric under totals -> currency, e.g.
 * { period, totals: { usd: { ggr: 787.07 } } }. Search depth-first for the
 * metric key, preferring USD totals, before falling back to any number.
 */
function valueFor(row: Dict, metric: StatsMetricKey): number {
  const found = metricOf(row, metric);
  if (found !== null) return found;
  for (const [key, value] of Object.entries(row)) {
    if (LABEL_KEYS.has(key)) continue;
    const num = toNumber(value);
    if (num !== null) return num;
  }
  return 0;
}

export function TopStatsChart({
  type,
  metric,
  dateFrom,
  dateTo,
  operatorId,
  partnerId,
  gameId,
  variant = "bar",
  direction = "desc",
  title,
}: {
  type: TopType;
  metric: StatsMetricKey;
  dateFrom: string;
  dateTo: string;
  operatorId?: number;
  partnerId?: number;
  gameId?: number;
  variant?: "bar" | "line";
  direction?: "asc" | "desc";
  title: string;
}) {
  const operatorList = useReferenceStore((state) => state.operator.rows);
  const ensureOperatorList = useReferenceStore((state) => state.ensure);

  useEffect(() => {
    void ensureOperatorList("operator");
  }, [ensureOperatorList]);

  const filters: StatsFilters = {
    dateFrom,
    dateTo,
    operatorId,
    partnerId,
    gameId,
  };
  const request = useStatsTop(type, metric, filters, 10, direction);

  const rows = rowsFrom(request.data ?? null);
  const data = rows.map((row) => ({
    label: labelFor(row, operatorList),
    value: valueFor(row, metric),
  }));

  return (
    <div className="panel p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-sm font-semibold">{title}</h3>
        <span className="label-eyebrow">{metric.replace(/_/g, " ")}</span>
      </div>

      <div className="mt-4 h-56">
        {request.isLoading ? (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">
            Loading…
          </div>
        ) : request.error ? (
          <div className="grid h-full place-items-center px-4 text-center text-xs text-destructive">
            {(request.error as Error).message}
          </div>
        ) : data.length === 0 ? (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">
            No data for this range
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {variant === "line" ? (
              <LineChart data={data} margin={{ left: -12, right: 8, top: 8 }}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={(value: number) => formatCompact(value)}
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            ) : (
              <BarChart data={data} margin={{ left: -12, right: 8, top: 8 }}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={44}
                />
                <YAxis
                  tickFormatter={(value: number) => formatCompact(value)}
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="value" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
