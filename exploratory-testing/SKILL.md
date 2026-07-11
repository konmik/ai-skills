---
name: exploratory-testing
description: Discover hidden bugs in one pass via a reconnaissance-hypothesis-probe cycle.
disable-model-invocation: true
---

# Exploratory Testing

Discover unknown defects through a reconnaissance-hypothesis-probe cycle: read the code and its invariants, form hypotheses about where bugs hide, write a test per hypothesis, and fix whatever turns RED at the root cause. The whole run completes in a single invocation.

Usage: `/exploratory-testing <scope>` -- pick the 3-6 riskiest areas within the scope and work through them.

## Realism Filter

Every hypothesis must pass this filter before it enters the test plan. The goal is to find bugs that real users will hit, not theoretical flaws that require impossible inputs.

For each hypothesis, trace the call chain from the entry point (UI, CLI, scheduled job) down to the function under test -- this tracing is the most important step of recon. Ask: can the problematic input actually arrive through this chain? If every caller already guarantees valid input, the hypothesis is theoretical -- discard it.

**Discard:**

- Redundant validation for internal functions whose callers already guarantee correct input
- Scenarios that require contract violations no real caller can produce
- Type-level imprecisions that every consumer already handles correctly
- Hardening against error shapes or values that real code never produces

**Prioritize:**

- Logic errors in code paths that run during normal use
- Mismatches between what a producer sends and what a consumer reads
- Wrong-layer problems where the fix belongs at the source, not in downstream consumers
- State corruption from partial failure that persists after the operation
- Silent data loss where an operation appears to succeed but drops data

## Process

### 1. Pick areas

Identify high-risk, under-tested areas within `<scope>`. Look for:

- **Complex state transitions** -- state machines, multi-step workflows, lifecycle management
- **Concurrency and ordering** -- shared mutable state, race conditions between concurrent operations
- **Data integrity boundaries** -- persistence, sync, serialization, cross-system data flow
- **Error propagation paths** -- operations that depend on prior operations succeeding, result chains
- **Recently changed code** -- `git log --oneline -20` to find areas with recent churn

Cross-reference each candidate against existing tests to find gaps. Order areas by risk, then work them one at a time through the steps below.

### 2. Reconnaissance

Read the target code, its callers, specs, and existing tests thoroughly: invariants, state transitions, concurrency model, error propagation, and what existing tests cover vs miss.

Form bug hypotheses and apply the Realism Filter. For each surviving hypothesis, name the concrete user action or system event that triggers it. Track survivors as a checklist of 3-8 test items for the area.

### 3. Probe -- one test at a time

For each item on the area's checklist:

1. Write the test following the project's testing conventions from CLAUDE.md: set up the precondition that triggers the hypothesized bug, assert the correct behavior.

2. Run it using the project's test command from CLAUDE.md.

3. **If GREEN** (test passes): no bug -- delete the test and check the item off.

4. **If RED** (test fails): bug found. Diagnose which layer produces the wrong behavior and fix the production code at that source layer -- not the test, not a downstream consumer. Re-run the test to confirm it passes, run the full test suite for regressions, and compile. Commit the test and fix together, then check the item off.

### 4. Finalize the area

- 3 consecutive GREEN tests finish the area immediately -- the skill's purpose is finding bugs, and pure coverage work has diminishing returns. Move to the next area.
- Checklist exhausted with at least one RED: bugs cluster and fixes change assumptions. Re-recon: re-read the target code, callers, and any code touched by fixes; append new hypotheses to the checklist and continue probing. The area is done only when a recon pass produces zero new hypotheses.
- Checklist exhausted with all GREEN: the code is unchanged, so re-recon would repeat itself. The area is done.

### 5. Report

When all areas are done, report to the user: bugs found and fixed (one line each: what was wrong, how it was fixed, commit), tests added, areas covered, and notable hypotheses discarded as unrealistic.

## Rules

- Commit only RED results: the fix and its test together, one commit per bug.
- Never ask the user questions -- make decisions autonomously.
- If a test is ambiguous (real bug vs test design issue), re-apply the Realism Filter: keep it only if you can name a concrete user action that triggers the bug.
- If compilation or tests fail in a way you can't fix, skip the item and move on.
