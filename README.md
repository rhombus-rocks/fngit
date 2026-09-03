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
