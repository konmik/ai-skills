---
name: fix-properly
description: Architecture-aware and idiomaticity-aware fix
argument-hint: "[tdd] [prompt]"
arguments: [mode, prompt]
---

# Fix Properly

The root cause is almost never a missing check or fallback. It is a wrong architectural decision or absent methodology. Do not patch symptoms. Fix the design.

**Parameters:** This skill takes an optional `mode` argument (`$mode`) and an optional `prompt` (`$prompt`). If `$mode` is `tdd`, a failing test that reproduces the bug is mandatory (step 3 is required). Otherwise a test is optional but recommended. If `$prompt` is provided, it describes the bug or issue to fix — use it as the starting point for investigation.

Execute strictly in order, do not skip. Each step is critical:

1. Read the surrounding architecture.
    - Understand why the code is shaped this way.
    - Understand the data flow and the order of events.
    - Check CONTEXT.md, ADRs, and nearby modules.
2. Trace the root cause to the architectural decision that made the bug possible.
3. Reproduce with a test.
    - When `$mode` is `tdd`: Mandatory. If there is no failing test that reproduces the bug yet, write one. Watch it fail. The test MUST fail before fixing, use TDD workflow. If there is a TDD skill, use it.
    - Otherwise: Optional but recommended. Write a reproducing test when it is cheap and the bug is hard to verify by inspection.
    - If the issue is happening inside a dependency, do not test the dependency. Test the code that uses the dependency.
    - Only reproduce using realistic use cases. If the test causes a failure but the path is not realistic, we are not fixing the actual issue but an imaginary one.
4. Use the WebSearch tool to find the idiomatic fix.
    - Search for how high-quality projects solve this kind of problem.
    - Check at least two sources. Confirm API versions match.
    - Prefer official docs and well-maintained open-source examples.
    - Do NOT skip this step. Do NOT rely on training data for the fix approach.
5. Fix the issue. The fix must be:
   - An **ambitious** architectural change that prevents the entire class of similar bugs in this area.
   - An **idiomatic** solution that matches what you found in step 4.
   - If the fix results in a violation of ADRs, data loss, invalid state, or other issues, it is not a proper fix. Zoom out, rethink the approach, and make a better fix.
6. If a reproducing test exists (written now or already present), watch it pass.
