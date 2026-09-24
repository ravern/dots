// Run: node --experimental-strip-types tasks.test.ts
import assert from "node:assert/strict";
import {
  barePaths,
  capTasks,
  closeBlockers,
  deriveTasks,
  linkChild,
  parseReport,
  parseStoredTasks,
  reportDescription,
  rawIds,
  reportSchema,
  segments,
  threadRefs,
  sortTasks,
  viewTask,
  isNewThemeDispatch,
  isTheme,
  mentionId,
  parseMentionId,
  ARM_TTL_MS,
  type ChildInfo,
  type DispatchFacts,
  type Task,
} from "./tasks.ts";

const child = (id: string, over: Partial<ChildInfo> = {}): ChildInfo => ({
  id,
  title: `title ${id}`,
  projectId: "proj",
  providerId: "codex",
  parentThreadId: "thr_coord",
  status: "idle",
  displayStatus: "idle",
  hasPendingInteraction: false,
  queuedWork: "none",
  busy: false,
  archivedAt: null,
  createdAt: 100,
  updatedAt: 200,
  ...over,
});
const parse = (over: object = {}) => parseReport(JSON.stringify({ outcome: "done", description: "radius now 12.5px", ...over }), 1000);
const report = (over: object = {}) => parse(over).report;

// Report parsing: defaults, "none" → null, strict keys, invalid JSON, size cap.
assert.equal(report().needsYou, null);
assert.equal(report({ needsYou: "None" }).needsYou, null);
assert.equal(report({ needsYou: "Approve deploy" }).needsYou, "Approve deploy");
// Dropped fields (undo/verified/notVerified) are accepted and discarded.
assert.equal("undo" in report({ undo: "x", verified: "y", notVerified: "z" }), false);
assert.equal(parse({ title: "hide more models button" }).title, "hide more models button");
assert.equal(parse().title, null);
assert.throws(() => parseReport("{nope", 1), /not valid JSON/);
assert.throws(() => parseReport("", 1), /no report JSON/);
assert.throws(() => parse({ outcome: "finished" }), /outcome/);
assert.throws(() => parse({ extra: 1 }), /Unrecognized key/);

// Description: required, ≤10 words, `result` accepted as its legacy name.
assert.equal(report({ description: "one two three four five six seven eight nine ten" }).description?.split(" ").length, 10);
assert.throws(() => parse({ description: "one two three four five six seven eight nine ten eleven" }), /11 words; shorten to ≤10/);
assert.throws(() => parseReport(JSON.stringify({ outcome: "done" }), 1), /description: required/);
const legacyInput = parseReport(JSON.stringify({ outcome: "done", result: "unread dot now blue" }), 1).report;
assert.equal(legacyInput.description, "unread dot now blue");
assert.throws(() => parse({ result: "also this" }), /use description only/);
assert.throws(() => parseReport(JSON.stringify({ outcome: "done", result: "a b c d e f g h i j k" }), 1), /11 words/);
// Stored legacy report (result, no description) displays the same way.
const legacyStored = reportSchema.parse({ outcome: "done", summary: "old", result: "25px → 12.5px", undo: "", verified: "", notVerified: "", needsYou: null, reportedAt: 1 });
assert.equal("undo" in legacyStored, false);
assert.equal(reportDescription(legacyStored), "25px → 12.5px");
assert.equal(reportDescription(reportSchema.parse({ outcome: "done", summary: "only summary", needsYou: null, reportedAt: 1 })), "only summary");
assert.equal(reportDescription(report()), "radius now 12.5px");

// File references: only as markdown links; link text counts as words, the URL doesn't.
assert.equal(report({ description: "[plan](/Users/me/.bb/thread-storage/t/plan.md) updated" }).description, "[plan](/Users/me/.bb/thread-storage/t/plan.md) updated");
assert.equal(report({ description: "[plan.md](~/notes/plan.md) and [app](./src/app.css) done" }).needsYou, null);
assert.throws(() => parse({ description: "see /Users/me/plan.md" }), /description: bare file path "\/Users\/me\/plan.md"; link files instead/);
assert.throws(() => parse({ description: "updated plan.md today" }), /bare file path "plan.md"/);
assert.throws(() => parse({ description: "edited ~/.bb/config" }), /bare file path/);
assert.throws(() => parse({ description: "changed (app.css)." }), /bare file path "app.css"/);
assert.throws(() => parse({ needsYou: "review /tmp/report.md" }), /needsYou: bare file path/);
assert.deepEqual(barePaths("radius now 12.5px, e.g. v0.2 and/or bb.app"), []);
assert.equal(report({ description: "[one two three four five six seven eight nine](/x/y.md) ten" }).outcome, "done");
assert.throws(() => parse({ description: "[one two three four five six seven eight nine ten](/x/y.md) eleven" }), /11 words/);
assert.equal(report({ description: "[a](/very/long/path/that/has/many/segments/plan.md) b c d e f g h i j" }).outcome, "done");

