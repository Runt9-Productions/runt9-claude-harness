# Test review reference: mod kit tests

Read by `test-reviewer` for `*.test.ts` and `*.test.tsx` files under `plugins/`. These import `claude-code/testing`,
register handlers that answer the engine calls a mod makes, and drive the mod through engine events.

## Failure modes

Also apply the "Test-quality traps" section of `.claude/code-review-profile.md`: kit stubs that answer everything,
and stand-ins for another plugin.

1. **A cast that admits fiction.** `as never` or `as unknown as` on an event or a handler's answer bypasses the
   engine's types, so a fixture can carry a shape the engine never sends. Check each cast fixture against the types
   Claude Code writes to the plugin's `.claude-plugin/types/`; criterion 2 applies.
2. **An empty result that is the starting state.** `expect(mailbox).toEqual([])` holds when nothing ran. It proves
   something only beside a sibling test showing the same path can fill it.
3. **A test of a helper rather than the mod.** The boundary is the engine events the mod registers on. A test that
   imports an internal function and calls it directly is outside the suite policy, unless that function is the
   mod's published contract.

## Running a forced failure

`claude plugin test plugins/<name>` runs every test file in the plugin; read the `(fail)` lines and the counts. It
runs each file in its own child process, so a failure in one file does not stop the others.
