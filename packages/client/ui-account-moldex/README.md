---
description: "Moldex sign-in form and account presence for the Desktop renderer."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-account-moldex

English | [中文](README.zh.md)

## Summary

Register the Moldex sign-in form into the settings sign-in slot at a shadowing priority, replacing the browser-handling onboarding in Moldex profiles. The component renders the attempt phases of the account state stream and submits credentials through the dedicated Moldex namespace once per attempt.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The package mounts only in the Desktop renderer and expects a Moldex profile composition: the host account provider, the central Remote mount for its namespace, and the LLM route the created key feeds. Copy is owned by the package's locale dictionaries and reaches the component through the locale seat.

<a id="understand-the-implementation"></a>
## Understand the implementation

The apply closure subscribes the account state stream into an inject-face snapshot and exposes start and submit callbacks; the component keeps only its input values locally. Submission failures surface through the injected error field and the attempt phase the Host publishes. No invariant companion is published: the package owns no runtime state beyond the apply-closure snapshot rendered through the slot.

<a id="further-exploration"></a>
## Further Exploration

The [Moldex account provider](../../credentials/moldex-account/README.md) owns the sign-in, refresh, and key semantics this form drives.

<a id="model-experience"></a>
## Model Experience

None, as ` — the form drives account HTTP calls that never enter model prompts, Session logs, or tool results.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Desktop renderer only** — the web profile keeps the provider-specific onboarding that ships with the base composition.
