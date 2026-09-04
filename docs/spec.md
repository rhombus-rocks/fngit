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

## Backlog — captured, not yet designed

Owner's words, 2026-09-03. Saved verbatim on request; no design work has been done on it.

> - `fngit install` (presuming `install` isn't a valid git command, give me suggestions if you
>   recommend something different) sets up the config files.
>   - run like i just showed it starts and interactive cli wizard that asks:
>     - repo location / naming template (i can't remember if these are a single or two settings
>       these days). show the way this system is set up as recommended. explain that for fnc to be
>       at its best, it needs to be able to see the org, repo, and branch all at once without
>       digging into and opening up repo files. be sure to show what templating options are
>       available
>     - install
>   - values can be provided in args and then it won't be interactive
>   - lib function(s) to set these settings (no interactivity, obviously)

> The only thing missing from the last prompt, under the wizard questions, is
> 'install claude-code-worktree-paths@fnrhombus-plugins? (recommended)' and 'replace calls to
> system git?'.
>
> tbc, all other argument configurations should pass through to git

### Install wizard — defaults ruling (2026-09-04)

Owner: "for each step in the wizard, showing current is fine, but there needs to be an answer
offered for *default*. the install command should accept `-y` to accept all defaults. there should
be a way to reset to default." Matching `npm init` was proposed and accepted as the model:

- Every prompt shows the current value (when set) and names the recommended value; Enter keeps the
  current value, typing `default` picks the recommended one.
- `-y` / `--yes` answers every prompt with its Enter-default — like `npm init -y`, a re-run on a
  configured machine changes nothing.
- `--reset` makes the recommended value the Enter-default for every prompt, so `-y --reset`
  restores the recommended setup non-interactively.
- The settings file is merged, never overwritten.

### Interception rule (2026-09-04)

Owner: "all install shapes and one single shape clone are intercepted, everything else passes
through." So `fngit install …` with ANY arguments is fngit's own command — unknown options are a
usage error from fngit, never handed to git — while `clone` is intercepted only in the
single-positional shape (`fngit clone <ref> [git flags…]`), and every other invocation is git's.

### Config location and shadow mechanism (2026-09-04)

Owner, on the wizard design list: prerequisites check, template validation with preview, re-run /
`--yes` / `--dry-run`, and the non-TTY rule are accepted. **fngit's settings must NOT live in
Claude Code's `settings.json`** — the owner will change the worktree-paths hook plugin to read
fngit's file instead. Open: an XDG location versus a dotfile directly under `~/` (owner leans
dotfile; thoughts requested). Open: shadowing git via a `git` shim on a user PATH entry instead of
shell aliases (owner: "maybe the user path overrides the system path var?"; research requested).

### Config file and shim — ruled (2026-09-04)

- **Settings live in `~/.fngitrc`, JSON**: `cloneTemplate`, `worktreeTemplate`, `additionalSrcDirs`,
  `hostAliases` (the host-alias files are gone — aliases are a key in the same file). One
  location on every platform (`os.homedir()`); `FNGIT_CONFIG=<path>` overrides it. No project,
  managed, or system tiers; no reading of Claude Code's `settings.json` anywhere.
- **Shadowing git is a shim on PATH, never an alias**: a `git` shim (`exec fngit "$@"`; `git.cmd`
  → `@fngit %*` on Windows) in `~/.local/share/fngit/shims` (`%LOCALAPPDATA%\fngit\shims` on
  Windows), and an idempotent marked block that PREPENDS that directory to PATH in `~/.bashrc`,
  `~/.zshrc`, fish `conf.d`, and the PowerShell profile. `--remove-shadow` removes the blocks and
  the shim. The real-git resolver must skip the shim directory.
- **Windows PATH order**: system entries precede user entries, so a user-PATH insertion does not
  override a system-installed git; the profile prepend does (per shell), and the wizard notes the
  system-PATH option for all-process coverage. cmd.exe gets a note only.
