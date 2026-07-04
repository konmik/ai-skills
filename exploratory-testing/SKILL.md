---
name: exploratory-testing
description: Explore code to discover hidden bugs through systematic inspection, hypothesis-driven test writing, and targeted fixes. Use when the user wants to harden an area, find hidden bugs, or improve test coverage with tests that matter.
user_invocable: true
---

# Exploratory Testing

Systematically inspect code areas to discover unknown defects. The process follows a reconnaissance-hypothesis-probe cycle: read the code and its invariants, form hypotheses about where bugs hide, write tests that confirm or disprove each hypothesis, and fix any bugs found. Designed to run unattended via `/loop /exploratory-testing`. Progress is tracked in `temp/exploratory-testing-plan.md` in the project root (gitignored) so each invocation picks up where the last one left off.

## Process

Each area goes through three phases:

1. **Reconnaissance** -- read the target code, its callers, specs, and existing tests. Understand invariants, state transitions, concurrency model, and error propagation. Identify what existing tests cover vs miss.

2. **Hypothesis formation** -- form specific, testable hypotheses about defects: logic errors in real code paths, state corruption on partial failure, shape mismatches between producer and consumer, silent failures. Every hypothesis must pass the realism filter (see below). Each hypothesis becomes a test plan item.

3. **Probing** -- write a test for each hypothesis and run it. A passing test (GREEN) either covers an important invariant or is discarded as redundant. A failing test (RED) proves a bug exists; fix the production code at the root cause layer, not the test and not a downstream consumer.

This is code inspection with automated verification -- not fault injection or mutation testing.

## Realism Filter

Every hypothesis must pass this filter before it enters the test plan. The goal is to find bugs that real users will hit, not theoretical flaws that require impossible inputs.

For each hypothesis, trace the call chain from the entry point (UI, CLI, scheduled job) down to the function under test. Ask: can the problematic input actually arrive through this chain? If every caller already guarantees valid input, the hypothesis is theoretical -- discard it.

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

Modes:

- `/exploratory-testing` -- **broad sweep**: if no plan exists, analyze the codebase and create one with 3-6 areas; if a plan exists, execute the next step. Uses early exit (3 consecutive GREEN tests = move on) to maximize bug yield across many areas.
- `/exploratory-testing <area>` -- **deep dive into a single area**: create a plan with one area matching the argument (package name, file, or feature keyword), then execute every hypothesis until all are exhausted. No early exit -- every test plan item is written and run. When all items are checked, generate additional hypotheses if bugs were found (bugs often cluster). Done only when no more realistic hypotheses remain.

## Plan File

`temp/exploratory-testing-plan.md` in the project root directory (not the skill directory). The `temp/` folder is gitignored. Format:

```markdown
# Exploratory Testing Plan

## Area 1: sync/ListenerServiceImpl
Status: recon | testing | done
Why: [one line on why this area is risky]

### Recon Notes
[filled in during recon step -- concise findings, max ~10 lines: key invariants, realistic concerns, and a brief list of discarded hypotheses with one-line reasons]

### Test Plan
- [ ] `closeScope race during scope replacement` -- hypothesis: ...
- [x] `download with empty cursor` -- GREEN, kept (covers invariant)
- [x] `upload skips on Firestore rejection` -- RED, fixed in a1b2c3d

## Area 2: database/TransactionRepository
Status: pending
Why: [one line]
```

Statuses: `pending` -> `recon` -> `testing` -> `done`

## Execution: What To Do Each Invocation

Read `temp/exploratory-testing-plan.md`. Determine the next step based on plan state, then **spawn a single Agent to execute it**. Each step runs in a fresh agent context to keep the loop lightweight.

Pass the agent:
- The section of the plan file for the area being worked on (from `## Area N` to the next `## Area` or end of file) -- the agent does not need other areas' content
- The specific step to execute (from the step descriptions below)
- The plan file path (`temp/exploratory-testing-plan.md`) so it can update progress

When the agent completes:
1. Read the plan file to verify it was updated correctly (right checkbox format, status change, etc.)
2. Briefly report what it did (one line)

### No plan file exists -> Agent: Create Plan

Tell the agent to:

1. Identify high-risk, under-tested areas. Look for:
   - **Complex state transitions** -- state machines, multi-step workflows, lifecycle management
   - **Concurrency and ordering** -- shared mutable state, race conditions between concurrent operations
   - **Data integrity boundaries** -- persistence, sync, serialization, cross-system data flow
   - **Error propagation paths** -- operations that depend on prior operations succeeding, result chains
   - **Recently changed code** -- `git log --oneline -20` to find areas with recent churn
   Cross-reference each candidate against existing tests to find gaps.

