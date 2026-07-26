import { createFileRoute } from "@tanstack/react-router";
import { RoomPage } from "../pages/Room/RoomPage";

export const Route = createFileRoute("/room/$roomId")({
  head: ({ params }) => ({
    meta: [
      { title: `Room ${params.roomId} — Watchly` },
      {
        name: "description",
        content: `Join watch party ${params.roomId} on Watchly and watch YouTube in sync with friends.`,
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