---
title: Comparing Harness Variants
type: note
permalink: experiments/overview
tags: [experiments, benchmarks, prompts, review, cost]
verified: 2026-11-01
coverage: partial
measured_on: "Claude Code 2.1.316"
---

# Comparing Harness Variants

> **Scope.** How to run two or more versions of an agent prompt, a skill or a reviewer against each other and read the result: building the bench, defining arms, grading, reading noise, costing, the hazards a comparison meets, tuning and when to stop. The `#measured` lines come from planted-defect review benches and mutant-graded test-writing benches run on Claude Code 2.1.316. Not covered: significance testing, since no gap here was tested statistically.

Read this before designing a comparison between harness variants, and again before reading its results to decide what
ships. Every rule here guards against a way a comparison can mislead.

## Observations

### Building the bench

- [invariant] A planted-defect bench tags each defect plain (visible in the hunk), context (needs a file outside the diff) or deep (needs reasoning about runtime or platform behaviour), and spreads them, most in context: a defect every arm finds, or none does, says nothing about the arms.
- [fact] Too easy fails at the top: on a 12-defect bench four of six arms scored 12/12, and on a 22-defect bench one reviewer alone found 18 #measured (code-review bench)
- [fact] Too obscure fails at the bottom: two design defects of the 22-defect bench were missed by every arm in every run, and two prose defects of the 24-defect bench likewise #measured (code-review bench)
- [fact] The 24-defect bench, tagged 5 plain, 12 context and 7 deep, spread its arms' runs from 15 to 21 #measured (code-review bench)
- [invariant] The bench change reads like a real pull request from a competent, hurried author, with no comment, tone or clustering that hints at a bench, and its builder does not read the reviewers' definitions: a defect shaped to a reviewer's checklist measures the checklist.
- [invariant] A behaviour defect is kept only when its fix passes every existing test and a throwaway probe shows an input that goes wrong; an equivalent mutation, where no input behaves differently, is dropped. Without the probe a hit may be on no defect at all.
- [invariant] The answer key gives each defect an id, its tag, the location on the new side, what is wrong, the input or existing code that shows it, and what goes wrong, and it lists every imperfection the builder knows of and did not plant, so a real find outside the key is not scored as noise.
- [risk] The key can be wrong: one run stated platform behaviour that contradicts a key item, and the item was left unchecked (seen once). A key item an arm disputes is checked before it is counted.
- [invariant] A change judged to have shipped clean is reviewed alongside the bench as the false-positive measure, since a planted bench cannot show what an arm raises when there is nothing to find.
- [fact] Two single-reviewer runs on a clean merged change raised 0 Critical and 0 High findings, and 3 Normal findings each that read as true and minor #measured (code-review bench)
- [invariant] A test-writing bench is graded by mutants of a hidden reference implementation: rule-style mutants (one operator, constant or call changed) and spec misses (a plausible wrong reading of one rule). Each mutant is a text replacement whose original must occur exactly once in the reference, since one that matches twice or not at all mutates the wrong thing #silent-failure
- [invariant] Every grader is run on known answers before any arm: the oracle suite catches every mutant, and a deliberately weak suite catches few (3 of 37 on one kit). A grader never run on a known answer is an unchecked check.
- [fact] A cold read of a toy specification by a fresh agent found five gaps, all closed before any arm ran #measured (test-author bench)
- [trap] A test that is red on the reference is a kit fault until shown otherwise: the reference, not the arm, can be the one that departs from the spec's literal words, and the kit's run command can name a binary not on the path
- [invariant] An arm that improves something is run on subjects with room to improve: on a suite already catching 35 of 37 mutants, gains of one either way were inside noise #measured (test-author bench)

### Arms

- [invariant] Each arm differs from its baseline in one thing, such as effort, model, one paragraph of prose or one structural step. An arm that changes several measures only their sum: one arm here differed from another in a coordinator, a lens and routing at once, and a later arm had to remove the coordinator alone to say anything about it.
- [invariant] Each arm runs as what would ship, launched the way a user launches it: the shipped agent with the arm's prose added, not a bare session given the prose another way.
- [invariant] Each run starts from a fresh copy of the bench in a persistent directory, with the same flags (permission mode, MCP config, cache lifetime), and records a hash of the change under review before and after: a run that changed it is void, and a temporary directory can be emptied between rounds.
- [invariant] Setup an arm needs and the bench does not, such as an agent directory or a profile, is committed in the run's copy, and the setup then checks that `git diff HEAD` is still exactly the bench change.

### Grading

- [invariant] A separate matcher grades findings against the key: an agent with read access only, told to judge nothing beyond what a match needs. The person who built the arms reads intent into a finding that the finding does not state.
- [fact] The matcher's classes were `hit` (the same defect at the same place, with a claim that would lead to the fix), `partial`, `known` (on the not-planted list), `real` (a genuine problem neither list names) and `noise`; one finding may hit two defects.
- [invariant] Match lines are spot-checked against the key, and `real` stays the matcher's word until checked by hand: in the first probe every line was checked and found right, and later out-of-key counts were never checked.
- [invariant] Both each reviewer's own output and the final merged report are scored, since a merge can drop a hit: one panel run found 21 defects and its report carried 20 #measured (code-review bench)
- [trap] A model judging code quality agreed with itself within a round while its ranking of arms swung between rounds, so one round's ranking reflects the code each run happened to write #measured (test-author bench)
- [trap] Reversing the order of an odd number of files leaves the middle one in place, so a judge's position bias is spread by rotating the order, not reversing it #order-dependent

