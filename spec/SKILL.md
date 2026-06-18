---
name: spec
description: Generate, update, or verify behavioral specs in spec/*.md. Default generates a new spec; "update" revises an existing one; "verify" checks source code compliance.
user_invocable: true
---

# Spec

Parse the argument after `/spec` to determine the command. The argument format is `[command] <topic>`, where command is optional.

- No command (just a topic): generate a new spec.
- `update <topic or path>`: update an existing spec file.
- `verify <topic or path>`: verify source code compliance with a spec file.

For update and verify, the argument can be a file path or a topic name. If a topic name is given, find the matching spec file in `spec/`. If the argument is ambiguous, ask.

## Command: generate

Write a behavioral spec for the given topic.

### Steps

1. Search the codebase to find the implementation of the topic. Read the relevant source files thoroughly.
2. Write a spec file at `spec/<topic-slug>.md`.

### Spec format

A spec exists so a developer can review a brief description instead of reading through large amounts of code. If the spec is not brief, it defeats its purpose.

- Title: `# <Topic Name>`
- Body: nested bullet lists in plain English
  - No code, no pseudocode
  - Short sentences
  - Represent control flow with nesting
  - Bullets in order of execution
  - Start with inputs, mentions side effects made in the middle, finish with outputs

### Don't

- Don't split into sections, a spec is a description of a single control flow.
- Do not specify code details such as types, endpoint and cli parameters.
- Do not mention details that do not affect control flow, side effects or outputs

### Example

```
# Ticket Sync

- Stage all files and commit if dirty
- Resolve upstream tracking branch
  - No upstream exists
    - Push
    - Done
- Squash: if more than 1 commit ahead of upstream, soft-reset and re-commit as one
- Fetch
- Rebase onto upstream (no-op if not behind)
  - Rebase fails with conflict
    - Return "conflict"
  - Rebase fails for other reason (e.g. hook)
    - Return error
- If there were local commits, push
- Done
```

## Command: update

Revise an existing spec to match the current implementation.

### Steps

1. Read the spec file at the given path.
2. Read the source files that implement the behavior described in the spec.
3. Identify discrepancies: steps in the spec that no longer match, missing steps, changed control flow.
4. Update the spec to match the implementation. Follow the same format rules as generate.
5. Report what changed.

Do not make the spec more detailed than it already is. Match the existing level of granularity. Only fix what is inaccurate.

## Command: verify

Check whether the source code complies with a spec.

### Steps

1. Read the spec file at the given path.
2. Search the codebase to find the implementation. Read the relevant source files.
3. Walk through each spec bullet and check whether the implementation matches.
4. Report findings as a list:
   - Compliant items (brief, one line each).
   - Violations: quote the spec bullet, describe what the code does instead, and name the file and line.
   - Spec drift: behavior in the code that the spec does not mention.
5. End with a summary: compliant, number of violations, number of drift items.
