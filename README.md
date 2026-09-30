# PageTalk: Parallel Multi-Model Web Q&A

An enhanced fork of PageTalk that adds parallel multi-model comparison and the state-management workflow needed to continue, save, and revisit webpage-grounded AI conversations.

## Project Overview

PageTalk is a browser extension for contextual Q&A over the current webpage. In the version extended by this project, a user could query one selected model at a time. Comparing several answers required resubmitting the same webpage-grounded prompt, switching models between responses, and manually collecting the results.

This fork turns that serial workflow into a parallel comparison experience. A user can select several configured models, submit one question, and inspect independently streamed answers side by side. Each model receives its own conversation history for follow-up questions, while the full comparison can be saved and restored without losing answer ownership or display order.

For a three-model comparison, the workflow changes from **3 prompt submissions to 1** (**66.7% fewer submissions**) and from **at least 2 model switches to 0** during answer collection. Because requests are dispatched concurrently, the completion path is bounded by the slowest selected request rather than by user-driven serial requests. This is an architectural property, not a benchmark latency claim.

## Original Project and Fork Declaration

This repository is based on [PageTalk](https://github.com/jeanchristophe13v/PageTalk) by Leun Ho and contributors. The upstream project provides the base browser extension, webpage-Q&A experience, provider integrations, and original UI.

This is a fork for independent learning and engineering development. My work is limited to the extensions and improvements documented below, beginning with commit `e30f009`; it does not claim authorship of the upstream project.

## My Contributions

### New Features

- Added multi-model selection, parallel API execution, and side-by-side streaming response columns for one webpage-grounded prompt.
- Added model-specific conversation-history construction so each model receives its own prior answer during follow-up questions.
- Added persistent multi-model sessions, including selected-model state, response maps, and stable response order for restore.
- Added model-order tracking and response-matching compatibility for renamed or reconfigured model IDs.
- Added webpage-context preview and hydration, saved-session organisation, follow-up questions, Obsidian export templates with optional AI metadata, and a text-selection helper.

### Refactoring and Optimisation

- Separated multi-model dispatch, rendering, and completion handling from the original single-model path while retaining the single-model workflow.
- Used `Promise.allSettled` to isolate provider failures so a failed request does not discard successful answers from other selected models.
- Stored multi-model replies as an explicit model-ID-to-response map with `modelOrder`, rather than relying on one implicit active-model response.
- Implemented exact-ID, longest-common-prefix, and final remaining-pair matching to retain model-specific context after model configuration changes.

### Engineering Practices

- Kept response rendering, message actions, and conversation history isolated per model to prevent cross-model answer contamination.
- Preserved the original model order when restoring a saved comparison, making a saved question-to-answer group reproducible for later review.
- Used a conservative fallback when a historical response cannot be matched to a current model, avoiding a silent assignment of another model's answer as context.
- Linked the primary implementation areas below so reviewers can inspect the contribution without tracing the entire codebase.

## How This Fork Differs from the Upstream Project

The upstream column describes the baseline immediately before the multi-model implementation, not necessarily the latest upstream release.

| Area | Baseline PageTalk workflow | This Fork |
| --- | --- | --- |
| Webpage-grounded Q&A | One active model answers a prompt | Several selected models answer the same prompt concurrently |
| Answer comparison | Re-submit the prompt and switch models manually | Compare labeled answers in parallel response columns |
| Streaming UI | One response stream | Independent stream renderer and response state per model |
| Follow-up context | Active model conversation | Model-specific histories assembled from each model's own prior answer |
| Multi-model response storage | No multi-model response structure | Model-ID-to-response map plus stable model order |
| Session recovery | No multi-model comparison state to recover | Restore selected models and ordered multi-model response groups |
| Provider failure handling | One selected request per interaction | Other model responses remain available when one concurrent request fails |

## Results

- Reduced prompt submissions in a fixed three-model comparison from 3 to 1, a **66.7% reduction** in submission actions.
- Reduced model switches during answer collection in the same workflow from at least 2 to 0.
- Changed the wait path from repeated user-initiated serial requests to concurrent dispatch, with the slowest selected request determining overall completion.
- Preserved a **1:N** relationship between one user question and N ordered model responses across session save and restore.

The quantified results above are deterministic interaction counts for the three-model workflow. The repository does not currently include an automated latency benchmark, reliability suite, or CI workflow; no latency, adoption, or test-coverage figures are claimed.

## Demonstration: Parallel Answers and Follow-up Questions

The recording below shows a webpage-grounded question sent to several selected models in one interaction. Their responses stream in separate columns; a follow-up action then continues the comparison using each model's own conversation context.

https://github.com/user-attachments/assets/8ff6f166-fe07-4216-83f2-87c4a420743b

## Tech Stack

| Category | Technologies |
| --- | --- |
| Extension platform | Chrome Extension Manifest V3, service worker, content scripts |
| Application | JavaScript ES modules, HTML, CSS |
| Browser APIs | `chrome.storage`, `chrome.runtime`, `chrome.scripting` |
| AI providers | Gemini, OpenAI-compatible APIs, Anthropic-compatible APIs |
| Rendering | Markdown, code highlighting, KaTeX, Mermaid |

## Design Decisions and Trade-offs

- **Isolate state by model rather than only splitting the UI.** A side-by-side layout alone cannot produce correct follow-up conversations. Per-model histories prevent a response from one model becoming context for another, at the cost of explicit state and response-mapping management.
- **Dispatch concurrently and tolerate partial failure.** Parallel calls reduce interaction overhead, but providers can fail independently. `Promise.allSettled` allows available responses to remain visible while the failed column reaches its own error state.
- **Persist response maps and order explicitly.** A comparison is useful only if it remains interpretable after restoration. Storing both response ownership and model order adds persistence complexity but preserves the comparison structure.
- **Match model IDs conservatively.** Exact IDs are preferred; prefix and remaining-pair matching address configuration changes. When matching is unsafe, the implementation falls back to the ordinary history representation instead of guessing another model's answer.

## Running the Project

1. Open `chrome://extensions/` or `edge://extensions/`, enable Developer mode, choose **Load unpacked**, and select this repository directory.
2. Configure credentials for at least three available models in the extension settings.
3. Open a public webpage, select the models, and submit one question about the page.
4. Save and restore the session to verify that its ordered multi-model response group is retained.

## Key Implementation Areas

- [`js/chat.js`](js/chat.js): multi-model dispatch, independent stream rendering, model-specific histories, and response matching.
- [`js/main.js`](js/main.js): session snapshots, local persistence, and reconstruction of ordered multi-model response groups.
- [`js/content.js`](js/content.js): webpage-content extraction and context preparation.
- [`js/obsidian-export.js`](js/obsidian-export.js): templated Obsidian export with optional AI metadata.
- [`manifest.json`](manifest.json): Manifest V3 extension entry points and browser permissions.

## Future Improvements

- Add an automated benchmark using a fixed prompt set to compare serial and parallel completion time, including p50 and p95 measurements.
- Add automated tests for history isolation, model-ID matching, partial provider failure, and session restoration.