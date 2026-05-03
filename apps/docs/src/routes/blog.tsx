import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/blog")({
  beforeLoad: () => {
    throw redirect({
      to: "/docs/$",
      params: {
        _splat: "guides",
      },
    });
  },
});
