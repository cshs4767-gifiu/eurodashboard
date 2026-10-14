import { useQuery } from "@tanstack/react-query";
import { Download, ReceiptText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiRequest, normalizeList, type Dict, type QueryValue } from "@/lib/api";
import type { ResourceDef } from "@/lib/endpoints";
import { useAuth, useClientScope } from "@/lib/use-auth";
import { formatCellValue, humanizeKey } from "@/lib/format";
import { downloadInvoicePdf } from "@/lib/invoice-pdf";
import { FilterBar } from "./filter-bar";
import { useReferenceOptions } from "./reference-select";
import { ApiErrorBox } from "./api-error";
import { Skeleton } from "@/components/ui/skeleton";

function initialValues(resource: ResourceDef): Record<string, QueryValue> {
  const values: Record<string, QueryValue> = {};
  for (const filter of resource.filters ?? []) values[filter.name] = "";
  return { ...values, ...(resource.defaults ?? {}) };
}

function flatten(row: Dict): [string, unknown][] {
  return Object.entries(row).filter(
    ([key, value]) => !HIDDEN_KEYS.has(key) && (typeof value !== "object" || value === null),
  );
}

const TITLE_KEYS = ["client_name", "operator", "client", "name", "game_name"];

/** Fields intentionally hidden from the invoice screen. */
const HIDDEN_KEYS = new Set([
  "operator_id",
  "partner_id",
  "operator_name",
  "game_id",
  "operator_game_id",
  "line_items",
  "free_bet_won",
  "freebet_won",
]);

/** Meta fields shown in the header summary line instead of as table rows. */
function isMetaKey(key: string) {
  return /^(currency|month|period)$/i.test(key) || /invoice_bas/i.test(key);
}

function isGgrKey(key: string) {
  return /^ggr$/i.test(key);
}

