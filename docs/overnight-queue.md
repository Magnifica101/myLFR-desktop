# Overnight queue

Work that can be completed without a human present. An agent drains this queue
unattended, opens a pull request per task, and leaves the results for review.

This file is a **queue, not a history**. A finished task is deleted from it. The
record of what was done lives in the commit, the branch, and the pull request.
The only summary kept here is `Last run`, which holds one run at a time and is
replaced at the start of the next.

Outcomes are written to `Last run` as each task finishes, not collected at the
end. An agent compacts between tasks, so anything held only in its context is
not reliable by the end of the run.

## Last run

No runs yet.

<!--
Replaced at the start of every run, then appended to as each task finishes.
It only ever holds one run. While a run is in progress:

**2026-08-25 — in progress**

- Completed: <task title> — PR #NN
- Skipped: <task title> — needs a decision on <what>, left in the queue.

Finalised at the end of the run by replacing the heading line:

**2026-08-25** — 3 tasks: 2 completed, 1 skipped.
-->

## Operating rules

These are the standing instructions for an unattended run.

### Starting the run

1. Read this file. It is the source of truth, not your context.
2. The run branch is `overnight/YYYY-MM-DD`, using today's date. It is derived,
   never invented, so it can always be recomputed rather than recalled.
3. If that branch already exists, **a run is in progress or was interrupted**.
   Check out its copy of this file. It is authoritative twice over: `Last run`
   records what has already been done, and `Pending tasks` has already had those
   tasks removed, so whatever is still listed is still undone. Continue from
   there rather than restarting.
4. Otherwise create the branch from `main`, replace `Last run` with today's date
   and `in progress`, commit, push, and **open its pull request immediately**. A
   run that dies halfway must still leave a visible record of what it finished.

### Each task

5. Re-read this file before starting a task. Compaction between tasks is
   expected; this is what makes it safe.
6. `git checkout main && git pull`, then branch for the task. Never start a task
   from another task's branch or from the run branch.
7. Do not stop to ask permission. That is the point of this queue.
8. Three attempts per task, then stop that task and move to the next one. This
   mirrors the controlled-attempt protocol in `HANDOFF.md`.
9. Never weaken a check to make something pass — not a test, not a type, not a
   validation gate, not a lint rule. If the only way forward is to lower a bar,
   the task is not eligible; skip it.
10. Every gate must pass before a task counts as done:
    `npm test`, `npx tsc --noEmit`, `cargo test --manifest-path src-tauri/Cargo.toml`,
    `cargo fmt --manifest-path src-tauri/Cargo.toml`, and, when the catalogue or
    workflows are touched, `npm run security:policy` and `npm run catalogue:validate`.
11. **Never edit this file from a task branch.** A task pull request contains
    the work and nothing else. The queue is drained from the run branch instead,
    under rule 12.

    This is not tidiness. Every task deletes a different part of this one file,
    so if task branches edited it, each merge would conflict — and neither side
    of that conflict is right, because the correct answer is to keep *both*
    deletions, which is a resolution Git never offers. Draining from the single
    run branch means the conflict cannot arise.

### Finishing each task — before moving on

12. **Record the outcome and drain the task, in one commit.** Check out the run
    branch, append one line to `Last run` naming the task and its pull request
    number or the reason it was skipped, delete the task from `Pending tasks`,
    then commit and push. A skipped task is *not* deleted — it stays queued.
13. Do this even when the task failed or was skipped, and do it before starting
    the next task. An outcome that exists only in your context will not survive
    compaction, and the end-of-run summary must never depend on recalling it.
14. Because the deletion happens as each task finishes, this file is accurate at
    every moment of the run, not only at the end. A run that stops halfway
    leaves a queue that is already correct: whatever is still listed is still
    undone. Nothing needs reconstructing, and no task needs marking as
    incomplete — an incomplete task was simply never deleted.

### Git

15. **Never commit or push to `main`.** Branch per task, push the branch, open a
    pull request, leave it open for review. The run branch follows the same
    rule.
16. No merges, no force-pushes, no branch deletions, no tags, no releases.

### Ending the run

