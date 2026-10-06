import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { isDocPath, type DocFile, type DocSource } from '../shared/docs.js';

// The bookshelf on a branch: the project's Markdown as git has it on origin's default branch, read
// straight out of git (ls-tree, cat-file), so the docs that merged can be read whatever the checkout
// is on. The branch is fetched now and then, and its listing kept until the branch moves.

const execFileP = promisify(execFile);

/** A fetch this recent is fresh enough for the shelf. */
const FETCH_FRESH_MS = 60_000;
/** How long opening the shelf waits on a fetch before it lists what git already has. */
const FETCH_WAIT_MS = 4_000;
const FETCH_TIMEOUT_MS = 30_000;
const GIT_TIMEOUT_MS = 20_000;
/** The sources this fresh are handed out again rather than asking git. */
const SOURCES_FRESH_MS = 3_000;

/** A blob in the branch: its object and its size. */
interface Blob {
  oid: string;
  size: number;
}

export class BranchShelf {
  private fetchedAt = 0;
  private fetching?: Promise<void>;
  private known?: { at: number; sources: Promise<DocSource[]> };
  /** The last listing, kept while the branch is on the same commit. */
  private listed?: { commit: string; files: DocFile[]; more: boolean; blobs: Map<string, Blob> };
  /** Titles by blob: a blob never changes, so neither does its title. */
  private titles = new Map<string, string | undefined>();

  constructor(
    private dir: string,
    private titleOf: (head: string) => string | undefined,
    private headBytes: number,
  ) {}

  private git(args: string[], timeout = GIT_TIMEOUT_MS): Promise<string> {
    return execFileP('git', args, { cwd: this.dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout, env: gitEnv() }).then((r) => r.stdout);
  }

