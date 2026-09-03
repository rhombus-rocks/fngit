# @rhombus.rocks/fngit

A library for locating git repos from short references, plus `fngit` — a CLI
that decorates `git` with that lookup.

The library resolves a user-typed reference (`<name>`, `<name>@<owner>`,
`<owner>/<name>`, `gh:<owner>/<name>`, a full URL, `+workspace` suffixes and
all) against your existing local clones and, failing that, your GitHub orgs —
returning either the local path or the clone URL, optionally cloning it for
you. `fngit clone <ref>` runs that resolution and clones the repo to its
configured destination; every other `git` subcommand and argument passes
straight through unchanged.

## Install

```sh
npm install @rhombus.rocks/fngit
```

## API

### `locate`

```ts
import { locate } from '@rhombus.rocks/fngit';

const repo = await locate('fnclaude', { clone: true });
repo.path; // the checkout on disk
```

`locate(input, options)` resolves to a `Located`, or rejects with a
[`LocateError`](#locateerror).

```ts
type Located = { type: 'local'; path: string; ref: RepoRef; } | {
  type: 'remote';
  url: string;
  destination: string;
  ref: RepoRef;
};
```

`local` means a checkout already exists at `path`. `remote` means it doesn't:
`url` is where it would be fetched from and `destination` where it would land.
With `clone: true` a `remote` result is cloned first, so the call always
resolves `local`.

`ref` is the parsed reference — `host`, `owner`, `name`, `workspace`,
`original`. Its `workspace` is carried through untouched and never affects the
destination; a `+workspace` suffix names a worktree beside the clone, not a
different clone.

### Options

| Field       | Default               | Meaning                                                                    |
| ----------- | --------------------- | -------------------------------------------------------------------------- |
| `clone`     | `false`               | Clone a `remote` result before returning, so the result is always `local`. |
| `settings`  | none                  | Per-field overlay on whatever the settings chain supplies.                 |
| `cwd`       | `process.cwd()`       | Root for the project settings tier.                                        |
| `home`      | `os.homedir()`        | Root for `~` expansion and the user settings tier.                         |
| `gh`        | the real `gh` spawner | An `IGitHubCli` to call instead; inject a fake in tests.                   |
| `cloneArgs` | none                  | Extra arguments for `git clone`, honoured only alongside `clone`.          |

### Resolution order

1. Parse the reference. Accepted forms are `<name>`, `<name>@<owner>`,
   `<owner>/<name>`, `gh:<owner>/<name>`, an `https://`/`http://`/`ssh://` URL
   and the `git@host:owner/name` form, each with an optional `+workspace`
   suffix.
2. Load the settings chain, then apply the `settings` overlay field by field.
3. For a bare name, before any network call:
   1. scan the clone template's own root with `{owner}` wildcarded, excluding
      worktree siblings — one hit resolves `local`, several are ambiguous;
   2. search `additionalSrcDirs`, each entry twice: `<dir>/<name>`, then the
      clone template's last segment re-rooted there;
   3. ask `gh` who owns it — the authenticated user first, then each
      organization in API order. Every candidate is probed, so a name two
      owners share is ambiguous rather than silently resolved.
4. With the owner known, compute the destination from `cloneTemplate`. If it
   exists, that is the `local` result. Otherwise search `additionalSrcDirs`
   once more for that exact owner. Otherwise the result is `remote`.
5. With `clone: true`, create the destination's parent and clone into it.

The clone template's root outranks `additionalSrcDirs` at every step, so a repo
present in both is never reported ambiguous. Those extra roots are search-only
and never become a clone destination.

### `LocateError`

Every failure rejects with a `LocateError` carrying a structured `failure`, so
a caller can branch on the reason rather than parse the message.

| `failure.reason`  | Raised when                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `unparseable`     | The input matches none of the accepted reference forms.                                                               |
| `config`          | No `cloneTemplate` is configured, or expanding it failed — an unknown placeholder, or a `{host-short}` with no alias. |
| `gh-failed`       | The owner lookup could not reach `gh` at all.                                                                         |
| `not-found`       | No owner reachable through `gh` has a repo by that name.                                                              |
| `ambiguous-owner` | Several owners have it; `owners` lists them.                                                                          |
| `ambiguous-local` | Several checkouts on disk match; `paths` lists them.                                                                  |
| `clone-failed`    | The clone itself failed; `repoNotFound` says whether the repo simply doesn't exist.                                   |

## CLI

```sh
npm install -g @rhombus.rocks/fngit
```

`fngit` decorates `git clone`: only `clone` is intercepted, and only when its
first argument is a bare reference — every other subcommand and argument
passes straight through to `git` unchanged.

```sh
fngit clone fnclaude          # locate() resolves the ref, cloning if needed
fngit clone fnclaude --depth 1  # extra args forward to the underlying clone
```

### Dispatch rule

`fngit clone <arg> …` is decorated only when `<arg>`:

- doesn't start with `-` (so a leading flag, e.g. `fngit clone --depth 1 x`,
  passes through — git owns its own flag parsing);
