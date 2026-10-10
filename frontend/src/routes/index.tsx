import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "../pages/Landing/LandingPage";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Watchly — Watch YouTube together, perfectly in sync" },
      {
        name: "description",
        content:
          "Create a private watch party in seconds. Friends join from an invite link, and everyone's playback stays in sync with live chat and host controls.",
      },
      { property: "og:title", content: "Watchly — Watch YouTube together, perfectly in sync" },
      {
        property: "og:description",
        content: "Private watch parties with synchronized playback, live chat and host controls.",
      },
    ],
  }),
  component: LandingPage,
});
