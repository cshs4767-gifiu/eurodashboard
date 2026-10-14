import { createFileRoute } from "@tanstack/react-router";
import { ResourcePage } from "@/components/dashboard/resource-page";

export const Route = createFileRoute("/partner-bets")({
  head: () => ({
    meta: [
      { title: "Partner bets · EuroVirtuals Backoffice" },
      { name: "description", content: "Search partner bets with source-based splits and records without a source." },
      { property: "og:title", content: "Partner bets · EuroVirtuals Backoffice" },
      { property: "og:description", content: "Search partner bets with source-based splits and records without a source." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => <ResourcePage resourceKey="partner-bets" />,
});
