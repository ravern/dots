---
name: gravernloop
description: Get a GitHub pull request genuinely ready to merge through Greploop remediation, a final Apex review, CI, E2B, and a migration-to-human-review gate; use production Greptile by default, optionally include staging with --include-staging or -s, and optionally run start/end Deslopify passes with --include-deslopify or -d. Use when asked to prepare, polish, or verify a PR for merge readiness.
---

# Gravernloop

Use `greptile:greploop` as the review-remediation baseline, with the stricter completion gates below. Do not report a PR ready merely because one review has passed or while the final E2B build is pending.

## Choose Options

- By default, require only `greptile-apps[bot]`. Ignore staging-bot output when deciding merge readiness, and do not wait for a staging review.
- With `--include-staging` or `-s`, require both `greptile-apps[bot]` and `greptile-apps-staging[bot]` throughout the remediation loop and final merge gate.
- With `--include-deslopify` or `-d`, invoke `deslopify` once before the first Greptile review and once during the final cleanup phase. Without this option, do not invoke `deslopify` as part of Gravernloop.
- Treat these as Gravernloop invocation options. Do not pass them to another command unless that command explicitly supports them.

## Identify The PR And Required Bots

1. Resolve the PR from an explicit number or the current branch. Switch to its head branch if necessary.
2. Mark the PR ready for review if it is still a draft before triggering or evaluating reviews.
3. Record the current head SHA before every verification round.
4. Inspect current-head check runs, PR reviews, issue comments, and inline comments for every bot required by the selected review scope.
5. Every required bot must reach `5/5` with no unresolved actionable feedback. When staging is included, a missing staging review is not a pass: trigger or wait for it through the `greptile:greploop` workflow. Without the staging option, do not wait for or remediate `greptile-apps-staging[bot]` output.
6. Inspect the complete PR diff for added migration files, using the repository's established migration directories and naming conventions. Before starting the remediation loop, explicitly tell the user when the PR adds migrations, list their paths, and state that the PR requires additional human review before it can merge. Record the result for the final report. Continue remediation unless the user says to stop; migrations require a human-review handoff and block Gravernloop completion but do not prevent review and remediation work.

Use the current head SHA for check-run queries, not a previous push:

```bash
PR=<number>
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
HEAD_SHA=$(gh pr view "$PR" --json headRefOid -q .headRefOid)
gh api --paginate "repos/$REPO/commits/$HEAD_SHA/check-runs?per_page=100"
gh api --paginate "repos/$REPO/pulls/$PR/reviews?per_page=100"
gh api --paginate "repos/$REPO/issues/$PR/comments?per_page=100"
gh api --paginate "repos/$REPO/pulls/$PR/comments?per_page=100"
```

## Optional Deslopify Passes

When `--include-deslopify` or `-d` is selected:

1. After identifying the PR and reconstructing its intent, but before the first Greptile review, invoke `deslopify` on the complete PR diff. Apply its focused simplifications, run its proportional validation, then commit and push any changes before starting the remediation loop.
2. Invoke `deslopify` once more after Greptile remediation is clean or the fifth iteration is exhausted, before the final merge gate and PR summary. Review the complete final diff so slop introduced during remediation is also considered.
3. If the final pass changes code, validate, commit, and push it. Re-run every required Greptile, CI, and E2B check against the new head before reporting the PR ready. Any additional Greptile remediation still counts toward the five-iteration maximum. If the limit is already exhausted, report the unverified new head as a blocker and set `Ready for merge: no`.

Run exactly one start pass and one end pass per Gravernloop invocation, not one pass per remediation iteration. Preserve the PR intent and Deslopify's own scope boundaries in both passes.

## Remediation Loop

Repeat at most five times. Each iteration must operate on the latest PR head.

1. Follow the `greptile:greploop` trigger, feedback collection, fixing, thread-resolution, commit, and push workflow. Collect feedback from every required bot, rather than accepting only the most recent bot review.
2. Classify the collected review comments before acting:
   - If a comment identifies a clear bug in the code relative to the PR's stated intent, make the smallest correction without expanding the PR's scope.
   - If a comment requires a product or implementation decision, needs user approval, or would substantially increase the PR's scope rather than fixing a clear bug toward its intent, do not fix or resolve it yet. Collect all such comments across the required bots and ask the user about them in one batch. For each, briefly explain the choice and ask whether to implement the change or resolve the comment as non-actionable.
3. Apply the user's decisions for the batched comments. Do not choose a scope-expanding change or resolution on the user's behalf.
4. Resolve only threads whose underlying issue is fixed or is conclusively non-actionable, and explain any false-positive resolution.
5. Inspect all current-head CI checks after each push. For every failed, cancelled, timed-out, or otherwise non-passing test/check owned by this repository:
   - open the failing GitHub Actions run and logs with `gh run view`;
   - reproduce the focused failure locally when feasible;
   - implement and test the fix; then commit and push it as the next loop iteration.
