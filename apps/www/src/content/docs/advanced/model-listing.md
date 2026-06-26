---
title: Model listing
description: List and inspect available provider models.
section: advanced
sidebar:
  group: Production architecture
  order: 6
---

Model listing is a provider-neutral contract for discovering available provider models. Use it for operational inventory, admin menus, deployment checks, and configuration tooling.

Do not treat a listed model as proof that every Anvia capability is supported. Providers differ in tool behavior, streaming, structured output, media support, context length, rate limits, and account access.

## Contract

`@anvia/core/model-listing` defines `ModelListingClient`, which returns a normalized `ModelList` containing `ListedModel` entries. When listing fails, providers can throw `ModelListingError` with provider and status details.

Provider packages can implement this contract when their upstream API supports model listing. The result is intentionally generic: id, name, type, owner, description, creation time, and context length when available. It is not a full provider-specific capability document.

## Admin UI Use

Model listing is useful when an internal admin UI needs to show provider-visible model ids. It can help operators understand which models are available without opening a provider console.

Keep the UI honest. A model picker should say that model listing is inventory. It should not imply that every listed model is safe for every workflow. Pair the list with your own allowlist, capability notes, and eval status before exposing a model to production users.

An admin UI should usually separate "visible" from "enabled". Visible means the provider returned the model. Enabled means your application has tested it, allowed it, and attached it to a workflow. That distinction prevents an operator from selecting a model that appears in inventory but has never passed your tool, streaming, or schema checks.

## Allowlists

Use model listing to discover candidates, then keep an app-owned allowlist for production choices. The allowlist can include the workflow name, provider, model id, status, expected capabilities, and owner.

The allowlist should be versioned like other config. If a model id changes, the change should go through review, smoke tests, and evals. Listing can help detect drift, but it should not be the only source of truth.

## Deployment Checks

Model listing can also run as a deployment check. If the configured model id is no longer visible, fail the check before traffic moves. If listing itself fails, decide whether that should block deployment or only warn. For many teams, configured model smoke tests are more important than listing availability.

A deployment check can be simple:

```ts
const list = await modelListingClient.listModels();
if (!list.data.some((model) => model.id === config.supportModelId)) {
  throw new Error(`Configured support model is not visible: ${config.supportModelId}`);
}
```

## Capability Still Needs Tests

Listing can tell you that a model exists. It cannot prove that streaming, tool calling, structured output, or multimodal input behave correctly for your workflow.

Use smoke tests and evals for those checks. Also handle the case where a listed model is visible but the account still cannot use it for a specific request.

## Error Handling

Treat model listing as optional infrastructure. If listing fails, a production app can still run with configured model ids.

Recommended behavior:

- show stale or configured model ids in admin UIs
- log the provider and status code from `ModelListingError`
- avoid blocking normal agent traffic unless listing is part of a deployment check
- retry out of band rather than inside user-facing prompt latency

Read [Models and capabilities](/docs/advanced/models-and-capabilities) for model selection and [Testing strategy](/docs/advanced/testing-strategy) for provider smoke tests.
