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

/** The real runner: bkt in `dir`, as the office, or with `env` as someone signed in to their own Bitbucket. */
export function bktIn(dir: string): Bkt {
  return (args, opts = {}) =>
    new Promise((resolve, reject) => {
      execFile('bkt', args, { cwd: dir, maxBuffer: 32 * 1024 * 1024, timeout: opts.timeout ?? 30_000, env: opts.env }, (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return reject(new Error('Bitbucket CLI (bkt) is not installed on the server'));
        reject(new Error(friendly((stderr || err.message || '').trim().split('\n').slice(-2).join(' '))));
      });
    });
}

/** A Bitbucket REST path under the repository, for `bkt api`. */
export const api = (r: BbRepo, path: string) => `/repositories/${r.ws}/${r.slug}${path}`;

/** The flags that point a bkt subcommand at the repository. */
export const repoFlags = (r: BbRepo) => ['--workspace', r.ws, '--repo', r.slug];
