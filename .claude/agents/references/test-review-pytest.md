# Test review reference: pytest

Read by `test-reviewer` for `test_*.py` files. The generic criteria are in the agent; this file is what is specific
to testing Python scripts here.

## Why these are easy to write uselessly

The code under test is a script: an installer, a validator or a hook, each run as a subprocess the way its real
caller runs it. `subprocess.run(..., check=False)` never raises, so a test that does not assert on the result
passes whatever the script did, a crash included. And a script that writes under `HOME` writes into the real
`~/.claude` of whoever runs the test, unless the test moves `HOME` first.

## Failure modes

1. **A result nobody checks.** A `subprocess.run` whose `returncode` is not asserted, or a test whose only assert
   is that the call returned, passes when the script crashes. Assert the exit code and the decision's own text in
   `stdout` or `stderr`. A traceback exits 1, the same code as a deliberate refusal, so a refusal test needs both.
2. **A refusal with no allowed sibling.** A script that always refuses passes every refusal test. Each decision
   needs a case that differs only in the property the script reads, and the allowed case needs evidence the work
   happened (a file written, a stub call logged).
3. **A sandbox that leaks to the machine.** `HOME`, `PATH` and git's global config shape what the script does. A
   test that leaves them to the machine passes on one and not another, and an installer under test can write the
   author's real files. The environment passed to the subprocess is built from scratch or copied and overridden,
   with `HOME` under `tmp_path`, `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`. Check that every
   subprocess call in the file gets that environment, not only the first.
4. **A stub that proves nothing.** A stubbed `claude` or `git` that records nothing lets the script pass wrong
   arguments or skip the call. Where the call is the contract, assert on the stub's log, including that a refused
   path made no call.
5. **A substring that matches more than the decision.** `"refus" in result.stderr` passes on a usage line, a
   traceback or a path in the fixture. Match the line only that decision prints, and keep fixture names from
   containing it.
6. **A parametrized case that tests the same decision.** Cases differing only in input the script treats alike are
   one test counted twice, criterion 4's redundancy. Each case earns its place by reaching a different branch.
7. **A test of an internal.** Importing the script to call one of its functions tests below the boundary the suite
   policy draws. The exception is a pure parser whose only consumer is the script, where a subprocess run would
   test the same thing with more setup; report it as a judgment call.

## Running a forced failure

- Run one test with `python -m pytest -p no:cacheprovider -v -k '<name>' <file>`, then the whole file to see what
  else failed.
- pytest prints the failing assert with its values. Match it to the assertion you meant to probe before counting the
  failure: an error in a fixture fails the test without reaching any assert, and pytest reports it as `ERROR`, not
  `FAILED`.
- A test that imports a package `requirements-dev.txt` pins fails at collection when that package is missing. That
  is an environment error, not a finding; install the pins and run again.