6. Treat infrastructure outages, permission failures, and confirmed flakes as blockers, not successes. Record their check URLs and evidence; do not claim merge readiness while a required check remains failing or indeterminate.
7. Ignore only *in-progress* E2B checks during intermediate iterations. Do not wait for them before continuing review or CI remediation. A completed E2B failure on the current head remains a failure to investigate.
8. Maintain a deduplicated feedback ledger across iterations. For every review comment addressed, record its URL and author, whether it was valid or invalid, and either how the valid issue was fixed or why the invalid comment was resolved without a code change.

## Preserve PR Intent

Treat review feedback as a request for the smallest verified correction. Keep fixes precise and targeted to the reported defect; do not broaden scope, redesign adjacent behavior, or change the original intent of the PR unless the user chooses that option through the batched decision step.

## Final Apex Review

At the end of the remediation loop, after the optional final Deslopify pass, request an Apex review by posting this exact PR comment:

```text
@greptileai apex review
```

Record the head SHA and wait for the Apex result before the final merge gate. A posted request or an ordinary Greptile review does not establish that Apex completed. Use the PR-comment trigger specified in the [team guidance](https://greptile.slack.com/archives/C07KYRW95QA/p1790119736019099); do not assume the CLI supports Apex.

Apply the existing feedback classification, batched human-decision, thread-resolution, and feedback-ledger rules to Apex findings. Any further remediation counts toward the same five-iteration limit. After a code change, push and reverify the required Greptile, CI, and E2B results, then request Apex again on the new head. If the limit is exhausted, report remaining Apex findings as blockers. A missing or pending Apex result also blocks completion.

## Final Merge Gate

After the last code change and after all required Greptile feedback is clean, re-read the current PR head and verify all of the following:

- The complete current PR diff adds no migration files. Any added migration requires additional human review, makes Gravernloop incomplete, and sets `Ready for merge: no`, even when every automated review and check passes.
- Each required Greptile bot has a current, successful `5/5` review and no unresolved actionable comments.
- Apex has completed on the current head with no unresolved actionable findings.
- All required non-E2B CI checks on the current head pass.
- Every current-head E2B check is terminal and successful. At this final gate, poll pending E2B checks rather than ignoring them.
- The branch is pushed and has no uncommitted intended changes.
- If Vercel provides a preview, capture the user-facing `Preview` URL for each affected app. Prefer the preview URL from the matching project row in the Vercel bot comment, not the deployment inspector URL. A missing preview is not a blocker.

If a new push changes the head SHA while waiting, restart the final gate for the new SHA. Never count a passing review, CI run, or E2B build from an older commit.

## Report

After every final gate passes or the loop reaches five iterations, post exactly one Gravernloop summary comment on the PR. Post the comment on unsuccessful runs too; do not wait for another invocation. Include the same result in the user-facing response and link to the posted summary comment.

When human decisions remain open, spell them out in the final response in the current chat thread, even if they were already asked asynchronously or documented on the PR. For each decision, state the concrete issue, the available choices and their scope or behavior consequences, your recommendation, and the linked review comment. Ask the user to choose. Do not replace this with a count, a link alone, or vague wording such as "an ownership-scope decision remains open." Keep these decisions separate from pending automated checks and the routine migration human-review gate; "additional human review required" does not explain an open product or implementation decision. Include the same open decisions in the PR summary.

Report `ready for merge` only after every final gate passes. Use this structure for the PR comment:

```markdown
## Gravernloop summary

- PR: #<number>
- Iterations: <n>/5
- Greptile bots: `greptile-apps[bot]` (5/5) <!-- append staging only with --include-staging or -s -->
- Apex: completed on `<head-sha>`; no unresolved actionable findings (<review-url>)
- Deslopify: <not requested | concise start-pass and end-pass results>
- Migrations: none
- CI: passing
- E2B: passing on `<head-sha>`
- Vercel preview: <url> <!-- omit when unavailable -->
- Gravernloop: complete
- Ready for merge: yes

### Review comments addressed

- <comment-url> by `<author>`: **Valid**
  - Resolved by: <concise description of the code change>
- <comment-url> by `<author>`: **Invalid**
  - Reason: <concise explanation for resolving without a code change>
```

Include every entry from the feedback ledger. Do not collapse the ledger to a count. When no review comments were addressed, write `None` under that heading.

If the PR adds migrations, report `Migrations: added (<paths>); additional human review required`, `Gravernloop: incomplete`, and `Ready for merge: no`. List the migration paths and state that the next action is additional human review of those migrations. If the loop stops after five iterations or any other gate remains unresolved, also set `Gravernloop: incomplete` and `Ready for merge: no`, list the remaining comments and blocking bots/checks with links, and state the next concrete action. Do not present a partial pass as completion.
