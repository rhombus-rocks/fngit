import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

export type GhApiResult = { ok: true; body: string; } | { ok: false; status: number; error: string; };

export type GhCloneResult = { ok: true; } | { ok: false; error: string; stderr: string; };

/** The `gh` CLI, as this library uses it. */
export interface IGitHubCli {
  /** Call a REST path, resolving to its body on success and its exit status on failure. */
  api(path: string): Promise<GhApiResult>;
  /** Clone `url` into `destination`, forwarding any extra arguments to `git clone`. */
  clone(url: string, destination: string, extraGitArgs?: readonly string[]): Promise<GhCloneResult>;
}

/**
 * GitHub's "this repo doesn't exist" stderr signatures, matched both to
 * classify a clone failure and to withhold the same lines from the live echo.
 */
export const NOT_FOUND_SIGNATURES = [
  // The GraphQL path `gh repo clone` takes:
  //   "GraphQL: Could not resolve to a Repository with the name 'x/y'."
  /could not resolve to a repository/i,
  // The git/HTTPS path: "remote: Repository not found"
  /repository not found/i,
];

/** Whether a stderr line is one of gh's not-found complaints, rather than something the user needs. */
export function isNotFoundNoiseLine(line: string): boolean {
  return NOT_FOUND_SIGNATURES.some((signature) => signature.test(line));
}

/**
 * Reassemble a stream of arbitrary chunks into lines: each complete line is
 * yielded with its trailing newline, and any final unterminated remainder is
 * yielded last. A line split across a chunk boundary is stitched back together.
 */
export function* splitLines(chunks: Iterable<string>): Generator<string> {
  let pending = '';
  for (const chunk of chunks) {
    pending += chunk;
    let newlineIdx = pending.indexOf('\n');
    while (newlineIdx >= 0) {
      // Strip a trailing \r so \r\n lines are yielded as \n-terminated.
      const lineEnd = newlineIdx > 0 && pending[newlineIdx - 1] === '\r' ? newlineIdx - 1 : newlineIdx;
      yield pending.slice(0, lineEnd) + '\n';
      pending = pending.slice(newlineIdx + 1);
      newlineIdx = pending.indexOf('\n');
    }
  }
  if (pending) {
    yield pending;
  }
}

// Paths whose response is only useful flattened to one login per line; every
// other path is an existence probe read through its exit status alone.
const API_JQ_FILTERS: Readonly<Record<string, string>> = { user: '.login', '/user/orgs': '.[].login' };

/** The `gh` arguments that fetch `path`. */
export function buildApiArgv(path: string): string[] {
  const filter = API_JQ_FILTERS[path];
  return filter === undefined ? ['api', path] : ['api', path, '--jq', filter];
}

/** The `gh` arguments that clone `url` into `destination`. */
export function buildCloneArgv(url: string, destination: string, extraGitArgs: readonly string[] = []): string[] {
  if (!extraGitArgs.length) {
    return ['repo', 'clone', url, destination];
  }
  return ['repo', 'clone', url, destination, '--', ...extraGitArgs];
}

const execFileAsync = promisify(execFile);

/** Runs the real `gh` executable. */
export class GitHubCli implements IGitHubCli {
  async api(path: string): Promise<GhApiResult> {
    try {
      const { stdout } = await execFileAsync('gh', buildApiArgv(path));
      return { ok: true, body: stdout };
    } catch (error) {
      const failure = error as { code?: unknown; stderr?: unknown; message?: unknown; };
      const status = typeof failure.code === 'number' ? failure.code : -1;
      const text = typeof failure.stderr === 'string' && failure.stderr !== ''
        ? failure.stderr
        : String(failure.message ?? error);
      return { ok: false, status, error: text.trim() };
    }
  }

  /**
   * gh's stdout goes straight to the terminal and its stderr is echoed line by
   * line, minus the not-found complaints that would otherwise lead a benign
   * "no such repo" answer with a GraphQL error. Every line is captured
   * regardless, so the caller can still classify the failure.
   */
  clone(url: string, destination: string, extraGitArgs?: readonly string[]): Promise<GhCloneResult> {
    return new Promise((resolve) => {
      const child = spawn('gh', buildCloneArgv(url, destination, extraGitArgs), {
        stdio: ['ignore', 'inherit', 'pipe'],
      });

      let captured = '';
      let pending = '';
      const echoLine = (line: string): void => {
        if (!isNotFoundNoiseLine(line)) {
          process.stderr.write(line);
        }
      };

      // stderr is pinned to 'pipe' above, so it is never null.
      const stderr = child.stderr!;
      stderr.setEncoding('utf8');
      stderr.on('data', (chunk: string) => {
        captured += chunk;
        const lines = [...splitLines([pending, chunk])];
        // The last piece is a partial line unless it ends in a newline; hold it.
        pending = lines.length && !lines[lines.length - 1]!.endsWith('\n') ? lines.pop()! : '';
        for (const line of lines) {
          echoLine(line);
        }
      });

      let settled = false;
      const settle = (result: GhCloneResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
      };

      // A spawn failure (gh not on PATH, say) never starts the process, so no
      // 'close' follows and there is no stderr to drain — settle here. A process
      // that did start settles from 'close', which fires after stderr is drained.
      child.on('error', (error) => {
        settle({ ok: false, error: `failed to spawn gh: ${error.message}`, stderr: captured });
      });

      child.on('close', (code, signal) => {
        if (pending) {
          echoLine(pending);
          pending = '';
        }
        if (signal !== null) {
          settle({ ok: false, error: `gh killed by ${signal}`, stderr: captured });
          return;
        }
        if (code !== 0) {
          settle({ ok: false, error: `gh exited ${code}`, stderr: captured });
          return;
        }
        settle({ ok: true });
      });
    });
  }
}
