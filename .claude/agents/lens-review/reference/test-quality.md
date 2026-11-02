# Lens: test-quality

Judges the tests a diff adds or changes by reading them beside the code they drive, asking of each whether a plausible wrong implementation would fail it, whether its name claims only what it asserts, whether its scenario can happen and whether another test already catches the same defect, and names the behaviour the change adds that no test covers. It never runs or edits anything.

## The question

Would the tests in this change fail if the code they cover were wrong?

## Before the diff

Read "Test-quality traps" in `.claude/code-review-profile.md`, and the test references for the kinds of test in the
diff under `.claude/agents/references/` (`test-review-pytest.md`, `test-review-shell.md`, `test-review-mod-kit.md`).

## In scope

Judge each added or changed test against four criteria. They are independent: a test can pass three and fail one.

1. **A wrong implementation would fail it.** Name a plausible wrong implementation and say, from the code, whether
   the test goes red under it. Watch for what lets a wrong one pass:
   - a stub or fixture whose default answer also satisfies the assertion;
   - an assertion on a value nothing in the test writes, or a fallback such as `?? ''` that hides a missing one;
   - an input the code ignores that happens to equal the default;
   - start, empty and boundary values where right and wrong agree;
   - an expected value computed from the actual output;
   - unseeded randomness.
2. **The name claims only what is asserted.** Every behaviour the name promises is checked, and it promises nothing
   the assertions leave out.
3. **The scenario can happen.** Inputs and state that real callers can produce.
4. **No other test reports the same defect.**

Then name the behaviour the change adds that no test covers, one line per rule, where a wrong implementation of it
would ship with every test green.

## Out of scope

Whether the production code is correct belongs to `correctness`; style in test files to `code-health`. Report a
production defect you notice in passing as an open question.

## How far to read

Each changed test whole, every helper and stub it uses, and all production code that can affect a value it asserts.
Judge by reading; do not run tests or change any file.

## Severity

High for a test that cannot fail, or one whose name claims a guarantee it does not check, since it reports safety
that is not there. Normal for an untested rule, a redundant test, or an unreachable scenario. Never Critical.
