import { createFileRoute } from "@tanstack/react-router";
import { TabbedResourcePage } from "@/components/dashboard/resource-page";

export const Route = createFileRoute("/bets")({
  head: () => ({
    meta: [
      { title: "Bets · EuroVirtuals Backoffice" },
      { name: "description", content: "Search bets per game, partner and source with posting state and date filters in the EuroVirtuals backoffice." },
      { property: "og:title", content: "Bets · EuroVirtuals Backoffice" },
      { property: "og:description", content: "Search bets per game, partner and source with posting state and date filters in the EuroVirtuals backoffice." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <TabbedResourcePage
      title="Bets"
      subtitle="Search standard bets"
      resourceKeys={["bets"]}
    />
  ),
});