2. Create `temp/` directory if it doesn't exist. Write `temp/exploratory-testing-plan.md` with 3-6 target areas, ordered by risk. All areas start with `Status: pending`.

### First `pending` area exists -> Agent: Reconnaissance

Tell the agent to:

1. Change the area's status to `recon`.

2. Read the target code, its callers, and existing tests thoroughly. Understand invariants, state transitions, concurrency model, error propagation, and what existing tests cover vs miss.

3. **Trace call chains to their origin.** For each function under test, identify every caller back to the entry point. Understand what inputs can actually arrive at runtime. This is the most important step -- it determines whether a hypothesis is realistic or theoretical.

4. Identify bug hypotheses and apply the Realism Filter. Discard hypotheses where the problematic input cannot arrive through actual callers. For each surviving hypothesis, describe the concrete user action or system event that triggers it.

5. Fill in `### Recon Notes` with concise findings (max ~10 lines): key invariants, realistic concerns identified, and a brief list of discarded hypotheses with one-line reasons. Detailed architecture summaries belong in the code, not the plan. Add `### Test Plan` with 3-8 specific test hypotheses as unchecked items using `- [ ]` checkbox format. Each item must name the realistic trigger scenario. Change status to `testing`.

### Area in `testing` with unchecked test items -> Agent: Write and Run One Test

Tell the agent which test item to execute (the first unchecked one). The agent must:

1. Write the test. Follow the project's testing conventions as documented in CLAUDE.md. The test should:
   - Target the specific bug hypothesis from the plan
   - Set up the precondition that triggers the bug
   - Assert the correct behavior

2. Run the test using the project's test command from CLAUDE.md.

3. **If GREEN** (test passes): delete the test -- no bug was found, so there is nothing to commit. Update the plan item:
   ```
   - [x] `test name` -- GREEN, deleted (no bug found)
   ```

4. **If RED** (test fails): bug found. Fix the production code at the root cause layer (not the test, not a downstream consumer):
   - Diagnose the root cause. Ask: which layer is producing the wrong behavior? Fix the source, not the consumers.
   - Fix the code at the source of the problem
   - Run the test again to confirm it passes
   - Run the full test suite to check for regressions
   - Compile to verify no build breakage
   - Update the plan item:
     ```
     - [x] `test name` -- RED, fixed: <one-line description>
     ```
   - Commit the test and fix together (see Rules for commit handling).

### Area in `testing` with all items checked -> Finalize Area

No agent needed. Change status to `done` in the plan file directly.

**Early exit (broad sweep mode only)**: if the first 3 tests in an area are all GREEN with no bugs found, mark the area as `done` and move on. The skill's purpose is finding bugs -- pure coverage work has diminishing returns. This rule does NOT apply in deep dive mode (`/exploratory-testing <area>`), where every hypothesis is tested.

### Area in deep dive mode with all items checked -> Re-Reconnaissance or Finalize

In deep dive mode (`/exploratory-testing <area>`), when all test plan items are checked:

If at least one test was RED (bug found and fixed), run a re-reconnaissance pass -- fixes change assumptions, so re-examine the changed code with fresh eyes:

1. Re-read the target code, callers, and any code touched by fixes.
2. If the new recon produces hypotheses, append them to the test plan as unchecked items and continue testing.
3. Mark as `done` ONLY when a recon pass produces zero new hypotheses. State this explicitly in the plan: "Re-recon complete, no further hypotheses identified."

If all tests were GREEN (no bugs found, no code changed), skip re-recon and mark the area as `done` immediately. The code is unchanged, so re-examining it would produce the same hypotheses that were already tested or discarded.

### All areas `done` -> Finish

No agent needed. Write a summary at the top of the plan file:

```markdown
## Summary
- **Bugs found and fixed**: N
- **Tests added**: N
- **Areas covered**: list
- [one line per bug: what was wrong and how it was fixed]
```

Report to the user that the plan is complete.

## Rules

- One unit of work per invocation. This keeps commits granular and lets the loop pace itself.
- **Commits**: only commit when a bug is found and fixed (RED tests). GREEN tests are deleted -- they proved no bug exists, so they add no value. Commit the fix and its test together after each RED result. No commit happens when an area finishes with only GREEN results.
- Never ask the user questions -- make decisions autonomously.
- If a test is ambiguous (unclear whether it's a real bug or a test design issue), re-check the realism filter. If no real caller can trigger the scenario, discard the test. Only keep it if you can name a concrete user action that triggers the bug.
- If compilation or tests fail in a way the agent can't fix, mark the test as ignored and move on to the next item.
- Never delete `temp/exploratory-testing-plan.md`. To start a new run, add a new plan section below the existing one.
- Test plan items MUST use `- [ ]` checkbox format. If an agent writes items without checkboxes, fix them before proceeding.
