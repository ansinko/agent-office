// The Bitbucket CLI (bkt) as the office runs it, and the repository every call names.
import { execFile } from 'node:child_process';

/** A floor's checkout and the Bitbucket repository its origin points at. */
export interface BbRepo {
  dir: string;
  ws: string;
  slug: string;
}

/** Runs bkt with these args in the floor's checkout; resolves to stdout. */
export type Bkt = (args: string[], opts?: { timeout?: number; env?: Record<string, string> }) => Promise<string>;

/** Turns bkt's stderr into something a person standing at the board can act on. */
export function friendly(raw: string): string {
  if (/401|unauthorized|no hosts configured|auth login/i.test(raw)) return "bkt isn't signed in to Bitbucket on the office's machine; run `bkt auth login --kind cloud` there";
  if (/403|scope/i.test(raw)) return `The office's Bitbucket token lacks a scope this needs: ${raw}`;
  if (/404|not found/i.test(raw)) return "bkt can't find this repository on Bitbucket (check the remote and access)";
  return raw;
}

/** bkt itself, with nothing added: in `dir`, as the office, or with `env` as someone signed in to their own Bitbucket. */
export function bktRaw(dir: string): Bkt {
  return (args, opts = {}) =>
    new Promise((resolve, reject) => {
      execFile('bkt', args, { cwd: dir, maxBuffer: 32 * 1024 * 1024, timeout: opts.timeout ?? 30_000, env: opts.env }, (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return reject(new Error('Bitbucket CLI (bkt) is not installed on the server'));
        reject(new Error(friendly((stderr || err.message || '').trim().split('\n').slice(-2).join(' '))));
      });
    });
}

/** The bkt context the office makes for a workspace, when bkt's login lives in its own config. */
export const contextName = (ws: string) => `office-${ws}`;

/**
 * Makes sure bkt has the office's context for `ws`, and resolves to the flags that pick it. A login
 * given by env (BKT_HOST with BKT_TOKEN) needs none. A login from `bkt auth login` only answers
 * through a context, and a Cloud context names its workspace, so the office keeps one per workspace;
 * bkt makes a new context the active one, so whatever was active before is put back.
 */
export async function contextFor(run: Bkt, ws: string, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  if (env.BKT_HOST) return [];
  const name = contextName(ws);
  const list = JSON.parse((await run(['context', 'list', '--json'])) || '{}');
  if ((list.contexts ?? []).some((c: any) => c.name === name)) return ['-c', name];
  const auth = JSON.parse((await run(['auth', 'status', '--json'])) || '{}');
  const host = (auth.hosts ?? []).find((h: any) => h.kind === 'cloud')?.key;
  if (!host) throw new Error(friendly('no hosts configured'));
  await run(['context', 'create', name, '--host', host, '--workspace', ws]);
  if (list.active_context && list.active_context !== name) await run(['context', 'use', list.active_context]);
  return ['-c', name];
}

const contexts = new Map<string, Promise<string[]>>();

/** The real runner: bkt in `dir` with the office's context for `ws` (see contextFor), asked once per workspace. */
export function bktIn(dir: string, ws: string): Bkt {
  const raw = bktRaw(dir);
  return async (args, opts = {}) => {
    if (opts.env?.BKT_HOST) return raw(args, opts);
    let flags = contexts.get(ws);
    if (!flags) {
      flags = contextFor(raw, ws);
      contexts.set(ws, flags);
      flags.catch(() => contexts.delete(ws));
    }
    return raw([...(await flags), ...args], opts);
  };
}

/** A Bitbucket REST path under the repository, for `bkt api`. */
export const api = (r: BbRepo, path: string) => `/repositories/${r.ws}/${r.slug}${path}`;

/** The flags that point a bkt subcommand at the repository. */
export const repoFlags = (r: BbRepo) => ['--workspace', r.ws, '--repo', r.slug];