### Reading results

- [invariant] Results are read per run: score, the ids missed, cost, turns, time, real finds outside the key, noise and size added. A pooled mean hides a run that collapsed and hides arms whose misses are disjoint.
- [fact] One arm scored 21 and then 15 on the same bench with a complete report both times, and on one suite two reviewer arms each found mutants the other missed #measured
- [fact] Repeat spreads seen: about 2 defects per arm on the 22-defect bench, at least 6 on the 24-defect bench, and ranges such as 27 to 33 mutants over three runs of one test-writing arm #measured
- [invariant] Each arm gets at least two runs per bench, and a gap counts only when it is larger than the spread one arm shows across repeats. A gap in one direction across benches but inside each bench's noise is a lead to test, not a result.
- [invariant] An arm's change is shown to have taken effect before it is credited: turns, output tokens and the files the run read tell whether an instruction was followed.
- [fact] An arm told to take one pass per lens matched its baseline's turns, time and output tokens, so its two-defect lead was most likely not the instruction; effort set in an agent's frontmatter did take effect, at 51k to 52k output tokens on high against 23k to 31k on medium #measured
- [invariant] Side effects are scored beside the score: a cheaper arm tied on mutants caught while adding three times the test cases, and an arm that edits a suite can lose a mutant the suite caught before, which needs its own column.
- [invariant] A run that ended without a report, through a usage limit or a crash, is missing data to rerun, never a zero.

### Costing

- [fact] Per-agent cost came from the transcripts: each assistant turn's tokens weighted by price ratio (input 1, 5-minute cache write 1.25, 1-hour cache write 2, cache read 0.1, output 5) and scaled per model so the agents sum to the run's reported cost for that model; checked on a known run, tokens and cost summed exactly #measured
- [trap] A transcript logs one API response as several lines, one per content block, each repeating the response's usage, so a sum that does not count each message id once multiplies the cost #silent-failure
- [trap] In a headless forked-skill run the result JSON's top-level `usage` and `num_turns` are zero, while `total_cost_usd` matches `modelUsage`; take cost from those and turns from the transcripts #measured
- [trap] A run can bill a model that no transcript accounts for (a haiku model in three runs here): the run's total stays exact and the per-agent split is slightly off, so report the unmatched models #measured
- [fact] A coordinator agent cost $0.63 to $1.42 a run in the multi-agent review arms, and a forked coordinator $0.30 to $0.39, a quarter or more of a cheap run; cost it separately, since a shape change often removes exactly it #measured
- [invariant] Comparisons use API-priced cost, not a subscription meter's percentage, which is coarse and also counts the lead's own work.

### Hazards

- [invariant] A surprising result is first suspected as a fault in the check, and the check is run on a case whose answer is known: each fault below first showed as a surprising result.
- [trap] A collector that took a reviewer's last text scored a whole run 0: the reviewer had reported through a `SubagentHandback` tool call #measured
- [trap] A count of the files a run read, done by text search, matched only literal paths and missed brace expansion and `cd && cat`, so it reported almost none read when all had been #measured
- [trap] A scorer that took its key's size from a default file printed another bench's denominator and missed ids (12 for a 24-defect key) #silent-failure #measured
- [trap] A grader's pytest pattern `\S+::\S+` drops any test whose parametrize id holds a space, so its mutants read as missed; and pytest 9.1 reports a test whose `subTest`s fail as `PASSED`, with each failure on a `SUBFAILED` line of its own #silent-failure #measured
- [trap] A proposed metric, tests catching no mutant as tests that cannot fail, failed its known-answer check: all such tests in one suite were input-validation cases the mutant set barely covered, so it was dropped #measured
- [trap] A run can write its report to the default output directory instead of the one its environment names, or return it as its final text with no file, so the collector looks in every channel and flags a missing report rather than scoring one
- [trap] A headless forked run ends when the fork ends its turn, so a command it left running in the background is cut off, which for a test reviewer left a deliberate break in the code, as [[Skill Loading]] records. An arm that may run headless runs long commands in the foreground, and the tree is checked after every run #silent-failure
- [trap] Arms run in parallel share one usage window, so a run can stop before writing its report

### Tuning and stopping

- [decision] Prompts are tuned only with general practice a careful practitioner would follow anyway, never with checks shaped like the bench's planted defects, and a change is kept only if it gains beyond noise without much added cost; otherwise the simpler prompt ships (owner, 2026-11-01): a prompt tuned to the bench scores well on it and breaks on real work.
- [fact] Two targeted changes failed: an instruction to compare each change with precedent gained nothing and the misses it aimed at stayed missed, and a rule against rebuilding fixtures failed its only test and was dropped #measured
- [invariant] An idea chosen after seeing a round's results is checked on a bench it was not chosen on before it ships, or it is fitted to that bench's misses.
- [decision] Comparison stops once the remaining arms sit inside one another's noise and the defects left are ones no arm reaches, and the simplest of the tied arms ships (owner, 2026-11-01): further arms then measure the bench, not the variants.
- [fact] Both experiments reached that point: the means of the seven single-agent review arms at high effort fell between 16.5 and 18.5 on each of the 22- and 24-defect benches, and one mutant was missed by all 15 runs of five test-writing arms and by every reviewer arm after them #measured

## Relations

- see_also [[Skill Loading]]
