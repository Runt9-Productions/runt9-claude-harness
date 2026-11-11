---
title: Leak Review Read Coverage
type: note
permalink: projects/leak-review-read-coverage/overview
tags: ["leak-scan", "pre-push"]
status: implementation
opened: "2026-11-11"
---

# Leak Review Read Coverage

Stops the leak review from refusing a push because the model misreported how far it read an input (issue #144). It
ends when `harness/leak-scan/review.sh` decides coverage from what the review actually read.

## Where it stands

- [status] Spec approved; being built from the checklist

## Documents

- [[Leak Review Read Coverage Checklist]]: the units of work and which is live
- [[Leak Review Read Coverage Decisions]]: rulings taken and questions still open
- [[Leak Review Read Coverage Spec]]: the per-file map
- [[Leak Review Read Coverage Estimate]]: the size

## Relations

- see_also [[Development Process]]
- see_also [[Leak Review]]
