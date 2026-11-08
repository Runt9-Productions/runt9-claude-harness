# typescript-go-lsp

Gives Claude Code's `LSP` tool answers for TypeScript and JavaScript: definitions, references, implementations, call
hierarchy, hover, document symbols and workspace symbols. The plugin runs the language server built into TypeScript 7,
`tsc --lsp --stdio`, for `.ts`, `.mts`, `.cts`, `.tsx`, `.js`, `.mjs`, `.cjs` and `.jsx` files.

## Installing

```
/plugin marketplace add Runt9-Productions/runt9-claude-harness
/plugin install typescript-go-lsp@runt9
```

## Requirement

TypeScript 7 installed globally (`npm install -g typescript@7`) under the Node that launches Claude Code. The plugin
runs whichever `tsc` is first on `PATH`, never a project's own copy and never `npx`, so a project without TypeScript
installed still gets a server, and starting one never fetches a package.

## Traps

- **Answers are complete only inside a project with a `tsconfig.json`.** With no config covering a file, the server
  builds a project from the files the tool has opened so far and what they import. A reference or caller in any other
  file is missing, and the tool reports a short list or "No incoming calls found" with nothing to show that the
  answer is partial.
- **References are searched only in the project that owns the file asked about.** A file with a `tsconfig.json`
  nearer than a wider project's belongs to the nearer project, and uses of its symbols in files only the wider
  project covers are missing. When that matters, remove the nearer config or use a text search.
- **A method that implements an interface member brings its whole family.** `findReferences` and `incomingCalls` on
  `Circle.area`, where `Circle` implements `Shape`, also return the references to `Shape.area` and to every other
  class's `area`, and the callers through them. Filter the results by file and line before reading them as calls to
  that one method.
- **Edits made outside Claude Code's file-editing tools are not seen during the session.** The server watches no
  files, and learns of a change only when the tool reopens the file after an edit through Claude Code. A file changed
  by a shell command, `git checkout` or another process keeps its old contents for the server until the session
  restarts.
