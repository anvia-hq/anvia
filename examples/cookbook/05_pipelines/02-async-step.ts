import { PipelineBuilder } from "@anvia/core/pipeline";

const fetchCustomerProfile = new PipelineBuilder<string>()
  .step(async (customerId) => {
    await delay(10);
    return {
      id: customerId,
      name: "Acme Co.",
      plan: "enterprise",
      openTickets: 3,
    };
  })
  .step((customer) => ({
    ...customer,
    priority: customer.plan === "enterprise" || customer.openTickets > 2 ? "high" : "normal",
  }))
  .build();

const profile = await fetchCustomerProfile.run("cus_123");

console.log(profile);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
