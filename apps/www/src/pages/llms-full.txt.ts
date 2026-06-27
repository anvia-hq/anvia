import type { APIContext } from "astro";
import { buildLlmsFull } from "../lib/llms";

export const prerender = true;

export async function GET({ site }: APIContext) {
  return textResponse(await buildLlmsFull({ site: site ?? undefined }));
}

function textResponse(body: string) {
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