export function InvoiceView({ resource }: { resource: ResourceDef }) {
  const [values, setValues] = useState<Record<string, QueryValue>>(() => initialValues(resource));
  const { user } = useAuth();
  const scope = useClientScope(user);
  const lockOperator = scope.mode === "single" && !!scope.operatorId;

  useEffect(() => {
    if (!lockOperator || !scope.operatorId) return;
    setValues((prev) =>
      prev.operator_id === scope.operatorId ? prev : { ...prev, operator_id: scope.operatorId },
    );
  }, [lockOperator, scope.operatorId]);

  const request = useQuery({
    queryKey: [resource.key, values],
    queryFn: () => apiRequest(resource.path, { query: values }),
    retry: false,
  });

  const rows = useMemo(() => normalizeList(request.data ?? null).rows, [request.data]);
  const month = String(values.month ?? "");
  const operatorOptions = useReferenceOptions("operator");
  const operatorName =
    operatorOptions.options.find((option) => option.value === String(values.operator_id ?? ""))
      ?.label ?? "";
  const [downloading, setDownloading] = useState(false);

  const firstRow = rows[0];
  const currency = firstRow
    ? String(Object.entries(firstRow).find(([key]) => /^currency$/i.test(key))?.[1] ?? "")
    : "";
  const basis = firstRow
    ? String(Object.entries(firstRow).find(([key]) => /invoice_bas/i.test(key))?.[1] ?? "")
    : "";
  const rowMonth = firstRow
    ? String(Object.entries(firstRow).find(([key]) => /^(month|period)$/i.test(key))?.[1] ?? "")
    : "";
  const shownMonth = month || rowMonth;

  return (
    <div className="space-y-4">
      <FilterBar
        filters={resource.filters ?? []}
        locked={lockOperator ? ["operator_id"] : undefined}
        values={values}
        onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
        busy={request.isFetching}
        onReset={() => {
          const fresh = initialValues(resource);
          if (lockOperator && scope.operatorId) fresh.operator_id = scope.operatorId;
          setValues(fresh);
        }}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="num text-xs text-muted-foreground">
            {rows.length} invoice{rows.length === 1 ? "" : "s"}
            {shownMonth ? ` · ${shownMonth}` : ""}
            {basis ? ` · ${basis}` : ""}
          </p>
        </div>
        <button
          type="button"
          disabled={rows.length === 0 || downloading}
          onClick={async () => {
            setDownloading(true);
            try {
              await downloadInvoicePdf(`invoice-${month || "all"}.pdf`, rows, month, operatorName);
            } finally {
              setDownloading(false);
            }
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Download className="size-3.5" strokeWidth={2} />
          {downloading ? "Preparing…" : "Download PDF"}
        </button>
      </div>

      {request.error ? (
        <ApiErrorBox error={request.error} />
      ) : request.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-44 w-full bg-muted/60" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="panel flex flex-col items-center gap-2 px-6 py-14 text-center">
          <ReceiptText className="size-6 text-muted-foreground" strokeWidth={1.5} />
          <p className="font-display text-sm font-semibold">No invoice data</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Pick an operator and month to generate the invoice breakdown.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {rows.map((row, index) => {
            const titleKey = TITLE_KEYS.filter((key) => !HIDDEN_KEYS.has(key)).find(
              (key) => row[key] !== undefined && row[key] !== null,
            );
            const title = titleKey
              ? `${humanizeKey(titleKey)}: ${formatCellValue(row[titleKey])}`
              : operatorName || `Invoice ${index + 1}`;
            const stats = flatten(row).filter(([key]) => key !== titleKey && !isMetaKey(key));
            const nested = Object.entries(row).filter(
              ([key, value]) => !HIDDEN_KEYS.has(key) && value && typeof value === "object",
            );
            return (
              <section key={index} className="space-y-4">
                {rows.length > 1 || titleKey ? (
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-display text-sm font-semibold">{title}</h3>
                    {shownMonth ? <span className="label-eyebrow">{shownMonth}</span> : null}
                  </div>
                ) : null}
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-surface/60 border-b border-border">
                        <th className="label-eyebrow py-2.5 pr-4 text-left">Field</th>
                        <th className="label-eyebrow py-2.5 pr-4 text-left">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.map(([key, value]) => (
                        <tr key={key} className="border-b border-border/60">
                          <td className="py-2.5 pr-4 align-top text-muted-foreground">
                            {humanizeKey(key)}
                          </td>
                          <td
                            className={
                              "py-2.5 pr-4 align-top num" +
                              (isGgrKey(key) ? " font-bold text-primary" : "")
                            }
                          >
                            {formatCellValue(value) || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {nested.map(([key, value]) => (
                  <div key={key} className="space-y-3">
                    <p className="label-eyebrow">{humanizeKey(key)}</p>
                    {Array.isArray(value) ? (
                      (() => {
                        const objects = value.filter(
                          (item) => item && typeof item === "object",
                        ) as Dict[];
                        if (objects.length === value.length && objects.length > 0) {
                          const cols: string[] = [];
                          for (const item of objects) {
                            for (const k of Object.keys(item)) {
                              if (!HIDDEN_KEYS.has(k) && !cols.includes(k)) cols.push(k);
                            }
                          }
                          if (cols.length === 0) return null;
                          return (
                            <div className="overflow-x-auto rounded-md border border-border">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="bg-surface/60 border-b border-border">
                                    {cols.map((col) => (
                                      <th key={col} className="label-eyebrow py-2.5 pr-4 text-left">
                                        {col === "id" || /_id$/i.test(col)
                                          ? "#"
                                          : col === "ggr"
                                            ? "GGR"
                                            : humanizeKey(col)}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {objects.map((item, itemIndex) => (
                                    <tr key={itemIndex} className="border-b border-border/60">
                                      {cols.map((col) => (
                                        <td
                                          key={col}
                                          className={
                                            "py-2.5 pr-4 num" +
                                            (/ggr/i.test(col) ? " font-bold text-primary" : "")
                                          }
                                        >
                                          {formatCellValue(item[col]) || "—"}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          );
                        }
                        return (
                          <div className="overflow-x-auto rounded-md border border-border">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-surface/60 border-b border-border">
                                  <th className="label-eyebrow py-2.5 pr-4 text-left">#</th>
                                  <th className="label-eyebrow py-2.5 pr-4 text-left">Value</th>
                                </tr>
                              </thead>
                              <tbody>
                                {value.map((item, itemIndex) => (
                                  <tr key={itemIndex} className="border-b border-border/60">
                                    <td className="py-2.5 pr-4 num">{itemIndex + 1}</td>
                                    <td className="py-2.5 pr-4 num">
                                      {formatCellValue(item) || "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        );
                      })()
                    ) : (
                      <div className="overflow-x-auto rounded-md border border-border">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-surface/60 border-b border-border">
                              <th className="label-eyebrow py-2.5 pr-4 text-left">Field</th>
                              <th className="label-eyebrow py-2.5 pr-4 text-left">Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(value as Record<string, unknown>)
                              .filter(([k]) => !HIDDEN_KEYS.has(k))
                              .map(([childKey, childValue]) => (
                                <tr key={childKey} className="border-b border-border/60">
                                  <td className="py-2.5 pr-4 align-top text-muted-foreground">
                                    {humanizeKey(childKey)}
                                  </td>
                                  <td className="py-2.5 pr-4 align-top num">
                                    {childValue && typeof childValue === "object"
                                      ? "—"
                                      : formatCellValue(childValue) || "—"}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      )}

      {currency && rows.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Note: all amounts are shown in <span className="font-semibold">{currency}</span>.
        </p>
      ) : null}
    </div>
  );
}
