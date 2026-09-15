import { defineConfig } from "prisma7/config";

export default defineConfig({
  schema: "generated/v7/schema.prisma",
  datasource: {
    url: process.env.ANVIA_PRISMA_TEST_URL ?? "postgresql://localhost/anvia_test",
  },
});