// No semicolons in either display field.
assert.throws(() => parse({ description: "radius fixed; layout checked" }), /description: use one short phrase, no semicolons/);
assert.throws(() => parse({ needsYou: "pick red; or blue" }), /needsYou: use one short phrase, no semicolons/);

// Ids: thread ids are allowed (rendered as chips, one word each); other bb ids are rejected.
assert.equal(report({ description: "follow-up in @thread:thr_abc123xyz0 done" }).outcome, "done");
assert.equal(report({ description: "follow-up in thr_abc123xyz0 done" }).outcome, "done");
assert.equal(report({ description: "a b c d e f g h i @thread:thr_abc123xyz0" }).outcome, "done");
assert.throws(() => parse({ description: "a b c d e f g h i j @thread:thr_abc123xyz0" }), /11 words/);
assert.throws(() => parse({ description: "paused (auto_klgjcanrsuc)" }), /description: raw id "auto_klgjcanrsuc"; describe it in words, e\.g\. 'hourly sync automation'/);
assert.throws(() => parse({ description: "moved to proj_b3jb8sahm5" }), /raw id "proj_b3jb8sahm5"/);
assert.throws(() => parse({ needsYou: "approve env_7vespkktpr reuse" }), /needsYou: raw id "env_7vespkktpr"/);
assert.throws(() => parse({ description: "merged into t_2fff64f549" }), /raw id/);
assert.deepEqual(rawIds("in thr_rfiicir69p, sec_iiqtsk8bjs and host_ehp5pw85jr; retain_non_pr stays"), ["sec_iiqtsk8bjs", "host_ehp5pw85jr"]);
assert.deepEqual(rawIds("see [auto_klgjcanrsuc notes](/x/y.md)"), ["auto_klgjcanrsuc"]);
assert.deepEqual(rawIds("see [notes](/x/auto_klgjcanrsuc.md)"), []);
// Display: thread refs split into chips; markdown links stay whole; other ids stay as text.
assert.deepEqual(segments("fixed in thr_rfiicir69p (auto_klgjcanrsuc)"), [
  { kind: "text", text: "fixed in " },
  { kind: "thread", id: "thr_rfiicir69p" },
  { kind: "text", text: " (auto_klgjcanrsuc)" },
]);
assert.deepEqual(segments("see @thread:thr_a1b2c3 and [log](/threads/thr_zzz999)"), [
  { kind: "text", text: "see " },
  { kind: "thread", id: "thr_a1b2c3" },
  { kind: "text", text: " and [log](/threads/thr_zzz999)" },
]);
assert.deepEqual(segments("no ids here"), [{ kind: "text", text: "no ids here" }]);
assert.deepEqual(threadRefs("thr_a1b2c3 then @thread:thr_a1b2c3 and thr_d4e5f6"), ["thr_a1b2c3", "thr_d4e5f6"]);

// needsYou: separate field, ≤15 words.
assert.throws(() => parse({ needsYou: Array(16).fill("w").join(" ") }), /needsYou: 16 words; shorten to ≤15/);
assert.equal(report({ needsYou: Array(15).fill("w").join(" ") }).needsYou?.split(" ").length, 15);

// Untrusted metadata: invalid tasks dropped; title is optional.
assert.deepEqual(parseStoredTasks({ tasks: [{ id: "x" }, 5] }), []);
assert.deepEqual(parseStoredTasks(null), []);
assert.equal(parseStoredTasks({ tasks: [{ id: "t", childThreadIds: [], createdAt: 1, updatedAt: 1 }] }).length, 1);

// Implicit task per unlinked direct child; linked children don't duplicate.
const stored: Task[] = [{ id: "t_1", title: "grouped", childThreadIds: ["thr_a", "thr_b"], createdAt: 1, updatedAt: 1 }];
const derived = deriveTasks(stored, [child("thr_a"), child("thr_c")]);
assert.deepEqual(derived.map((d) => [d.task.id, d.implicit]), [["t_1", false], ["t_c", true]]);

