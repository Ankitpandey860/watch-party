import { createFileRoute } from "@tanstack/react-router";
import { RoomPage } from "../pages/Room/RoomPage";

export const Route = createFileRoute("/room/$roomId")({
  head: ({ params }) => ({
    meta: [
      { name: "robots", content: "noindex" },
      { title: `Room ${params.roomId} — Watchly` },
      {
        name: "description",
        content:
          "Join a live watch party on Watchly. Open the invite, type a name, and watch in sync.",
      },
      { property: "og:title", content: `Room ${params.roomId} — Watchly` },
      {
        property: "og:description",
        content: "A live YouTube watch party on Watchly.",
      },
    ],
  }),
  component: RoomRoute,
});

function RoomRoute() {
  return <RoomPage />;
}
