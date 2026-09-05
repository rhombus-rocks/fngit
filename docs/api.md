# fngit — API reference

Every symbol below is exported from `@rhombus.rocks/fngit`'s package root
(`src/index.ts`). See `README.md` for narrative documentation and examples;
this is the terse signature reference.

## Locating repos

```ts
function locate(input: string,
  options: LocateOptions & { clone: true; }): Promise<LocalRepo>;
function locate(input: string, options?: LocateOptions): Promise<Located>;
```

- `Located = LocalRepo | RemoteRepo`
  - `LocalRepo = { type: 'local'; path: string; ref: RepoRef }`
  - `RemoteRepo = { type: 'remote'; url: string; destination: string; ref: RepoRef }`
- `LocateOptions = { clone?, settings?: Partial<LocateSettings>, home?, gh?: IGitHubCli, cloneArgs? }`
- Rejects with `LocateError` (`.failure: LocateFailure`, a discriminated union on `reason` — see README's
  [`LocateError`](../README.md#locateerror) table).
- `parseRepoRef(input): ParseRepoRefResult` — the reference grammar, standalone; `RepoRef` is its parsed shape.
- `GitHubCli` (`IGitHubCli`) — the real `gh` spawner; inject a fake via `LocateOptions.gh` in tests.

## Config

```ts
function loadLocateSettings(
  args: { home: string; env?; configPath?; legacyPath?; },
): LocateSettings;
function resolveConfigPath(
  args: { home: string; env; configPath?; },
): ResolvedConfigPath;
function defaultConfigDir(home: string, env): string;
```

- `LocateSettings = { cloneTemplate, worktreeTemplate, additionalSrcDirs: readonly string[], hostAliases: Readonly<Record<string,string>> }`
- `ResolvedConfigPath = { path: string; exists: boolean; overridden: boolean }` — `overridden` is true when
  `configPath`/`FNGIT_CONFIG` named the file explicitly, rather than the `config.{json,jsonc,toml,yaml}` scan.
- `BUILTIN_HOST_ALIASES: Readonly<Record<string,string>>` — the `{host-short}` defaults, before `repos.hostAliases`
  overrides are merged in.
- `CONFIG_DIR_NAME` (`'rhombus.rocks'`), `CONFIG_EXTENSIONS` (`['json','jsonc','toml','yaml']` as const).
- Falls back to the legacy `~/.fngitrc` (flat JSON, no `repos` nesting) only when the new file is absent.

## Writing config

```ts
function writeRepoSettings(
  args: { home: string; env?; configPath?; patch: ReposPatch; },
): WriteRepoSettingsResult;
```

- `ReposPatch = Partial<{ cloneTemplate, worktreeTemplate, additionalSrcDirs: readonly string[], hostAliases: Readonly<Record<string,string>> }>`
  — a field left out of the patch is left untouched in the existing document.
- `WriteRepoSettingsResult = { path: string; created: boolean }`.
- Merges into whatever file `resolveConfigPath` resolves to, in its existing format; a brand-new file is always
  JSON, with `SCHEMA_URL` (`"https://json.schemastore.org/rhombus-rocks-config.json"`) as `$schema`, first key.
- Preserves every key it doesn't own: other top-level keys, and `repos.branchTemplate` (read only by the
  `worktree-paths` plugin).

## Templates

```ts
function cloneTemplateVars(repo, owner, host, hostAliases): TemplateVars;
function worktreeTemplateVars(repo, owner, host, hostAliases): TemplateVars;
```

- `cloneTemplateVars` binds `{repo} {owner} {host} {host-plain} {host-short}`.
- `worktreeTemplateVars` extends that with `{input} {branch} {clone-path} {repo-dir} {cwd}` — placeholders fngit
  cannot itself resolve, so each is bound to `''` rather than raising "unknown placeholder"; `{host-short}` still
  raises on a genuine alias miss.
- Apply either with the library's `applyTemplate(template, vars)` (not exported at the package root — internal to
  the modules above that already call it).

## Schema

- `RHOMBUS_ROCKS_CONFIG_SHAPE` — the type-level mirror (as a plain object, `as const`) of
  `schemas/rhombus-rocks-config.json`, the hand-written JSON Schema shipped in the package (`files: ["schemas"]`).
  `RhombusRocksConfig` / `ReposConfigShape` are its `json-schema-to-ts`-derived types — the raw parsed file shape,
  before `loadLocateSettings`'s per-field degrade and host-alias merge.

## `fngit install` — the plan builder

See README's [`fngit install`](../README.md#fngit-install) section for the CLI; this is the library surface `fnc`
(or any other caller) drives directly.

