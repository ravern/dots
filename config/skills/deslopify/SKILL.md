---
name: deslopify
description: Identify and remove unnecessary code and test surface from a specific change while preserving the author's current intent. Use when asked to deslopify, remove code or test slop, or simplify a diff, branch, or pull request. This is a code-quality workflow, not a correctness or bug-finding review.
---

# Deslopify

Remove code that does not earn its review and maintenance cost. Judge necessity against the author's intended change, not against whether code looks AI-generated.

If the user asks to deslopify or remove slop, edit the code and verify the result. If the user asks only for an audit or review, report findings without changing files.

This skill reviews code quality, scope, clarity, structure, and test value. Do not search for bugs, conduct a general correctness or security review, or fix unrelated defects. Reason about behavior only as needed to decide whether a simplification preserves the intended requirements. If an apparent defect blocks safe deslopification, note the uncertainty without expanding the task.

## Requirements

Before reviewing the diff, reconstruct a short requirements brief by reflecting on the full current-session conversation. Treat the latest clear statements of what the author is trying to accomplish as the primary source of intent. Include requested behavior, explicit exclusions, compatibility expectations, and quality constraints even when tests do not encode them.

Supplement that intent with, in descending order of authority:

1. The issue, PR description, acceptance criteria, and direct user clarifications.
2. Existing public behavior, repository documentation, and local conventions.
3. The diff, commit messages, and nearby implementation.
4. Tests, which are evidence about requirements but never the complete definition of them.

Resolve conflicts in favor of the author's latest explicit intent. Do not revive stale requests from earlier in the session. State material inferences and uncertainty. If uncertainty could make a deletion change intended behavior, keep the code or ask the user rather than guessing.

## What counts as slop

Treat a change as proven behavioral slop when it can be removed without violating the requirements brief. Also consider code to be maintenance slop when it adds clear long-term cost without a corresponding requirement, such as:

- unrelated or speculative scope;
- abandoned experiments, debugging residue, or temporary files;
- duplicated logic when an existing repository or platform primitive fits;
- premature interfaces, factories, wrappers, indirection, configuration, or dependencies;
- pass-through layers and single-use abstractions that obscure the behavior;
- comments, documentation, types, or validation that merely restate what is already clear;
- new patterns that needlessly diverge from established repository conventions.

These are search signals, not proof. Clean-looking code can be slop, and awkward code can be required. Never use AI-authorship guesses, vocabulary, comment style, or generation volume as evidence by itself.

## Review the change

Identify the intended comparison base and inspect the complete diff plus relevant surrounding code. Preserve unrelated working-tree changes.

Map each changed file or hunk to a requirement. Investigate unmapped changes first. Search the repository for existing helpers, tests, conventions, and dependencies before accepting new machinery.

Where practical, test necessity counterfactually: remove a candidate file, hunk, branch, or abstraction and run the relevant validation. Keep the smaller version only when it still satisfies the requirements and the removal does not discard meaningful compatibility, security, performance, observability, or operational safeguards. A passing but incomplete test suite is not proof that those constraints are absent.

Prefer the smallest implementation that expresses the intended behavior using existing code, standard-library facilities, or native platform features. Make focused edits; do not turn deslopification into an unrelated rewrite.

## Review tests

Test slop adds maintenance surface without improving the ability to distinguish correct behavior from plausible faults. Examine new or modified tests for:

- assertions that are absent, tautological, overly broad, or aimed only at mocks;
- expected values produced by duplicating the implementation under test;
- excessive mocking that bypasses the behavior or boundary that matters;
- snapshots, fixtures, and case permutations whose extra volume adds no distinct signal;
- tests that only confirm lines execute, happy paths repeat, or implementation details remain unchanged;
- weakened, skipped, deleted, or rewritten assertions that make the production change pass.

For fixes, prefer red-green evidence: the relevant test fails on the pre-fix behavior and passes with the fix. When practical, revert the production fix or use mutation testing to check that the tests catch plausible faults. Coverage and a green suite alone do not establish usefulness.

Delete, combine, or strengthen test slop. Preserve deliberate redundancy when it independently protects an important invariant, platform, boundary, or past regression.

When writing or keeping unit tests:

- Keep a unit test only if it would catch a plausible real bug. Delete ones that merely restate the code they were written after; they always pass and break on every refactor.
- Before writing a unit test, list the ways the code could fail, then test those failures rather than the current implementation.

## Verify and report

Run validation proportional to the change: focused tests first, then the appropriate broader tests, type checks, linting, or build. Compare the final diff against the requirements brief and confirm that every remaining change has a reason to exist.

Report concisely:

- the intent and constraints you inferred;
- what you removed, combined, or simplified and why;
- what validation passed;
- any suspected slop retained because requirements or verification were insufficient.
