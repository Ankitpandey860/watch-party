import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "../pages/Home/HomePage";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Watchly — Watch YouTube Together in Sync" },
      {
        name: "description",
        content:
          "Create or join a watch party in seconds. Enjoy YouTube videos with friends in perfect sync with roles, chat-ready controls, and a beautiful dark UI.",
      },
      { property: "og:title", content: "Watchly — Watch YouTube Together in Sync" },
      {
        property: "og:description",
        content:
          "Create or join a watch party in seconds. Watch YouTube with friends in perfect sync.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return <HomePage />;
}
