---
name: fix-properly
description: Architecture-aware and idiomaticity-aware fix
---

# Fix Properly

The root cause is almost never a missing check or fallback. It is a wrong architectural decision or absent methodology. Do not patch symptoms. Fix the design.

1. Read the surrounding architecture.
    - Understand why the code is shaped this way.
    - Understand the data flow and the order of events.
    - Check CONTEXT.md, ADRs, and nearby modules.
2. Trace the root cause to the architectural decision that made the bug possible.
3. If there is no failing test that reproduces the bug yet, write one. Watch it fail.
    - If the issue is happening inside a dependency, do not test the dependency. Test the code that uses the dependency.
    - Only reproduce using realistic use cases. If the test causes a failure but the path is not realistic, we are not fixing the actual issue but an imaginary one.
4. Fix the issue. The fix must be:
   - An **ambitious** architectural change that prevents the entire class of similar bugs in this area.
   - An **idiomatic** solution that high-quality projects employ in similar situations.
   - The idiomatic solution must be based on **web-search** results.
   - If the fix results in a violation of ADRs, data loss, invalid state, or other issues, it is not a proper fix. Zoom out, rethink the approach, and make a better fix.
5. Watch the test pass.
