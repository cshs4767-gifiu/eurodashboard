import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StatCard } from "@/components/dashboard/stat-card";
import { Section, Toggle } from "@/components/dashboard/section";
import { StatsFilterBar, StatsError, useStatsScope } from "@/components/dashboard/stats-filter-bar";
import { StatsTable } from "@/components/dashboard/stats-table";
import { useAuth, isClientAdmin } from "@/lib/use-auth";
import { formatCompact } from "@/lib/format";
import { useDashboardStore } from "@/lib/stores/dashboard-store";
import {
  errorMessage,
  metricOf,
  rtpOf,
  seriesFrom,
  useStatsSummary,
  useStatsTop,
  rowsFrom,
  type StatsMetricKey,
} from "@/lib/stats";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Financial analytics · EuroVirtuals Backoffice" },
      {
        name: "description",
        content:
          "Live GGR, NGR, RTP and run-rate scorecards with per-game margin analysis, CSV export and interactive trend charts.",
      },
      { property: "og:title", content: "Financial analytics · EuroVirtuals Backoffice" },
      {
        property: "og:description",
        content:
          "GGR, NGR, RTP and run rates plus per-game margin analysis for EuroVirtuals operators.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AnalyticsPage,
});

const tooltipStyle = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  fontSize: 12,
};

function daysBetween(from: string, to: string) {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

const show = (value: number | null) => (value === null ? "—" : formatCompact(value));
const pct = (value: number | null) => (value === null ? "—" : `${value.toFixed(2)}%`);

function AnalyticsPage() {
  const { dateFrom, dateTo } = useDashboardStore();
  const { filters, hideOperator } = useStatsScope();
  const { user } = useAuth();
  const hidePartner = isClientAdmin(user);

  const summary = useStatsSummary(filters);

  const [axis, setAxis] = useState<StatsMetricKey>("ggr");
  const trend = useStatsTop("games", axis, filters, 60);

  const topGamesReq = useStatsTop("games", "ggr", filters, 10, "desc");
  const bottomGamesReq = useStatsTop("games", "ggr", filters, 10, "asc");
  const topOperatorsReq = useStatsTop("operators", "ggr", filters, 10, "desc");
  const topPartnersReq = useStatsTop("partners", "ggr", filters, 10, "desc");

  const topGamesRows = rowsFrom(topGamesReq.data);
  const bottomGamesRows = rowsFrom(bottomGamesReq.data);
  const topOperatorsRows = rowsFrom(topOperatorsReq.data);
  const topPartnersRows = rowsFrom(topPartnersReq.data);

  const payload = summary.data ?? null;
  const ggr = metricOf(payload, "ggr");
  const stake = metricOf(payload, "total_stake");
  const bets = metricOf(payload, "total_bets");
  const players = metricOf(payload, "players");
  const freeBetWon = metricOf(payload, "free_bet_won");

  const rtp = rtpOf(stake, ggr);
  const ngr = ggr === null ? null : ggr - (freeBetWon ?? 0);
  const days = daysBetween(dateFrom, dateTo);
  const dailyRun = ggr === null ? null : ggr / days;
  const hourlyRun = dailyRun === null ? null : dailyRun / 24;

  const trendData = useMemo(
    () => seriesFrom(trend.data, axis).sort((a, b) => a.value - b.value),
    [trend.data, axis],
  );

  return (
    <DashboardShell
      title="Financial analytics"
      subtitle="GGR = total stake − total won · RTP = (total stake − GGR) ÷ total stake"
    >
      <StatsFilterBar hideOperator={hideOperator} />
      <StatsError message={errorMessage(summary.error)} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="GGR"
          icon="TrendingUp"
          tone="primary"
          loading={summary.isLoading}
          value={show(ggr)}
          hint="Total stake − total won"
        />
        <StatCard
          label="Total won"
          icon="Coins"
          tone="default"
          loading={summary.isLoading}
          value={show(metricOf(payload, "total_won"))}
          hint="Total won payouts"
        />
        <StatCard
          label="Voided"
          icon="Slash"
          tone="warning"
          loading={summary.isLoading}
          value={show(metricOf(payload, "total_voided"))}
          hint="Total voided amount"
        />
        <StatCard
          label="NGR"
          icon="Trophy"
          tone="warning"
          loading={summary.isLoading}
          value={show(ngr)}
          hint="GGR − free bet winnings"
        />
        <StatCard
          label="Avg stake"
          icon="Dices"
          tone="accent"
          loading={summary.isLoading}
          value={show(metricOf(payload, "avg_stake"))}
          hint="Average stake"
        />
        <StatCard
          label="Payout ratio"
          icon="Percent"
          tone="default"
          loading={summary.isLoading}
          value={pct(metricOf(payload, "payout_ratio"))}
          hint="Payout ratio"
        />
        <StatCard
          label="Unique games"
          icon="Grid"
          tone="default"
          loading={summary.isLoading}
          value={show(metricOf(payload, "unique_games"))}
          hint="Distinct games in range"
        />
      </div>

      {topGamesRows.length > 0 ||
      bottomGamesRows.length > 0 ||
      topOperatorsRows.length > 0 ||
      (!hidePartner && topPartnersRows.length > 0) ? (
        <Section
          title="Top & bottom performers"
          hint="Leading and trailing entities by GGR for the selected range."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <StatsTable
              type="games"
              metric="ggr"
              filters={filters}
              limit={10}
              direction="desc"
              title="Top games by GGR"
            />
            <StatsTable
              type="games"
              metric="ggr"
              filters={filters}
              limit={10}
              direction="asc"
              title="Bottom games by GGR"
            />
            <StatsTable
              type="operators"
              metric="ggr"
              filters={filters}
              limit={10}
              direction="desc"
              title="Top operators by GGR"
            />
            {hidePartner ? null : (
              <StatsTable
                type="partners"
                metric="ggr"
                filters={filters}
                limit={10}
                direction="desc"
                title="Top partners by GGR"
              />
            )}
          </div>
        </Section>
      ) : null}

      <Section
        title="Performance trends"
        hint="Games sorted from lowest to highest GGR for the selected range and filters."
        actions={
          <>
            <Toggle
              value={axis}
              onChange={(value) => setAxis(value as StatsMetricKey)}
              options={[
                { label: "GGR", value: "ggr" },
                { label: "Stake", value: "total_stake" },
                { label: "Won", value: "total_won" },
                { label: "Bets", value: "total_bets" },
                { label: "Players", value: "players" },
              ]}
            />
          </>
        }
      >
        <div className="h-64 w-full sm:h-80">
          {trend.isLoading ? (
            <div className="grid h-full place-items-center text-xs text-muted-foreground">
              Loading…
            </div>
          ) : trend.error ? (
            <div className="grid h-full place-items-center px-4 text-center text-xs text-destructive">
              {errorMessage(trend.error)}
            </div>
          ) : trendData.length === 0 ? (
            <div className="grid h-full place-items-center text-xs text-muted-foreground">
              No data for this range
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  stroke="var(--color-muted-foreground)"
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="var(--color-muted-foreground)"
                  tickFormatter={(v: number) => formatCompact(v)}
                  width={52}
                />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatCompact(v)} />
                <Line
                  type="monotone"
                  dataKey="value"
                  name={axis.replace(/_/g, " ")}
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Section>
    </DashboardShell>
  );
}
