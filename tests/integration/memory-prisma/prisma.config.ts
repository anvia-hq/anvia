import { definePrismaConfig } from "prisma/config";
import { defineConfig } from "@prisma/orm-postgres/config";

export default definePrismaConfig({
  orm: defineConfig({
    contract: `${process.env.ANVIA_PRISMA_TEST_CONTRACT_DIR ?? "generated/v8"}/contract.prisma`,
    output: process.env.ANVIA_PRISMA_TEST_CONTRACT_DIR ?? "generated/v8",
    db: { connection: process.env.ANVIA_PRISMA_TEST_URL ?? "postgresql://localhost/anvia_test" },
  }),
});
