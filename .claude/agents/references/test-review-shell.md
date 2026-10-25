# Test review reference: shell tests

Read by `test-reviewer` for bats files. The generic criteria are in the agent; this file is
what is specific to testing bash scripts here.

## Why these are easy to write uselessly

Most scripts under test are guards: they exit 0 to allow and 1 to refuse. Exit 1 is also what bash produces
when the script crashes, a tool it needs is missing, or a path is wrong. So the cheapest assertion, the exit status,
is the one that cannot tell a refusal from a failure to run.

## Failure modes

1. **A refusal asserted by exit status alone.** `[ "$status" -eq 1 ]` passes when the script dies before reaching
   the check. Every refusal test also asserts the refusal's own reason in `$output` or in a stub's log, the text only
   that decision prints.
2. **A refusal with no allowed sibling.** A script that always exits 1 passes every refusal test. Each decision needs
   a case that differs from it only in the property the guard reads, and an allowed case needs evidence the check
   ran (a count of what was checked, a stub call), or a script that checks nothing passes it.
3. **A check that cannot fail outside the last line.** Bash errexit ignores a negated command (`! grep ...`) and
   every member of an `&&` or `||` list except the last, so on any line but a test's last, those never fail it.
   `run` swallows the exit status, so a `run` with no `$status` check asserts nothing about the exit. For an
   absence use `refute_grep` from `.github/scripts/tests/helpers.bash`, or in a file that does not load it, `run grep`
   then `[ "$status" -eq 1 ]`. Check `$status` after every `run` whose exit matters.
4. **A substring that matches more than the decision.** `[[ $output == *"x"* ]]` passes when `x` appears anywhere:
   in a file name the script echoes, a usage line, a temporary path, a port. Match the line the decision produces,
   and make sure the fixture's names do not contain the pattern.
5. **A stub that ignores its arguments.** A stubbed `gh` or `claude` that answers every call the same way lets the
   script pass wrong arguments. Where the arguments are the contract, assert on the stub's log. A stub's canned
   answer must be one the real tool can produce; a shape the real tool never emits is criterion 2's fiction.
6. **A fixture the author's machine shapes.** Global git config, hooks, `init.defaultBranch` and a global ignore file
   change what git does, so a fixture that leaves them to the machine passes on one and not another. Isolate them
   (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`) and set the identity inside the fixture.
7. **A leak fixture that no longer leaks.** Fixtures that must look like a leak are assembled at run time so the
   repository's own scan does not flag the test file. Check the assembled value is still a real hit for the scanner,
   with a forced failure if unsure; a value broken into pieces that never meet tests nothing.

## Running a forced failure

- Run one test with `bats -f '<name regex>' <file>`, and the whole file afterward to see what else reddened.
- bats reports the failing command and its line. Match that line to the assertion you meant to probe before counting
  the red.