- isn't a filesystem path (doesn't start with `.` or `/`, e.g.
  `fngit clone ./local-path`);
- parses as one of the [reference forms](#locate) above; and
- has no second positional after it (`fngit clone <ref> <dir>` passes
  through — the user chose git's destination explicitly).

Anything else — `fngit clone` alone, two positionals, an unparseable or
path-like first argument — passes straight through to `git clone`. A
reference carrying a `+workspace` suffix is rejected (exit `2`); worktree
support isn't implemented yet.

### Exit codes

| Code    | Meaning                                                                                                                                      |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`     | The clone resolved (or already existed); its path was printed to stdout.                                                                     |
| `1`     | `locate()` rejected with a [`LocateError`](#locateerror); its message (and, for an ambiguous result, one candidate per line) went to stderr. |
| `2`     | The reference carried a `+workspace` suffix, which `fngit clone` doesn't support yet.                                                        |
| `127`   | `git` itself isn't on `PATH`.                                                                                                                |
| _other_ | A passed-through `git` invocation's own exit status.                                                                                         |

Everything that isn't a decorated `clone` is `git`, verbatim — same flags,
same stdout/stderr, same exit code, same behavior for a signal that kills it.

### Settings

`loadLocateSettings({ home, cwd })` reads the `repoSettings` block of four
tiers, later ones winning field by field:

1. `<home>/.claude/settings.json`
2. `<cwd>/.claude/settings.json`
3. `<cwd>/.claude/settings.local.json`
4. `/etc/claude-code/managed-settings.json`

It reads `cloneTemplate`, `worktreeTemplate` and `additionalSrcDirs` — the last
accepting a single path or a list, and replacing rather than extending a lower
tier. Every failure degrades silently: an unreadable, malformed or
wrong-shaped file contributes nothing rather than failing the lookup.

Host aliases for the `{host-short}` placeholder come from
`/usr/share/fnrhombus/host-aliases.json` and then
`~/.local/share/fnrhombus/host-aliases.json`, the user's keys winning.

## Development

Toolchain is pinned via [mise](https://mise.jdx.dev/) — running any command
inside the repo picks up the pinned Node and bun versions automatically.

```sh
bun install
bun run lint          # typecheck + eslint
bun run test          # bun test
bun run build         # tsc emit to dist/
bun run format        # dprint fmt
bun run format:check  # dprint check
```

A pre-commit hook (`.githooks/pre-commit`, wired up automatically by mise on
directory entry) runs `dprint check` and `bun run lint` before every commit.

## Release

Every PR merge to `main` runs the `Release` workflow's `publish-next` job:
semantic-release reads the conventional-commit history, determines the next
version, and publishes it to npm under the `@next` dist-tag with a GitHub
pre-release.

Promotion to `@latest` is a manual gate — run the `Release` workflow via
"Run workflow" in the Actions UI; the `promote` job is gated by the
`production` environment and requires reviewer approval before it moves the
same artifact from `@next` to `@latest`.

See `CLAUDE.md` for the full branch policy, TDD requirement, and commit
conventions this repo follows.