  /** The checkout, and origin's default branch when git has one. */
  sources(): Promise<DocSource[]> {
    if (this.known && Date.now() - this.known.at < SOURCES_FRESH_MS) return this.known.sources;
    const sources = (async () => {
      const branch = (await this.git(['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim();
      const out: DocSource[] = [{ ref: '', label: branch && branch !== 'HEAD' ? `This checkout · ${branch}` : 'This checkout' }];
      const remote = await this.defaultRemote();
      if (remote) out.push({ ref: remote, label: `${remote.slice('origin/'.length)} on origin` });
      return out;
    })();
    this.known = { at: Date.now(), sources };
    return sources;
  }

  /** Whether the shelf may read from `ref`: only the branches it offers, never one a request names. */
  async offers(ref: string): Promise<boolean> {
    return (await this.sources()).some((s) => s.ref === ref);
  }

  private async defaultRemote(): Promise<string | undefined> {
    const head = (await this.git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).catch(() => '')).trim();
    if (head.startsWith('origin/')) return head;
    for (const b of ['origin/main', 'origin/master']) {
      if (await this.git(['rev-parse', '--verify', '--quiet', `refs/remotes/${b}^{commit}`]).then(() => true, () => false)) return b;
    }
    return undefined;
  }

  /** Fetches the branch when it hasn't been lately, waiting a moment for it but never long. */
  private async fresh(ref: string): Promise<void> {
    if (!this.fetching && Date.now() - this.fetchedAt >= FETCH_FRESH_MS) {
      this.fetching = execFileP('git', ['fetch', '--quiet', '--no-tags', 'origin', ref.slice('origin/'.length)], { cwd: this.dir, env: gitEnv(), timeout: FETCH_TIMEOUT_MS })
        .then(
          () => undefined,
          // Offline, or no access: the shelf reads what git already has.
          () => undefined,
        )
        .then(() => {
          this.fetchedAt = Date.now();
          this.fetching = undefined;
        });
    }
    if (this.fetching) await Promise.race([this.fetching, new Promise((r) => setTimeout(r, FETCH_WAIT_MS))]);
  }

  /** Every Markdown file on the branch, by path, the way the checkout's shelf lists them. */
  async list(ref: string, max: number): Promise<{ files: DocFile[]; more: boolean }> {
    await this.fresh(ref);
    return this.listing(ref, max);
  }

  private async listing(ref: string, max: number) {
    const commit = (await this.git(['rev-parse', '--verify', `${ref}^{commit}`])).trim();
    if (this.listed?.commit === commit) return this.listed;
    const blobs = new Map<string, Blob>();
    for (const rec of (await this.git(['-c', 'core.quotePath=false', 'ls-tree', '-r', '-z', '-l', commit])).split('\0')) {
      // "<mode> blob <oid> <size>\t<path>", with the path relative to the project folder.
      const m = /^\d+ blob ([0-9a-f]+) +(\d+)\t(.+)$/s.exec(rec);
      if (m && isDocPath(m[3])) blobs.set(m[3], { oid: m[1], size: Number(m[2]) });
    }
    const paths = [...blobs.keys()].sort((a, b) => a.localeCompare(b));
    const kept = paths.slice(0, max);
    await this.learnTitles(kept.map((p) => blobs.get(p)!.oid).filter((oid) => !this.titles.has(oid)));
    const times = await this.lastCommitted(commit);
    const committed = Number((await this.git(['log', '-1', '--format=%ct', commit])).trim()) * 1000;
    const files = kept.map((p) => {
      const b = blobs.get(p)!;
      return { path: p, title: this.titles.get(b.oid), size: b.size, mtime: times.get(p) ?? committed };
    });
    this.listed = { commit, files, more: paths.length > max, blobs };
    return this.listed;
  }

  /** Reads the start of each blob for its title, all in one cat-file. */
  private async learnTitles(oids: string[]): Promise<void> {
    if (!oids.length) return;
    const out = await this.catBatch(oids);
    for (const [oid, body] of out) this.titles.set(oid, this.titleOf(body.subarray(0, this.headBytes).toString('utf8')));
  }

  /** When each doc last changed on the branch. Empty if git takes too long: the branch's time stands in. */
  private async lastCommitted(commit: string): Promise<Map<string, number>> {
    const times = new Map<string, number>();
    const log = await this.git(['-c', 'core.quotePath=false', 'log', '--relative', '--format=%x01%ct', '--name-only', commit, '--', ':(icase)*.md', ':(icase)*.markdown']).catch(() => '');
    let at = 0;
    for (const line of log.split('\n')) {
      if (line.startsWith('\x01')) at = Number(line.slice(1)) * 1000;
      else if (line && !times.has(line)) times.set(line, at);
    }
    return times;
  }

  /** A doc's text on the branch, or undefined when it isn't a doc there. */
  async doc(ref: string, file: string, maxBytes: number): Promise<{ text: string } | { tooBig: true } | undefined> {
    const listed = await this.listing(ref, Number.MAX_SAFE_INTEGER).catch(() => undefined);
    const b = listed?.blobs.get(file);
    if (!b) return undefined;
    if (b.size > maxBytes) return { tooBig: true };
    return { text: (await this.blob(b.oid)).toString('utf8') };
  }

  /** Any file on the branch (a picture, .bookshelf.json), or undefined when there's no such file. */
  async file(ref: string, file: string, maxBytes: number): Promise<Buffer | { tooBig: true } | undefined> {
    const commit = (await this.git(['rev-parse', '--verify', `${ref}^{commit}`]).catch(() => '')).trim();
    if (!commit) return undefined;
    const check = await this.batch(['--batch-check'], `${commit}:./${file}\n`).catch(() => undefined);
    const m = check && /^([0-9a-f]+) blob (\d+)$/m.exec(check.toString('utf8'));
    if (!m) return undefined;
    if (Number(m[2]) > maxBytes) return { tooBig: true };
    return this.blob(m[1]);
  }

  private async blob(oid: string): Promise<Buffer> {
    return (await this.catBatch([oid])).get(oid) ?? Buffer.alloc(0);
  }

  /** The blobs' contents, by object, from one `git cat-file --batch`. */
  private async catBatch(oids: string[]): Promise<Map<string, Buffer>> {
    const out = await this.batch(['--batch'], `${oids.join('\n')}\n`);
    const found = new Map<string, Buffer>();
    let at = 0;
    while (at < out.length) {
      const nl = out.indexOf(10, at);
      if (nl < 0) break;
      const m = /^([0-9a-f]+) \S+ (\d+)$/.exec(out.subarray(at, nl).toString('utf8'));
      // "<oid> missing" has no body to step over.
      if (!m) {
        at = nl + 1;
        continue;
      }
      const size = Number(m[2]);
      found.set(m[1], out.subarray(nl + 1, nl + 1 + size));
      at = nl + 1 + size + 1;
    }
    return found;
  }

  private batch(mode: string[], input: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', ['cat-file', ...mode], { cwd: this.dir, env: gitEnv() });
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => child.kill(), GIT_TIMEOUT_MS);
      child.stdout.on('data', (c: Buffer) => chunks.push(c));
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(Buffer.concat(chunks));
        else reject(new Error(`git cat-file exited with ${code}`));
      });
      child.stdin.end(input);
    });
  }
}

/** Never stop to ask for a password: there's nobody at the office's terminal to type it. */
function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
}
