import { Pipeline } from "@anvia/core/pipeline";
import { z } from "zod";

const fetchCustomerProfile = new Pipeline({
  id: "fetch-customer-profile",
  inputSchema: z.string(),
})
  .step({
    id: "fetch-profile",
    async run({ input: customerId }) {
      await delay(10);
      return {
        id: customerId,
        name: "Acme Co.",
        plan: "enterprise",
        openTickets: 3,
      };
    },
  })
  .step({
    id: "assign-priority",
    run: ({ input: customer }) => ({
      ...customer,
      priority: customer.plan === "enterprise" || customer.openTickets > 2 ? "high" : "normal",
    }),
  });

const { output: profile } = await fetchCustomerProfile.run({ input: "cus_123" });

console.log(profile);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