17. When the queue is empty or no remaining task is eligible, check out the run
    branch and finalise `Last run`: replace the `in progress` heading with the
    totals. Every line is already there from rule 12, and the queue is already
    drained, so this is tidying, not recalling. Commit and push to the existing pull request.

**Abort the whole run** — not just the task — if any of these appear: a failed
database or backup integrity check, an unexpected push or merge to `main`,
anything touching signing material or certificate stores, or evidence that
operational data has changed. Record what happened in `Last run` under rule 12
and stop.

## What is eligible

The test is not "is this well specified", and it is not "can it be finished
without a human ever looking at the result". It is:

> Can the agent get to the end of this without needing me?

A task qualifies if the agent can complete it alone and leave something to be
judged in the morning. It is disqualified when the agent would have to **stop
part-way and wait** — for a decision only the author can make, for a credential
or a device only the author has, for a machine state only the author can create,
or for an answer to a question the task did not settle in advance.

**Visual work is eligible.** A change whose appearance the author will review
afterwards is fine: reviewing is not intervening. Say so in the task — state
that the look needs review, and what the agent must not decide on the author's
behalf — and give the run something it can still verify by command, such as the
behaviour underneath the appearance. A task with nothing provable at all is a
weak task, but a task whose *styling* is judged later is a normal one.

**The disqualifying question is not "will a human look at it" but "will a human
be needed before it can finish".** A task that cannot progress without pressing
a button on the author's Windows machine, toggling a network connection, or
choosing between two designs the author has not chosen between, is not an
overnight task no matter how well it is written.

### Research tasks

Research is eligible, but it cannot be verified by a command, so it carries its
own rules instead:

- The output is **one new document** under `docs/research/`. A research task
  touches nothing else — no code, no tests, no product documentation, no
  `FEATURES.md` entry.
- **Every factual claim carries a source link.** No link, no claim. Prefer
  primary sources — legislation, gazette notices, the regulator's own pages —
  over commentary.
- Keep what a source says separate from what you infer from it, and label
  inference as inference.
- Report contradictions and gaps rather than resolving them. "Two sources
  disagree, here is both" is a finding. Picking one silently is not.
- **Establish currency.** Say what is in force as at the date of the research,
  and give that date. Prefer sources that state their own currency, such as a
  legislation reprint's "as at" date. Treat undated pages and PDFs as suspect,
  and say so when a source's currency cannot be established.
- Where a rule has changed, record the previous rule, the change, its date, and
  the instrument that made it. A rule that changed is itself a finding — it
  usually explains why the position seemed confusing.
- State plainly at the top of the document that it is unverified research and
  not a basis for changing the application.
- If the research suggests the product is wrong, say so in the document and
  stop. Proposing a change is the author's call, not the run's.

A research task is done when the document exists, every claim is cited, and the
unresolved questions are listed explicitly.

**Never eligible, without exception:**

- Releases, signing, publishing, installers, or anything in `HANDOFF.md`
- The Windows machine, installed application, or certificate trust stores
- Live or installed databases, backups, or restores
- Writes to Supabase, or use of the catalogue signing key
- Dependency upgrades, or anything that spends money
- Anything irreversible, or anything outside this repository
- Decisions that are the author's to make: licensing, pricing, terms, or
  product direction

## Relationship to FEATURES.md

`FEATURES.md` is the product backlog: what capability is wanted and why, in the
author's terms. This file is execution: a scoped, verifiable unit of work an
agent can complete tonight.

They overlap but are not the same list. A backlog entry may be too large, too
undecided, or too visual to be queued here, and a queue task may be pure
maintenance that never belonged in the backlog at all.

When a queued task completes a backlog entry, follow the existing rule in
`FEATURES.md`: remove the entry and add the delivered capability to
`README.md`. Do that in the same pull request as the work — `FEATURES.md` and
`README.md` are ordinary files a task may edit. This queue file is the
exception, and is never touched from a task branch (rule 11).

## Task template

```
### Short task title

- Added: YYYY-MM-DD
- Type: change | research   (omit for a change task)
- Acceptance: <a command that must pass, or an observable this run can record>
- Scope: <files or areas this task may touch>

What needs doing and why. State plainly what would make this task ineligible —
the decision it must not make on the author's behalf.
```

## Pending tasks

No pending tasks.
