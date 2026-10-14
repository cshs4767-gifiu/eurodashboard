import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { CalendarDays } from "lucide-react";

import { useReferenceStore } from "@/lib/stores/reference-store";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StatCard } from "@/components/dashboard/stat-card";
import { StatsExplorer } from "@/components/dashboard/stats-explorer";
import { ReferenceSelect } from "@/components/dashboard/reference-select";
import { SelectMenu } from "@/components/dashboard/select-menu";
import { DateRangeField } from "@/components/ui/date-range-field";
import { formatStatValue, humanizeKey, todayISO } from "@/lib/format";
import {
  defaultDateFrom,
  defaultDateTo,
  monthRange,
  useDashboardStore,
} from "@/lib/stores/dashboard-store";
import { useStatsScope } from "@/components/dashboard/stats-filter-bar";
import { metricOf, useStatsSummary } from "@/lib/stats";

/** Current month plus the previous 11, for the month picker. */
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => monthRange(index));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EuroVirtuals Backoffice · Operations dashboard" },
      {
        name: "description",
        content:
          "Live operations dashboard for the EuroVirtuals backoffice API: GGR, stakes, players, bets, promotions and audit activity in one control room.",
      },
      { property: "og:title", content: "EuroVirtuals Backoffice · Operations dashboard" },
      {
        property: "og:description",
        content:
          "GGR, stake, player and bet analytics plus promotions and audit tooling for EuroVirtuals operators.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Overview,
});

const METRIC_CARDS: {
  key: string;
  label: string;
  icon: string;
  tone: "primary" | "accent" | "warning" | "default";
}[] = [
  { key: "ggr", label: "GGR", icon: "TrendingUp", tone: "primary" },
  { key: "stake", label: "Stake", icon: "Coins", tone: "accent" },
  { key: "bet_count", label: "Bet count", icon: "Dices", tone: "default" },
  { key: "players", label: "Players", icon: "Users", tone: "default" },
  { key: "voided_bets", label: "Voided", icon: "Slash", tone: "warning" },
  { key: "rtp", label: "RTP", icon: "Ticket", tone: "default" },
];

const FREEBET_CARDS: {
  key: string;
  label: string;
  icon: string;
  tone: "primary" | "accent" | "warning" | "default";
}[] = [
  { key: "free_bet_stake", label: "Freebet Stake", icon: "Gift", tone: "accent" },
  { key: "free_bet_won", label: "Freebet Won", icon: "Trophy", tone: "primary" },
  { key: "free_bet_count", label: "Freebet Count", icon: "Tag", tone: "default" },
  { key: "free_bet_count_won", label: "Free bet count won", icon: "CheckCircle", tone: "default" },
];

