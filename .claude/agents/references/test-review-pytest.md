# Test review reference: pytest tests

Read by `test-review:test-reviewer` for `test_*.py` files. The generic criteria are in the agent; this file is what
is specific to Python tests of the scripts this repository ships.

## Why these are easy to write uselessly

The scripts under test are installers and guards run from a shell. A test that runs one with `subprocess.run` gets
back a result object and nothing fails until something asserts on it. And an installer under test writes wherever
`HOME`, `PATH` and git's config point, so a loose sandbox both passes on the wrong evidence and writes to the
reviewer's own machine.

## Failure modes

1. **An unchecked subprocess result.** `subprocess.run` without `check=True` never raises, so a setup step that
   failed (a `git commit` with no identity, a fixture script that crashed) lets the test go on against the wrong
   state. Every setup call either checks its return code or asserts it; every call to the script under test asserts
   `returncode`.
2. **A refusal a refuse-everything script would pass.** `returncode == 1` alone is also what a traceback, a missing
   tool or a bad path gives. A refusal test asserts the text only that decision prints, and has an allowed sibling
   that differs only in the property the script reads and shows the work happened: the files installed, the stub's
   record. Criterion 3.
3. **A sandbox that reaches the machine.** A test that inherits `os.environ` passes the reviewer's `HOME`, `PATH`,
   session variables and plugin settings to the script, so an installer writes into the real user's files and a
   result depends on whose machine runs it. The environment is built from nothing: `HOME` in `tmp_path`, `PATH` with
   the stub first, and `GIT_CONFIG_GLOBAL=/dev/null` with `GIT_CONFIG_NOSYSTEM=1` for every git call, the test's own
   setup included, so a global `core.hooksPath`, signing key or identity cannot change a result. Check what the
   test's own helpers pass, not only what the script receives.
4. **A stub whose record nobody asserts.** A stub `claude` or `gh` that writes its arguments to a log tests nothing
   until a test compares that log to the exact calls expected, in order. A refusal asserts the log is empty; an
   allowed case asserts it in full, since a membership check lets an extra or a misordered call through.
5. **A text match looser than the decision.** `"warning" in result.stderr`, or a path that also appears in a usage
   line or another message, passes on the wrong line. Match a phrase that only the decision under test prints, and
   check the fixture's names do not contain it.
6. **Parametrized cases on the same branch.** Each case counts as a test, so two cases that drive the same branch
   are criterion 4's redundancy with a larger count. Each case earns its place by reaching a branch no other case
   reaches; name the branch for each.
7. **An internal tested by import.** A test that imports the script and calls a function inside it is outside the
   suite policy (the profile's "Suite policy"), unless that function is the script's published contract. The script's
   boundary is its command line, environment, exit status and output.

## Running a forced failure

- Run one test with `python -m pytest -p no:cacheprovider -v <file> -k '<name>'`, and the whole file afterward to see
  what else reddened. A parametrized case is selected by its id inside the brackets of the `PASSED` or `FAILED` line.
- A `FAILED` line means an assertion or an exception inside the test body; the traceback ends at the line that
  failed, which must be the assertion you meant to probe. An `ERROR` line means a fixture failed before the test body
  ran, so no assertion was reached and the red says nothing about the test.
- The script runs as a subprocess, so its own traceback appears only in the captured `stderr` that the failure
  prints. Confirm the subprocess ran the mutated file and not a copy taken before the change.
