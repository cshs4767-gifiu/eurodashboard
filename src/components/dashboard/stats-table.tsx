import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { formatCompact, formatNumberValue } from "@/lib/format";
import {
  type StatsFilters,
  labelOf,
  metricOf,
  rowsFrom,
  useStatsTop,
  errorMessage,
  type StatsMetricKey,
  type TopType,
} from "@/lib/stats";

const METRIC_COLUMNS: { key: StatsMetricKey; label: string }[] = [
  { key: "ggr", label: "GGR" },
  { key: "stake", label: "Stake" },
  { key: "total_bets", label: "Bets" },
  { key: "players", label: "Players" },
];

export function StatsTable({
  type,
  metric,
  filters,
  limit = 10,
  direction = "desc",
  title,
  loading = false,
}: {
  type: TopType;
  metric: StatsMetricKey;
  filters: StatsFilters;
  limit?: number;
  direction?: "asc" | "desc";
  title: string;
  loading?: boolean;
}) {
  const request = useStatsTop(type, metric, filters, limit, direction);
  const rows = useMemo(() => rowsFrom(request.data), [request.data]);

  const error = errorMessage(request.error);

  if (loading || request.isLoading) {
    return (
      <div className="panel p-4">
        <h3 className="font-display text-sm font-semibold mb-3">{title}</h3>
        <div className="space-y-1.5">
          {Array.from({ length: limit }).map((_, i) => (
            <div key={i} className="h-5 w-full animate-pulse rounded-md bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel p-4">
        <h3 className="font-display text-sm font-semibold mb-3">{title}</h3>
        <p className="text-xs text-destructive">{error}</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="panel p-4">
        <h3 className="font-display text-sm font-semibold mb-3">{title}</h3>
        <p className="text-xs text-muted-foreground">No data for this range.</p>
      </div>
    );
  }

  const primaryMetric = metric;
  const isCurrency = primaryMetric !== "bet_count" && primaryMetric !== "players";

  return (
    <div className="panel p-4">
      <h3 className="font-display text-sm font-semibold mb-3">{title}</h3>
      <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border/60">
              <th className="label-eyebrow whitespace-nowrap px-2 py-2 text-left font-normal">#</th>
              <th className="label-eyebrow whitespace-nowrap px-2 py-2 text-left font-normal">
                Entity
              </th>
              {METRIC_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="label-eyebrow whitespace-nowrap px-2 py-2 text-right font-normal"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const rank = direction === "asc" ? rows.length - index : index + 1;
              return (
                <tr
                  key={String(row.id ?? row.game_id ?? row.operator_id ?? row.partner_id ?? index)}
                  className="border-b border-border/40 last:border-0"
                >
                  <td className="num whitespace-nowrap px-2 py-2 text-left align-middle">{rank}</td>
                  <td className="whitespace-nowrap px-2 py-2 align-middle">{labelOf(row, 30)}</td>
                  {METRIC_COLUMNS.map((col) => {
                    const value = metricOf(row, col.key, 3);
                    return (
                      <td
                        key={col.key}
                        className={cn(
                          "num whitespace-nowrap px-2 py-2 text-right align-middle",
                          value === null && "text-muted-foreground",
                        )}
                        title={col.key}
                      >
                        {value === null
                          ? "—"
                          : isCurrency && col.key === primaryMetric
                            ? formatCompact(value)
                            : formatNumberValue(value)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
