# Welcome to Mappa

Welcome, builder! Mappa is a behavioral engine that turns media into structured insight. This guide is here to make the journey fun, fast, and friendly.

Think of Mappa as a curious co-pilot:
- It listens to media.
- It understands behavior.
- It delivers reports you can ship.

If you can make HTTP requests, you can integrate Mappa.

## What you can do

- **Generate reports** from remote URLs or uploaded media.
- **Pick a template** that matches your task.
- **Track long-running jobs** with polling or streaming.
- **Use webhooks** to get notified when work is done.
- **Send feedback** to improve results.

## Templates at a glance

- `sales_playbook` — optimized for conversion and persuasion.
- `general_report` — balanced, all-purpose behavioral report.
- `hiring_report` — aligned to a role and company culture.
- `profile_alignment` — compares speaker to an ideal profile.

Required template params:
- `hiring_report`: `roleTitle`, `roleDescription`, `companyCulture`
- `profile_alignment`: `idealProfile`

## Choose your path

- [Quickstart](quickstart.md) — get a report in minutes.
- [Core concepts](concepts.md) — understand jobs, media, and outputs.
- [SDK guide](sdk.md) — practical usage patterns.
- [Webhooks](webhooks.md) — event-driven workflows.
- [Errors & retries](errors.md) — friendly failure handling.
- [Recipes](recipes.md) — handy copy/paste snippets.

## A tiny mindset shift

Mappa work is **asynchronous**. You create a job, then either wait, stream, or listen for a webhook. Once you embrace that rhythm, everything feels smoother.

Grab a beverage of choice, and let’s build something wonderful.