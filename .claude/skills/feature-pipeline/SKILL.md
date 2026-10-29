---
name: feature-pipeline
description: Run a feature idea or spec through the SIP Lens delivery pipeline in the standard order, product spec, system design, data design, UI design, engine, frontend, then review, using the six project agents. Use when the user provides a feature spec and says "run the pipeline", "/feature-pipeline", "build this feature end to end", or "take this spec through the agents".
---

# Feature pipeline

This repo has six dedicated agents in `.claude/agents/`. Run them in the order below. Each stage reads the previous stage's document from `docs/features/<slug>/` and writes its own, so hand-offs are files in the repo, not chat memory. If the agents are not registered as subagent types in the current session, spawn a general-purpose agent with the agent file's body as the opening of the prompt.

## Order and gates
| # | Agent | Reads | Writes | Gate before the next stage |
|---|---|---|---|---|
| 0 | `product-manager` | the idea, request or supplied PRD | `00-spec.md` | **Hard stop: user approval required.** See "Spec approval" below. Nothing runs past this row until the user says the spec is approved. If the user already supplied a full spec, save it as `00-spec.md` and still ask for approval before stage 1. |
| 1 | `system-design` | 00 | `01-system-design.md` | Show the user the open-questions section and the assumptions. Stop here if an open question would change the design materially; otherwise continue. |
| 2 | `dba` | 01 | `02-database-design.md`, `scripts/*` | No real statement was read or committed. Dataset scripts are dry-run by default. |
| 3 | `ui-design` | 00, 01 | `03-ui-design.md` | Deviations list is empty or each item is justified. |
| 4 | `backend-engineer` | 01, 02 | engine code, tests, `docs/engine.md` | `npm test` output is in the report and the no-network test exists and passes. |
| 5 | `ui-developer` | 01, 03, engine | code, `docs/screens.md` | Browser verification per fixture, viewport and theme is in the report; the network panel showed only static assets. |
| 6 | review | the diff | findings | Run `/code-review` on the branch and fix confirmed findings before reporting done. |

Stages 4 and 5 may run in parallel once stage 1's module contracts are frozen, but only if the user asks for parallel work; the default is sequential so each report can be checked.

## Spec approval (after stage 0, always)
1. Read `00-spec.md` back and present it to the user as a decision, not a summary: the problem statement, the Must-have stories by number, the MoSCoW cut, the success metrics, the open questions with the assumption taken for each. Keep it short enough to read in two minutes; link the file for the full text.
2. Ask for a decision with AskUserQuestion when available, with three options: **Approve** (proceed to stage 1), **Revise** (the user gives changes), **Stop** (park the feature). In a non-interactive session, end the turn with the same three options in text and wait; never infer approval.
3. On Revise: send the user's changes back to the same `product-manager` agent via SendMessage so it keeps its context, have it rewrite `00-spec.md`, then present it again. Repeat until Approve or Stop. Do not start stage 1 during a revision loop.
4. On Approve: append to the end of `00-spec.md`:
   ```
   ---
   Approved by: <git user name> on <YYYY-MM-DD>
   ```
   and only then start stage 1. Stage 1 and every later stage must refuse to run if this line is missing from `00-spec.md`; say so and go back to the approval step.
5. On Stop: leave the spec in place without the approval line and summarise what exists.

## How to run it
1. Decide the input: a raw idea or a one-paragraph request goes to stage 0, where `product-manager` writes `docs/features/<slug>/00-spec.md`. A full spec the user already wrote is saved there as-is and stage 0 is skipped. Derive `<slug>` from the feature name in kebab-case.
2. Create a branch `feat/<slug>` from the current branch if not already on one.
3. For each stage, spawn the agent with the Agent tool, `subagent_type` set to the agent name, and a prompt that states: the slug, the path of the spec and the previous documents, the exact file it must write, and that it cannot ask questions and must record assumptions instead.
4. After each stage, read the document it wrote, check the gate, and relay a three-line summary to the user before starting the next stage. Do not skip the gate. The stage 0 gate is different from the others: it is an explicit approval, not a summary; the later gates are checks you perform and report.
5. After stage 6, summarise: documents written, files changed, tests and verification run, open questions, and what remains.

## Running one role alone
The user may ask for a single stage ("just do the system design for this", "audit the tax estimator"). The `product-manager` agent also has an audit mode for shipped features that writes `docs/features/<feature>-audit.md` and feeds the backlog rather than the pipeline. Run only that agent, with the same prompt shape, and point out which upstream document it is missing if any.

## Rules that always apply
Everything in `CLAUDE.md`: local-first with no network calls, no stored financial data, no real statements in the repo, tested money math, no advice, browser verification for frontend work. Commit only when the user asks.
