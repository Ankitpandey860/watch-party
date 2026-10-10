import { createFileRoute } from "@tanstack/react-router";
import { CreatePage } from "../pages/Create/CreatePage";

export const Route = createFileRoute("/create")({
  head: () => ({
    meta: [{ title: "Create a room — Watchly" }, { name: "robots", content: "noindex" }],
  }),
  component: CreatePage,
});