```ts
function parseInstallArgs(argv: readonly string[]): ParseInstallArgsResult;
function needsPrompting(options: InstallOptions): boolean;
function resolveInstallAnswers(options: InstallOptions, env: InstallEnv,
  prompter: IPrompter): Promise<InstallAnswers>;
function buildInstallPlan(answers: InstallAnswers,
  env: InstallEnv): readonly InstallAction[];
function buildRemoveShadowPlan(
  env: Pick<InstallEnv, 'shimDir' | 'shadowTargets'>,
): readonly InstallAction[];
function describePlan(actions: readonly InstallAction[]): string;
function currentHostAliasOverrides(
  settings: LocateSettings,
): Record<string, string>;
```

- `InstallOptions` — parsed CLI flags; every field but `yes`/`dryRun`/`removeShadow`/`help` is optional (`undefined`
  means "ask" per `needsPrompting`).
- `InstallEnv = { currentSettings: LocateSettings; configPath: string; configFileExists: boolean; shimDir: string; shadowTargets: readonly ShadowTarget[]; claudeOnPath: boolean; pluginState: PluginState }`
  — everything about the machine's current state the plan needs; gathering it (probing `PATH`, shell rc files,
  `claude plugin list`) is the CLI's job, not the library's.
- `InstallAnswers = { cloneTemplate, worktreeTemplate, additionalSrcDirs: readonly string[], hostAliases: Readonly<Record<string,string>>, shadowGit: boolean, plugin: boolean }`
  — `hostAliases` here is overrides-only (see `currentHostAliasOverrides`), never the built-in-merged map.
- `InstallAction` — a discriminated union on `kind`: `write-settings` (carries a `ReposPatch`), `write-shim-script`,
  `write-shadow-block`, `remove-shadow`, `sync-plugin`. Every variant carries a human-readable `description`, used
  by `describePlan`/`--dry-run`.
- `IPrompter = { ask(question, defaultValue): Promise<string>; confirm(question, defaultValue): Promise<boolean>; print(message): void }`
  — the CLI's `ReadlinePrompter` implements it over stdin/stderr; a `DefaultPrompter` (or a scripted test double)
  answers every question with its default, for `-y` and non-interactive runs.
- `RECOMMENDED_CLONE_TEMPLATE`, `RECOMMENDED_WORKTREE_TEMPLATE`, `RECOMMENDED_SRC_DIRS` — the Enter-defaults shown
  on a bare machine. `INSTALL_HELP` — the `--help` text.
- The plan is idempotent by construction: `buildInstallPlan` includes a `write-settings` action only when the
  answers differ from `currentSettings` (or the config file doesn't exist yet — first install/migration), and a
  `sync-plugin` action only when `pluginState !== 'new'`.

## Plugin

```ts
function detectPluginState(pluginListOutput: string): PluginState; // 'new' | 'old' | 'none'
function isPluginInstalled(pluginListOutput: string): boolean;
function syncPlugin(cli: IClaudeCli): SyncPluginOutcome; // 'installed' | 'swapped' | 'already-installed'
```

- `PLUGIN_NAME` (`'worktree-paths'`), `PLUGIN_MARKETPLACE_OWNER_REPO` (`'rhombus-rocks/claude-plugins'`),
  `PLUGIN_MARKETPLACE_NAME` (`'rhombus-rocks-claude-plugins'`), `PLUGIN_ID` (the two joined with `@`).
- `OLD_PLUGIN_ID` (`'claude-code-worktree-paths@fnrhombus-plugins'`) — detected and swapped, never left in place.
- `IClaudeCli = { listPlugins(): string; addMarketplace(ownerRepo): boolean; installPlugin(id): boolean; uninstallPlugin(id): boolean }`;
  `ClaudeCli` is the real `claude` subprocess implementation — inject a fake in tests.

## Shim (shadow-git)

```ts
function shimDir(home: string, env): string;
function shimFilename(shell: ShellType): string; // 'git' | 'git.cmd'
function shimScriptContents(shell: ShellType): string;
function pathPrependCommand(shell: ShellType, dir: string): string;
function upsertShellBlock(content: string, shell: ShellType,
  dir: string): string;
function removeShellBlock(content: string): string;
```

- `ShellType = 'bash' | 'zsh' | 'fish' | 'powershell'`.
- `shimDir` — `$XDG_DATA_HOME/rhombus.rocks/fngit/shims` (default `<home>/.local/share/rhombus.rocks/fngit/shims`).
- `upsertShellBlock`/`removeShellBlock` manage an idempotent marked block (`# >>> fngit shim >>>` /
  `# <<< fngit shim <<<`) in a shell startup file's content — pure string transforms; the CLI does the actual
  file I/O.