function Overview() {
  const {
    dateFrom,
    dateTo,
    operatorId,
    partnerId,
    gameId,
    setOperatorId,
    setPartnerId,
    setGameId,
    setRange,
  } = useDashboardStore();
  const { filters, hideOperator, hidePartner } = useStatsScope();

  const ensureReference = useReferenceStore((s) => s.ensure);
  useEffect(() => {
    if (!hideOperator) void ensureReference("operator");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = useStatsSummary(filters);
  const summaryError = summary.error ? (summary.error as Error).message : null;

  const handlePartnerChange = (nextPartnerId: string) => {
    setPartnerId(nextPartnerId);
    if (!gameId) return;
    void (async () => {
      const store = useReferenceStore.getState();
      if (operatorId) {
        await store.refreshGamesForOperator(operatorId, "", 1, false, nextPartnerId || undefined);
      } else {
        await store.refresh("catalogGame", "", 1, false, nextPartnerId || undefined);
      }
      if (!nextPartnerId) return;
      const available = useReferenceStore.getState().game.options;
      if (!available.some((option) => option.value === gameId)) setGameId("");
    })();
  };

  const showGameFilter = true;

  return (
    <DashboardShell
      title="Operations overview"
      subtitle="Platform summary, top performers and recent activity"
    >
      <div className="panel mb-5 space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="label-eyebrow">Date range *</span>
            <DateRangeField
              from={dateFrom}
              to={dateTo}
              onChange={(from, to) => setRange(from || todayISO(), to || from || todayISO())}
            />
          </label>
          {hideOperator ? null : (
            <label className="flex flex-col gap-1.5">
              <span className="label-eyebrow">Operator</span>
              <ReferenceSelect kind="operator" value={operatorId} onChange={setOperatorId} />
            </label>
          )}
          {hidePartner ? null : (
            <label className="flex flex-col gap-1.5">
              <span className="label-eyebrow">Partner</span>
              <ReferenceSelect kind="partner" value={partnerId} onChange={handlePartnerChange} />
            </label>
          )}
          {showGameFilter ? (
            <label className="flex flex-col gap-1.5">
              <span className="label-eyebrow">Game</span>
              <ReferenceSelect
                kind="game"
                value={gameId}
                operatorId={operatorId}
                partnerScope={hidePartner ? undefined : partnerId}
                onChange={setGameId}
              />
            </label>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <SelectMenu
            aria-label="Month"
            className="w-48"
            icon={
              <CalendarDays
                className="size-3.5 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
              />
            }
            placeholder="Custom range"
            value={MONTH_OPTIONS.find((m) => m.from === dateFrom && m.to === dateTo)?.key ?? ""}
            options={MONTH_OPTIONS.map((month) => ({ value: month.key, label: month.label }))}
            onChange={(value) => {
              const picked = MONTH_OPTIONS.find((m) => m.key === value);
              if (picked) setRange(picked.from, picked.to);
            }}
          />

          {[
            { label: "Today", from: todayISO(), to: todayISO() },
            { label: "Yesterday", from: todayISO(-1), to: todayISO(-1) },
            { label: "7d", from: todayISO(-6), to: todayISO() },
            { label: "30d", from: todayISO(-29), to: todayISO() },
            { label: "90d", from: todayISO(-89), to: todayISO() },
          ].map((preset) => {
            const active = dateFrom === preset.from && dateTo === preset.to;
            return (
              <button
                key={preset.label}
                onClick={() => setRange(preset.from, preset.to)}
                className={`h-9 rounded-md border px-3 text-xs transition-colors ${
                  active
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
          <button
            onClick={() => {
              setRange(defaultDateFrom(), defaultDateTo());
              setOperatorId("");
              setPartnerId("");
              setGameId("");
            }}
            className="ml-auto h-9 rounded-md border border-border px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Reset filters
          </button>
        </div>
      </div>

      {summaryError ? (
        <p className="panel mb-5 border-destructive/40 px-4 py-3 text-sm text-destructive">
          Summary request failed: {summaryError}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {METRIC_CARDS.map((card) => {
          const value = metricOf(summary.data ?? null, card.key);
          return (
            <StatCard
              key={card.key}
              label={card.label}
              icon={card.icon}
              tone={card.tone}
              loading={summary.isLoading}
              value={value === null ? "—" : formatStatValue(value)}
              hint={humanizeKey(card.key)}
            />
          );
        })}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Note: all amounts are shown in <span className="font-semibold">USD</span>.
      </p>

      <div className="mt-6">
        <h2 className="mb-3 font-display text-base font-semibold">Freebet Performance</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FREEBET_CARDS.map((card) => {
            const value = metricOf(summary.data ?? null, card.key);
            return (
              <StatCard
                key={card.key}
                label={card.label}
                icon={card.icon}
                tone={card.tone}
                loading={summary.isLoading}
                value={value === null ? "—" : formatStatValue(value)}
                hint={humanizeKey(card.key)}
              />
            );
          })}
        </div>
      </div>

      <StatsExplorer />
    </DashboardShell>
  );
}