const byId = (...children: ChildInfo[]) => new Map(children.map((c) => [c.id, c]));
const t = (childThreadIds: string[], over: Partial<Task> = {}): Task => ({ id: "t", childThreadIds, createdAt: 1, updatedAt: 1, ...over });
const view = (task: Task, ...children: ChildInfo[]) => viewTask(task, false, byId(...children));

// Titles: own title wins, else first child's live title, else id.
assert.equal(view(t(["a", "b"], { title: "fix radius" }), child("a"), child("b")).displayTitle, "fix radius");
assert.equal(view(t(["a", "b"]), child("a"), child("b")).displayTitle, "title a");
assert.equal(view(t([])).displayTitle, "t");

// One status, priority order.
// 1. needs approval beats everything, including needsYou and running.
assert.equal(view(t(["a", "b"], { report: report({ needsYou: "decide" }) }), child("a", { status: "active" }), child("b", { hasPendingInteraction: true })).status, "needs-approval");
// 2. needs you (idle + needsYou) shows instead of the outcome, and beats running.
const idleNeedsYou = view(t(["a"], { report: report({ needsYou: "pick a model" }) }), child("a"));
assert.equal(idleNeedsYou.status, "needs-you");
assert.equal(idleNeedsYou.attention, true);
assert.equal(view(t(["a"], { report: report({ needsYou: "pick" }) }), child("a", { status: "active" })).status, "needs-you");
// 3. running (just "Running"; stale reports are only used for priority).
const running = view(t(["a"]), child("a", { status: "active" }));
assert.deepEqual([running.status, running.attention], ["running", false]);
assert.equal(view(t(["a"]), child("a", { queuedWork: "waiting" })).status, "running");
assert.equal(view(t(["a"]), child("a", { busy: true })).status, "running");
const runningAfterReport = view(t(["a"], { report: report() }), child("a", { status: "active", lastTurnRequestedAt: 2000 }));
assert.equal(runningAfterReport.status, "running");
assert.equal("previousOutcome" in runningAfterReport, false);
// A resumed child makes a needsYou report historical too.
assert.equal(view(t(["a"], { report: report({ needsYou: "pick" }) }), child("a", { status: "active", lastTurnRequestedAt: 2000 })).status, "running");
// 4. outcome from the report.
for (const outcome of ["done", "blocked", "failed", "cancelled"] as const) {
  assert.equal(view(t(["a"], { report: report({ outcome }) }), child("a")).status, outcome);
}
assert.equal(view(t(["a"], { report: report() }), child("a")).attention, false);
assert.equal(view(t(["a"], { report: report({ outcome: "blocked" }) }), child("a")).attention, true);
// 5. awaiting report: idle, no report (a finished turn is not a finished task).
const awaiting = view(t(["a"]), child("a"));
assert.deepEqual([awaiting.status, awaiting.attention, awaiting.line], ["awaiting-report", true, null]);
// Resumed then idle again: awaiting a fresh report.
const resumedIdle = view(t(["a"], { report: report() }), child("a", { lastTurnRequestedAt: 2000 }));
assert.equal(resumedIdle.status, "awaiting-report");

// Description cell: needsYou alone replaces the description; otherwise the description.
assert.deepEqual(idleNeedsYou.line, { needsYou: true, text: "pick a model" });
assert.deepEqual(view(t(["a"], { report: report() }), child("a")).line, { needsYou: false, text: "radius now 12.5px" });
assert.deepEqual(view(t(["a"], { report: legacyStored }), child("a")).line, { needsYou: false, text: "25px → 12.5px" });
// needsYou still shows while a child also awaits approval; a resumed child makes it stale.
assert.deepEqual(view(t(["a"], { report: report({ needsYou: "decide" }) }), child("a", { hasPendingInteraction: true })).line, { needsYou: true, text: "decide" });
assert.deepEqual(view(t(["a"], { report: report({ needsYou: "decide" }) }), child("a", { status: "active", lastTurnRequestedAt: 2000 })).line, { needsYou: false, text: "radius now 12.5px" });
// Extras: errored child without a report; closed history without a report.
assert.equal(view(t(["a"]), child("a", { status: "error" })).status, "error");
const archived = view(t(["a"], { report: report() }), child("a", { archivedAt: 5 }));
assert.deepEqual([archived.status, archived.closed, archived.attention], ["done", true, false]);
assert.equal(view(t(["a"]), child("a", { archivedAt: 5 })).status, "closed");
assert.equal(view(t(["a"])).children[0].missing, true);

