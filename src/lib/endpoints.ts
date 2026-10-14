import { BET_STATUS } from "./status-labels";
import type { QueryValue } from "./api";

export type FilterType =
  "text" | "number" | "date" | "select" | "operator" | "game" | "partner" | "role" | "permission";

export type FilterDef = {
  name: string;
  label: string;
  type: FilterType;
  required?: boolean;
  placeholder?: string;
  options?: { label: string; value: string }[];
  /** For game selectors, allow forcing operator-scoped lookup instead of the global catalog. */
  catalog?: boolean;
};

export type ResourceDef = {
  key: string;
  title: string;
  description: string;
  path: string;
  paginated?: boolean;
  filters?: FilterDef[];
  columns?: string[];
  /** Columns hidden from the table view. */
  hideColumns?: string[];
  /** Restrict CSV export to these columns (in order). */
  exportColumns?: string[];
  defaults?: Record<string, QueryValue>;
  /**
   * The API scopes this collection per client: single-client admins are
   * resolved from the session, multi-client admins must send `operator_id`.
   */
  clientScoped?: boolean;
};

const pageFilters: FilterDef[] = [];

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM for the previous calendar month (invoices can only be generated for past months). */
function previousMonth(): string {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

/** Last 24 months, newest first, as YYYY-MM options for the invoice month dropdown. */
const MONTH_OPTIONS = Array.from({ length: 24 }, (_, index) => {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
  const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  return {
    value,
    label: date.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
});

const dateRange: FilterDef[] = [
  { name: "date_from", label: "Date from", type: "date" },
  { name: "date_to", label: "Date to", type: "date" },
];

const statusSelect = (name = "status"): FilterDef => ({
  name,
  label: "Status",
  type: "select",
  options: [
    { label: "All statuses", value: "" },
    { label: "Active", value: "1" },
    { label: "Inactive", value: "3" },
  ],
});

export const RESOURCES: Record<string, ResourceDef> = {
  bets: {
    key: "bets",
    title: "Bets",
    description: "GET /api/v1/bets — search settled and open bets for a single game.",
    path: "/api/v1/bets",
    paginated: true,
    clientScoped: true,
    filters: [
      { name: "game_id", label: "Game", type: "game" },
      { name: "operator_id", label: "Operator", type: "operator" },
      {
        name: "player_id",
        label: "Player ID",
        type: "number",
        placeholder: "Player ID",
      },
      {
        name: "transaction",
        label: "Transaction",
        type: "text",
        placeholder: "Search by bet_reference, transaction_id or win_transaction_id",
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { label: "All statuses", value: "" },
          { label: BET_STATUS["1"].label, value: "1" },
          { label: BET_STATUS["2"].label, value: "2" },
          { label: BET_STATUS["3"].label, value: "3" },
          { label: BET_STATUS["7"].label, value: "7" },
        ],
      },
      {
        name: "is_posted",
        label: "Posting state",
        type: "select",
        options: [
          { label: "All posting states", value: "" },
          { label: "Pending", value: "1" },
          { label: "Success", value: "2" },
          { label: "Failed", value: "3" },
          { label: "In progress", value: "4" },
          { label: "Failed completely", value: "5" },
          { label: "Retry", value: "10" },
        ],
      },
      ...dateRange,
    ],
    columns: [
      "id",
      "bet_reference",
      "player_id",
      "source",
      "odds",
      "stake",
      "won_amount",
      "status",
      "is_posted",
      "created_at",
      "updated_at",
    ],
    hideColumns: [
      "game_id",
      "operator_id",
      "partner_bet_reference",
      "transaction_id",
      "currency",
      "total_odd",
      "results",
      "rollback",
      "amount_usd",
      "bet_type",
      "record_type",
      "extra_data",
      "round_id",
      "partner_id",
      "operator_player_id",
      "operator_name",
      "game_uuid",
      "partner_name",
    ],
    exportColumns: [
      "bet_reference",
      "player_id",
      "source",
      "odds",
      "stake",
      "won_amount",
      "status",
      "created_at",
    ],
  },
  "partner-bets": {
    key: "partner-bets",
    title: "Partner bets",
    description: "GET /api/v1/bets — partner-filtered bet search including source-based splits and records without a source.",
    path: "/api/v1/bets",
    paginated: true,
    clientScoped: true,
    filters: [
      { name: "partner_id", label: "Partner", type: "partner" },
      { name: "operator_id", label: "Operator", type: "operator" },
      {
        name: "source",
        label: "Source",
        type: "select",
        options: [
          { label: "All sources", value: "" },
          { label: "In house", value: "in_house" },
          { label: "Partner", value: "partner" },
        ],
      },
      {
        name: "player_id",
        label: "Player ID",
        type: "number",
        placeholder: "Player ID",
      },
      {
        name: "transaction",
        label: "Transaction",
        type: "text",
        placeholder: "Search by bet_reference, transaction_id or win_transaction_id",
      },
      ...dateRange,
    ],
    columns: [
      "id",
      "bet_reference",
      "player_id",
      "source",
      "partner_id",
      "partner_name",
      "odds",
      "stake",
      "won_amount",
      "status",
      "is_posted",
      "created_at",
      "updated_at",
    ],
    hideColumns: [
      "game_id",
      "operator_id",
      "partner_bet_reference",
      "transaction_id",
      "currency",
      "total_odd",
      "results",
      "rollback",
      "amount_usd",
      "bet_type",
      "record_type",
      "extra_data",
      "round_id",
      "operator_player_id",
      "operator_name",
      "game_uuid",
    ],
    exportColumns: [
      "bet_reference",
      "player_id",
      "partner_name",
      "source",
      "odds",
      "stake",
      "won_amount",
      "status",
      "created_at",
    ],
  },
  "bet-attempts": {
    key: "bet-attempts",
    title: "Bet attempts",
    description:
      "GET /api/v1/bet-attempts — engine-level attempt log from crash and partner games.",
    path: "/api/v1/bet-attempts",
    paginated: true,
    filters: [
      { name: "game_id", label: "Game", type: "game" },
      { name: "operator_id", label: "Operator", type: "operator" },
      { name: "player_id", label: "Player ID", type: "number" },
      {
        name: "transaction",
        label: "Transaction",
        type: "text",
        placeholder:
          "Searches bet_reference, transaction_id and win_transaction_id where available",
      },
      {
        name: "outcome_status",
        label: "Outcome status",
        type: "select",
        options: [
          { label: "All outcomes", value: "" },
          { label: "Internal failed after operator success refund queued", value: "INTERNAL_FAILED_AFTER_OPERATOR_SUCCESS_REFUND_QUEUED" },
          { label: "Operator declined", value: "OPERATOR_DECLINED" },
          { label: "Operator network error refund queued", value: "OPERATOR_NETWORK_ERROR_REFUND_QUEUED" },
          { label: "Operator timeout refund queued", value: "OPERATOR_TIMEOUT_REFUND_QUEUED" },
          { label: "Success", value: "SUCCESS" },
        ],
      },
      ...dateRange,
    ],
    columns: [
      "engine",
      "game_name",
      "partner_name",
      "player_id",
      "bet_reference",
      "partner_bet_reference",
      "amount",
      "outcome_status",
      "reason",
      "created",
    ],
    hideColumns: [
      "id",
      "partner_id",
      "operator_id",
      "operator_name",
      "game_id",
      "bet_amount",
      "currency",
      "amount_usd",
      "round_id",
      "request_payload",
      "outcome_id",
      "error_message",
      "operator_http_status",
      "operator_response",
      "operator_player_id",
    ],
  },
  players: {
    key: "players",
    title: "Players",
    description: "GET /api/v1/players — player profiles across operators.",
    path: "/api/v1/players",
    paginated: true,
    filters: [
      { name: "player_id", label: "Player ID", type: "text" },
      { name: "operator_id", label: "Operator", type: "operator" },
      ...dateRange,
    ],
    hideColumns: ["operator_id", "operator_name"],
    defaults: { date_from: "", date_to: "" },
  },
  transactions: {
    key: "transactions",
    title: "Wallet transactions",
    description: "GET /api/v1/transactions — wallet debit/credit ledger.",
    path: "/api/v1/transactions",
    paginated: true,
    filters: [
      { name: "operator_id", label: "Operator", type: "operator" },
      { name: "player_id", label: "Player ID", type: "number" },
      { name: "reference_id", label: "Reference ID", type: "text" },
      ...dateRange,
    ],
    hideColumns: ["player_id"],
  },
  freebets: {
    key: "freebets",
    title: "Freebet transactions",
    description: "GET /api/v1/transactions/freebets — issued freebet balances and usage.",
    path: "/api/v1/transactions/freebets",
    paginated: true,
    filters: [
      { name: "operator_id", label: "Operator", type: "operator" },
      { name: "game_id", label: "Game", type: "game" },
      { name: "player_id", label: "Player ID", type: "number" },
      { name: "freebet_id", label: "Freebet ID", type: "number" },
      { name: "status", label: "Status", type: "number" },
      ...dateRange,
    ],
    columns: [
      "id",
      "player_id",
      "freebet_id",
      "amount",
      "currency",
      "created_at",
      "updated_at",
      "status",
    ],
    hideColumns: [
      "operator_id",
      "game_uuid",
      "game_id",
      "source_reference",
      "source_reference_id",
      "source_ref",
    ],
  },
  "exchange-rates": {
    key: "exchange-rates",
    title: "Exchange rates",
    description:
      "GET /api/v1/transactions/exchange-rates — rates against USD, ordered by exchange date.",
    path: "/api/v1/transactions/exchange-rates",
    paginated: true,
    filters: [
      { name: "currency", label: "Currency", type: "text", placeholder: "e.g. KES" },
      ...dateRange,
    ],
    columns: ["exchange_date", "currency", "exchange_rate"],
    hideColumns: ["id", "status", "config", "configs"],
  },
  games: {
    key: "games",
    title: "Games",
    description: "GET /api/v1/games — the global game catalogue.",
    path: "/api/v1/games",
    paginated: true,
    filters: [
      { name: "name", label: "Name", type: "text" },
      { name: "partner_id", label: "Partner name", type: "partner" },
      { name: "game_uuid", label: "Game UUID", type: "text" },
      { name: "partner_game_id", label: "Partner game ID", type: "text" },
    ],
    columns: ["thumbnail", "id", "name", "game_uuid", "partner_name", "rtp", "face_off", "status"],
    hideColumns: ["partner_id", "category_id", "game_type", "desc", "description"],
    exportColumns: ["name", "partner_name", "rtp"],
  },
  "operator-games": {
    key: "operator-games",
    title: "Operator games",
    description: "GET /api/v1/operator-games — per-operator game assignments.",
    path: "/api/v1/operator-games",
    paginated: true,
    clientScoped: true,
    filters: [
      { name: "operator_id", label: "Operator", type: "operator", required: true },
      { name: "partner_id", label: "Partner", type: "partner" },
      { name: "game_id", label: "Game", type: "game" },
      { name: "game_uuid", label: "Game UUID", type: "text" },
      { name: "name", label: "Name", type: "text" },
      { name: "game_name", label: "Game name", type: "text" },
    ],
    columns: ["id", "thumbnail", "game_name", "partner_name", "currency", "stake_limits", "status"],
    hideColumns: [
      "operator_id",
      "game_id",
      "partner_id",
      "partner_game_name",
      "minimum_stake",
      "maximum_stake",
      "maximum_win",
      "competition",
    ],
  },

  clients: {
    key: "clients",
    title: "Clients / operators",
    description: "GET /api/v1/clients — onboarded operators and their settings.",
    path: "/api/v1/clients",
    paginated: true,
    columns: [
      "id",
      "name",
      "email",
      "location",
      "default_currency",
      "callback_version",
      "callback_url",
      "status",
    ],
    hideColumns: ["setting_id", "created_at", "updated_at", "country", "location_address"],
    filters: [{ name: "name", label: "Name", type: "text" }],
  },
  partners: {
    key: "partners",
    title: "Partners",
    description: "GET /api/v1/partners — game providers integrated into the platform.",
    path: "/api/v1/partners",
    paginated: true,
    filters: [{ name: "name", label: "Name", type: "text" }, statusSelect()],
    columns: ["thumbnail", "name", "id", "status"],
  },
  "bonus-config": {
    key: "bonus-config",
    title: "Bonus configs",
    description: "GET /api/v1/promotions/bonus-config — per-game bonus configuration.",
    path: "/api/v1/promotions/bonus-config",
    paginated: true,
    clientScoped: true,
    columns: ["id", "operator_id", "game_name", "status", "start_date", "end_date"],
    hideColumns: ["game_id"],
    filters: [{ name: "operator_id", label: "Operator", type: "operator" }, statusSelect()],
  },
  "freebet-capabilities": {
    key: "freebet-capabilities",
    title: "Freebet capabilities",
    description: "GET /api/v1/promotions/freebet-capabilities — games enabled for free bets.",
    path: "/api/v1/promotions/freebet-capabilities",
    paginated: true,
    columns: ["id", "game_name", "status", "start_date", "end_date"],
    hideColumns: ["game_id", "partner_id", "game_status"],
    filters: [statusSelect()],
  },
  "operator-game-freebets": {
    key: "operator-game-freebets",
    title: "Operator game freebets",
    description:
      "GET /api/v1/promotions/operator-game-freebets — operator games allowed for free bets.",
    path: "/api/v1/promotions/operator-game-freebets",
    clientScoped: true,
    columns: [
      "id",
      "game_name",
      "game_uuid",
      "status",
      "game_status",
      "operator_game_status",
      "capability_status",
      "activated",
    ],
    hideColumns: [
      "game_id",
      "partner_id",
      "operator_id",
      "activated_by",
      "deactivated",
      "created",
      "created_at",
      "updated",
      "updated_at",
    ],
    filters: [{ name: "operator_id", label: "Operator", type: "operator" }, statusSelect()],
  },
  "freebet-campaigns": {
    key: "freebet-campaigns",
    title: "Freebet campaigns",
    description: "GET /api/v1/promotions/freebet-campaigns — backoffice free bet campaigns.",
    path: "/api/v1/promotions/freebet-campaigns",
    clientScoped: true,
    columns: ["id", "name", "campaign_uuid", "operator_id", "status", "start_date", "end_date"],
    hideColumns: ["game_id"],
    filters: [
      { name: "operator_id", label: "Operator", type: "operator" },
      { name: "game_id", label: "Game", type: "game" },
      { name: "campaign_uuid", label: "Campaign UUID", type: "text" },
      statusSelect(),
    ],
  },
  "freebet-awards": {
    key: "freebet-awards",
    title: "Freebet awards",
    description: "GET /api/v1/promotions/freebet-awards — awarded free bets per player.",
    path: "/api/v1/promotions/freebet-awards",
    columns: [
      "id",
      "player_id",
      "campaign_uuid",
      "operator_id",
      "status",
      "start_date",
      "end_date",
    ],
    hideColumns: ["game_id"],
    filters: [
      { name: "operator_id", label: "Operator", type: "operator" },
      { name: "campaign_uuid", label: "Campaign UUID", type: "text" },
      { name: "player_id", label: "Player ID", type: "text" },
      statusSelect(),
    ],
  },

  blacklist: {
    key: "blacklist",
    title: "Profile blacklist",
    description: "GET /api/v1/profile-blacklist — blocked player profiles.",
    path: "/api/v1/profile-blacklist",
    paginated: true,
    clientScoped: true,
    filters: [
      { name: "operator_id", label: "Operator", type: "operator" },
      { name: "player_id", label: "Player ID", type: "text" },
      statusSelect(),
    ],
  },
  whitelist: {
    key: "whitelist",
    title: "API IP whitelist",
    description: "GET /api/v1/operator-api-whitelist — allowed operator API source IPs.",
    path: "/api/v1/operator-api-whitelist",
    paginated: true,
    clientScoped: true,
    filters: [
      { name: "operator_id", label: "Operator", type: "operator" },
      {
        name: "api_scope",
        label: "API scope",
        type: "select",
        options: [
          { label: "—", value: "" },
          { label: "FREEBET", value: "FREEBET" },
        ],
      },
      { name: "ip_address", label: "IP address", type: "text" },
      statusSelect(),
    ],
  },
  users: {
    key: "users",
    title: "Backoffice users",
    description: "GET /api/v1/users — staff accounts with roles and permissions.",
    path: "/api/v1/users",
    paginated: true,
    filters: [{ name: "search", label: "Search", type: "text", placeholder: "Search users..." }],
  },
  "partner-operator-configs": {
    key: "partner-operator-configs",
    title: "Partner configs",
    description:
      "GET /api/v1/partner-operator-configs — per-operator overrides of a partner integration.",
    path: "/api/v1/partner-operator-configs",
    paginated: true,
    clientScoped: true,
    columns: ["partner_name", "status", "configs"],
    hideColumns: ["id", "partner_id", "operator_id", "operator_name"],
    filters: [
      { name: "partner_id", label: "Partner", type: "partner" },
      { name: "operator_id", label: "Operator", type: "operator" },
      statusSelect(),
    ],
  },
  "partner-launch-resolver": {
    key: "partner-launch-resolver",
    title: "Launch resolver",
    description:
      "GET /api/v1/partner-operator-configs/resolved-launch — the partner config used for a given game launch.",
    path: "/api/v1/partner-operator-configs/resolved-launch",
    columns: ["operator_id", "partner_id", "game_id", "config_source", "resolved_config"],
    hideColumns: ["id", "game_uuid"],
    filters: [
      { name: "operator_id", label: "Operator (required)", type: "operator", required: true },
      { name: "game_id", label: "Game", type: "game" },
    ],
  },
  roles: {
    key: "roles",
    title: "Roles",
    description: "GET /api/v1/roles — role definitions.",
    path: "/api/v1/roles",
    filters: pageFilters,
  },
  permissions: {
    key: "permissions",
    title: "Permissions",
    description: "GET /api/v1/permissions — granular permission catalogue.",
    path: "/api/v1/permissions",
    paginated: true,
    filters: [
      { name: "name", label: "Name", type: "text" },
      {
        name: "order",
        label: "Order",
        type: "select",
        options: [
          { label: "Default", value: "" },
          { label: "Ascending", value: "asc" },
          { label: "Descending", value: "desc" },
        ],
      },
    ],
  },
  "audit-logs": {
    key: "audit-logs",
    title: "Audit logs",
    description: "GET /api/v1/audit-logs — every privileged backoffice action.",
    path: "/api/v1/audit-logs",
    paginated: true,
    filters: pageFilters,
  },
  invoices: {
    key: "invoices",
    title: "Client invoices",
    description: "GET /api/v1/accounts/client-invoices — monthly invoice data from game summaries.",
    path: "/api/v1/accounts/client-invoices",
    defaults: { month: previousMonth() },
    filters: [
      { name: "operator_id", label: "Operator", type: "operator", required: true },
      { name: "month", label: "Month", type: "select", options: MONTH_OPTIONS, required: true },
    ],
  },
};

export type NavItem = {
  label: string;
  to: string;
  icon: string;
  permission?: string | string[];
  /** Hidden from CLIENT_ADMIN accounts (global/platform-wide surfaces). */
  adminOnly?: boolean;
  /** Only visible to CLIENT_ADMIN accounts. */
  clientAdminOnly?: boolean;
};
export type NavSection = { label: string; items: NavItem[] };

/** Routes a CLIENT_ADMIN may never open. */
export const ADMIN_ONLY_PATHS = new Set([
  "/clients",
  "/partners",
  "/games",
  "/users",
  "/access",
  "/audit-logs",
  "/exchange-rates",
  "/platform-health",
  "/analytics",
  "/operational",
  "/player-behavior",
]);

export const NAV: NavSection[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", to: "/", icon: "LayoutDashboard" },
      {
        label: "Financial analytics",
        to: "/analytics",
        icon: "ChartNoAxesCombined",
        adminOnly: true,
      },
      // { label: "Platform health", to: "/platform-health", icon: "HeartPulse", adminOnly: true },
      // { label: "Player behaviour", to: "/player-behavior", icon: "UsersRound", adminOnly: true },
      { label: "Operational BI", to: "/operational", icon: "ChartPie", adminOnly: true },
    ],
  },
  {
    label: "Activity",
    items: [
      { label: "Bets", to: "/bets", icon: "Dices", permission: "bets.view" },
      {
        label: "Partner bets",
        to: "/partner-bets",
        icon: "Handshake",
        adminOnly: true,
        permission: "bets.view",
      },
      {
        label: "Bet attempts",
        to: "/bet-attempts",
        icon: "Activity",
        permission: "bet-attempts.view",
      },
      { label: "Players", to: "/players", icon: "Users", permission: "players.view" },
      {
        label: "Transactions",
        to: "/transactions",
        icon: "ArrowLeftRight",
        permission: "transactions.view",
      },
      { label: "Freebet ledger", to: "/freebets", icon: "Ticket", permission: "freebets.view" },
      {
        label: "Exchange rates",
        to: "/exchange-rates",
        icon: "Coins",
        adminOnly: true,
        permission: "exchange-rates.view",
      },
    ],
  },
  {
    label: "Catalogue",
    items: [
      { label: "Games catalogue", to: "/games-catalog", icon: "Gamepad2", clientAdminOnly: true },
      { label: "Games", to: "/games", icon: "Gamepad2", adminOnly: true, permission: "games.view" },
      {
        label: "Operator games",
        to: "/operator-games",
        icon: "LayoutGrid",
        permission: "operator-games.view",
      },
      {
        label: "Clients",
        to: "/clients",
        icon: "Building2",
        adminOnly: true,
        permission: "clients.view",
      },
      {
        label: "Partners",
        to: "/partners",
        icon: "Handshake",
        adminOnly: true,
        permission: "partners.view",
      },
    ],
  },
  {
    label: "Promotions",
    items: [
      { label: "Promotions", to: "/promotions", icon: "Gift", permission: "promotions.view" },
    ],
  },
  {
    label: "Governance",
    items: [
      { label: "Users", to: "/users", icon: "UserCog", adminOnly: true, permission: "users.view" },
      {
        label: "Roles & permissions",
        to: "/access",
        icon: "ShieldCheck",
        adminOnly: true,
        permission: "access.view",
      },
      {
        label: "Client settings",
        to: "/client-settings",
        icon: "Settings",
        clientAdminOnly: true,
      },
      {
        label: "Regenerate API key",
        to: "/client-regenerate-key",
        icon: "KeyRound",
        clientAdminOnly: true,
      },
      { label: "Risk controls", to: "/risk", icon: "ShieldAlert", permission: "risk.view" },
      {
        label: "Audit logs",
        to: "/audit-logs",
        icon: "ScrollText",
        adminOnly: true,
        permission: "audit-logs.view",
      },
      { label: "Invoices", to: "/invoices", icon: "ReceiptText", permission: "invoices.view" },
    ],
  },
  {
    label: "Integrations",
    items: [
      {
        label: "Integration tests",
        to: "/integration-tests",
        icon: "FlaskConical",
        permission: ["integration_tests.view", "integration-tests.view", "integration_tests.run"],
      },
    ],
  },
];
