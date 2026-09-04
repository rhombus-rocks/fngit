# fngit — spec

Owner's brief, 2026-09-03. Ruled items are stated as requirements; proposals are marked as such.

## What it is

A JS library and a CLI, published to npm from this repo. Written in TypeScript.

- **The library** exposes tools for locating repos.
- **The CLI**, `fngit`, is a decorator over the `git` CLI.

## Library

Extract the repo-location logic from **fncode** (`~/src/fncode@fnrhombus`, `src/repo/*`), which
already does all of this for `fncode <ref>`:

- parses a user-typed reference in several patterns — `<name>`, `<name>@<owner>`,
  `<owner>/<name>`, `gh:<owner>/<name>`, `https://…`, `git@…`, `ssh://…`, each with an optional
  `+workspace` suffix (`src/repo/ref.ts`);
- finds existing local clones according to config — `repoSettings.cloneTemplate` plus
  `additionalSrcDirs`, loaded from the four-tier `settings.json` chain (`src/repo/local-clones.ts`,
  `src/repo/repo-settings.ts`, `src/repo/template.ts`, `src/repo/host-aliases.ts`);
- when a bare name has no local clone, looks through the user's GitHub orgs via `gh` to find which
  owner has it (`src/repo/owner-lookup.ts`, `src/repo/gh-runner.ts`);
- computes the clone URL and the templated destination path, and clones (`src/repo/clone.ts`,
  `src/repo/clone-exec.ts`, `src/repo/clone-failure.ts`);
- orchestrates the above (`src/repo/resolve-input.ts`).

### The locate function

Returns a discriminated union, roughly:

```ts
type Located =
  | { type: "local";  path: string; /* …repo details */ }
  | { type: "remote"; url: string;  /* …repo details */ };
```

- `local` — a clone already exists on disk; `path` is where.
- `remote` — no local clone; `url` is where it would be cloned from.
- "repo details" in both arms: the parsed reference (host, owner, name, workspace) and whatever
  else the resolver learned — the exact field set is the implementer's call, and should come from
  fncode's existing `RepoRef` rather than a new shape.

An **auto-clone argument**: when set, a `remote` result is cloned the configured way (same
template-driven destination fncode uses) before returning, so the function always returns
`local`.

## CLI

`fngit` wraps `git` in a decorator pattern:

- `fngit clone fnclaude` figures out which repo `fnclaude` refers to (via the library) and clones
  it the configured way.
- **Only `clone` is decorated to start with.** Every other subcommand, and every other argument,
  passes straight through to `git` unchanged.

Ruled 2026-09-03 (owner):

- **Users can shadow their git install with `fngit`** — e.g. a shell alias `git` → `fngit`. So the
  passthrough must be exact, and `fngit` must find the real `git` even when it is itself the thing
  named `git` on `PATH` (never recurse into itself).
- **`fngit clone somerepo ./some/path` runs git with the same args** — a second positional means
  the user chose git's destination; nothing is decorated.
- **`fngit clone somerepo` applies the configured path/repo naming rules** (the clone template).
- **Cross-platform**: Linux, macOS, and Windows — paths, settings locations, process handling, and
  CI all have to work on each.

## Code conventions

- TypeScript throughout the library.
- Make good use of `@rhombus-toolkit/*`. Specifically: `Func` and `Ctor` from
  `@rhombus-toolkit/types`; `assertNever` from `@rhombus-toolkit/type-guards`; the `is*` guards
  in `type-guards` only when passed directly in place of a lambda, e.g. `.filter(isDefined)`.
  (Also recorded in the owner's user-level TypeScript codestyle prefs.)
- Everything else per the owner's user prefs and this repo's `CLAUDE.md` (branch policy, TDD,
  conventional commits, semantic-release flow).

## Publishing

- **npm package name: `@rhombus.rocks/fngit`.** Claimed 2026-09-03 with a `0.0.0-alpha.0`
  placeholder. The bare name `fngit` was refused by npm as too similar to the existing package
  `degit`.
- **The publish workflow is `.github/workflows/release.yml`.** The npm trusted publisher (OIDC) is
  registered against that filename with environment `production`. `ci.yml` keeps only the
  `verify` job; the `publish-next` and `promote` jobs move to `release.yml`.
- `AUTOMERGE_PAT` is set on the repo (GitHub-side, so the auto-merge push triggers `release.yml`).

## Open questions

- **Should fncode itself then consume this library?** Out of scope until the owner says so.