// Sorting: attention first.
const sorted = sortTasks([
  view(t(["a"], { id: "quiet", report: report() }), child("a", { updatedAt: 999 })),
  view(t(["b"], { id: "loud" }), child("b", { updatedAt: 1 })),
]);
assert.deepEqual(sorted.map((v) => v.id), ["loud", "quiet"]);

// Close guards.
const none = new Map<string, string[]>();
assert.deepEqual(closeBlockers(view(t(["a"], { report: report() }), child("a")), none), []);
assert.match(closeBlockers(view(t(["a"], { report: report({ outcome: "blocked" }) }), child("a")), none).join(), /outcome is blocked/);
assert.match(closeBlockers(view(t(["a"], { report: report({ needsYou: "decide" }) }), child("a")), none).join(), /needs you/);
assert.match(closeBlockers(view(t(["a"], { report: report() }), child("a", { hasPendingInteraction: true })), none).join(), /pending interaction/);
assert.match(closeBlockers(view(t(["a"], { report: report() }), child("a", { status: "active" })), none).join(), /is active/);
assert.match(closeBlockers(view(t(["a"]), child("a")), none).join(), /no report/);
assert.match(closeBlockers(view(t(["a"], { report: report() }), child("a")), new Map([["a", ["descendant x is active"]]])).join(), /descendant/);

// Linking moves a child between tasks.
const linked = linkChild([t(["a"], { id: "t1" }), t([], { id: "t2" })], "t2", "a", 9);
assert.deepEqual(linked.map((x) => x.childThreadIds), [[], ["a"]]);

// Size cap prunes oldest closed tasks, refuses when only open tasks remain.
const big = (id: string, closedAt: number | null): Task => ({ ...t([], { id, closedAt }), brief: "x".repeat(60_000) });
const capped = capTasks([big("old", 1), big("new", 2), big("open1", null), big("open2", null)]);
assert.deepEqual(capped.tasks.map((x) => x.id), ["new", "open1", "open2"]);
assert.equal(capped.pruned, 1);
assert.throws(() => capTasks([big("a", null), big("b", null), big("c", null), big("d", null)]), /exceed/);


// Theme membership: only this plugin's `role: "theme"` metadata counts.
assert.equal(isTheme({ role: "theme", tasks: [] }), true);
assert.equal(isTheme({ role: "coordinator" }), false);
assert.equal(isTheme({}), false);
assert.equal(isTheme(null), false);

// New-thread toggle: only the user's first app message on a fresh root thread while armed.
const facts = (over: Partial<DispatchFacts> = {}): DispatchFacts => ({
  attempt: "start-turn", origin: "app", initiator: "user", senderThreadId: null, queuedCount: 0,
  parentThreadId: null, threadCreatedAt: 1500, submission: null, ...over,
});
assert.equal(isNewThemeDispatch(facts(), 1000, 2000), true);
assert.equal(isNewThemeDispatch(facts(), null, 2000), false);
assert.equal(isNewThemeDispatch(facts(), 1000, 1000 + ARM_TTL_MS + 1), false);
assert.equal(isNewThemeDispatch(facts({ attempt: "join-turn" }), 1000, 2000), false);
assert.equal(isNewThemeDispatch(facts({ origin: "cli" }), 1000, 2000), false);
assert.equal(isNewThemeDispatch(facts({ initiator: "agent" }), 1000, 2000), false);
assert.equal(isNewThemeDispatch(facts({ senderThreadId: "thr_x" }), 1000, 2000), false);
assert.equal(isNewThemeDispatch(facts({ parentThreadId: "thr_p" }), 1000, 2000), false);
assert.equal(isNewThemeDispatch(facts({ queuedCount: 1 }), 1000, 2000), false);
assert.equal(isNewThemeDispatch(facts({ threadCreatedAt: 900 }), 1000, 2000), false);
assert.equal(isNewThemeDispatch(facts({ origin: "cli", submission: { theme: true } }), null, 2000), true);

// Mention ids round-trip and reject malformed input.
assert.deepEqual(parseMentionId(mentionId("thr_a", "t_b")), { coordinatorId: "thr_a", taskId: "t_b" });
assert.equal(parseMentionId("thr_a"), null);
assert.equal(parseMentionId("a~b~c"), null);

console.log("tasks tests passed");
