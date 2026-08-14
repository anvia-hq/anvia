import { Extractor } from "@anvia/core/extractor";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

// Extractor uses the schema as the shape of the returned data.
const personSchema = z.object({
  firstName: z.string().describe("The person's first name."),
  lastName: z.string().describe("The person's last name."),
  role: z.string().optional().describe("The person's job or role, if mentioned."),
});

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});
const model = client.completionModel("gpt-5.5");
const extractor = new Extractor({ model, outputSchema: personSchema });

const person = await extractor.extract("Ada Lovelace was a mathematician and computing pioneer.");

console.log(person);
