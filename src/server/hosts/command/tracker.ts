// A floor's issues from a command of its own: the floor's .agent-office/tracker.json names a program
// that prints the issues as JSON, and the board shows what it prints. It only lists: nothing is
// commented on, closed or labelled from the office, and a worker taking one is the office's note.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { issueKey, type BoardState, type Choice, type Comment, type Issue, type IssueDetail, type Label, type BoardRef } from '../../../shared/protocol.js';
import type { Tracker } from '../types.js';

/** The floor's tracker.json. */
export interface CommandConfig {
  /** What the board's tracker is called: "Roadmap waves". */
  name: string;
  /** The program and its arguments, run in the floor's checkout without a shell. */
  command: string[];
  /** How long it may take, in ms. */
  timeout: number;
}

const CONFIG = 'tracker.json';
const DEFAULT_TIMEOUT = 120_000;
const MAX_ISSUES = 500;
/** A worker's claim shows on the board for this long, unless the list has the issue taken by then. */
const CLAIM_MS = 6 * 60 * 60 * 1000;
const GREY = '#8b949e';

/**
 * The floor's command tracker, from `<dataDir>/tracker.json`: undefined when there's no such file.
 * A file that is there but wrong is an error, so the board says what's wrong with it.
 */
export function commandConfig(dataDir: string): CommandConfig | undefined {
  let raw: string;
  try {
    raw = readFileSync(path.join(dataDir, CONFIG), 'utf8');
  } catch {
    return undefined;
  }
  const c = JSON.parse(raw);
  const command = c?.command;
  if (!Array.isArray(command) || !command.length || !command.every((a) => typeof a === 'string' && a.length > 0)) throw new Error(`${CONFIG}: "command" must be a list of strings, the program first`);
  const name = typeof c.name === 'string' && c.name.trim() ? c.name.trim().slice(0, 60) : path.basename(command[command.length - 1]);
  const timeout = Number.isFinite(c.timeout) && c.timeout > 0 ? Math.min(c.timeout, 600_000) : DEFAULT_TIMEOUT;
  return { name, command, timeout };
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const COLOR = /^#[0-9a-fA-F]{6}$/;

function label(v: unknown): Label | undefined {
  if (typeof v === 'string' && v.trim()) return { name: v.trim().slice(0, 100), color: GREY };
  if (!v || typeof v !== 'object') return undefined;
  const l = v as Record<string, unknown>;
  const name = str(l.name, 100).trim();
  if (!name) return undefined;
  const color = typeof l.color === 'string' && COLOR.test(l.color) ? l.color : GREY;
  return l.description ? { name, color, description: str(l.description, 300) } : { name, color };
}

/** One issue as the command printed it; undefined for one without a usable key or title. */
export function issueOf(v: unknown): Issue | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const i = v as Record<string, unknown>;
  const key = issueKey(i.key);
  const title = str(i.title, 300).trim();
  if (!key || !title) return undefined;
  const now = new Date(0).toISOString();
  const url = str(i.url, 2000);
  return {
    key,
    ref: str(i.ref, 40).trim() || key,
    title,
    state: i.state === 'closed' ? 'closed' : 'open',
    url: /^https?:\/\//.test(url) ? url : '',
    author: str(i.author, 100),
    labels: (Array.isArray(i.labels) ? i.labels : []).map(label).filter((l): l is Label => !!l),
    assignees: (Array.isArray(i.assignees) ? i.assignees : []).filter((a): a is string => typeof a === 'string' && !!a).map((a) => a.slice(0, 100)),
    createdAt: str(i.createdAt, 40) || now,
    updatedAt: str(i.updatedAt, 40) || str(i.createdAt, 40) || now,
    body: str(i.body, 4000),
    comments: 0,
    ...(typeof i.prompt === 'string' && i.prompt.trim() ? { prompt: i.prompt.slice(0, 20_000) } : {}),
  };
}

/** What the command printed: a list of issues, or { issues: [...] }. */
export function issuesOf(stdout: string): Issue[] {
  const parsed = JSON.parse(stdout);
  const list = Array.isArray(parsed) ? parsed : parsed?.issues;
  if (!Array.isArray(list)) throw new Error('The tracker command printed no list of issues');
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const v of list) {
    const it = issueOf(v);
    if (!it || seen.has(it.key)) continue;
    seen.add(it.key);
    out.push(it);
    if (out.length >= MAX_ISSUES) break;
  }
  return out;
}

export class CommandTracker implements Tracker {
  issues: BoardState<Issue> = { items: [], fetchedAt: 0, loading: false };
  /** Issues workers took, by key: when. Kept until the list has them taken or closed. */
  private claimed = new Map<string, number>();
  private listing?: Promise<void>;
  private readonly readOnly: string;
  /** How its errors name it. */
  private readonly who: string;

  constructor(
    private dir: string,
    private config: CommandConfig,
    private onIssues: (s: BoardState<Issue>) => void,
  ) {
    this.readOnly = `${config.name} only lists its issues; change them where they come from`;
    this.who = `${config.name} (${CONFIG})`;
  }

  stop() {}

  async reasons(): Promise<Choice[]> {
    return [];
  }

  async issueDetail(key: string): Promise<IssueDetail> {
    const it = this.issues.items.find((i) => i.key === key);
    if (!it) throw new Error(`${this.who} has no issue ${key}`);
    return { key, state: it.state, body: it.body, comments: [], viewer: '', reasons: [], caps: { labels: false }, readOnly: true };
  }

  async comment(_ref: BoardRef & { kind: 'issue' }): Promise<{ comment?: Comment; error?: string }> {
    return { error: this.readOnly };
  }

  async close(): Promise<string | undefined> {
    return this.readOnly;
  }

  async repoLabels(): Promise<Label[]> {
    const byName = new Map<string, Label>();
    for (const i of this.issues.items) for (const l of i.labels) byName.set(l.name, l);
    return [...byName.values()];
  }

  async setLabels(): Promise<{ labels?: Label[]; error?: string }> {
    return { error: this.readOnly };
  }

  /** Nothing to assign it to: the board marks it taken until the command lists it as taken itself. */
  async claim(key: string): Promise<string | undefined> {
    this.claimed.set(key, Date.now());
    this.show();
    return undefined;
  }

  refresh(): Promise<void> {
    this.listing ??= this.list().finally(() => (this.listing = undefined));
    return this.listing;
  }

  private show() {
    this.issues = { ...this.issues, items: this.mark(this.issues.items) };
    this.onIssues(this.issues);
  }

  /** `items` with the claims that still stand marked taken. */
  private mark(items: Issue[], now = Date.now()): Issue[] {
    for (const [key, at] of this.claimed) {
      const it = items.find((i) => i.key === key);
      if (now - at > CLAIM_MS || (it && (it.state === 'closed' || it.assignees.length))) this.claimed.delete(key);
    }
    return items.map(({ taken, ...it }) => (this.claimed.has(it.key) ? { ...it, taken: true } : it));
  }

  private run(): Promise<string> {
    const [file, ...args] = this.config.command;
    return new Promise((resolve, reject) => {
      execFile(file, args, { cwd: this.dir, maxBuffer: 16 * 1024 * 1024, timeout: this.config.timeout }, (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        const why = (stderr || err.message || '').trim().split('\n').slice(-2).join(' ');
        reject(new Error((err as NodeJS.ErrnoException).code === 'ENOENT' ? `${this.who}: ${file} was not found` : `${this.who} failed: ${why}`));
      });
    });
  }

  private async list() {
    this.issues = { ...this.issues, loading: true };
    this.onIssues(this.issues);
    try {
      const items = this.mark(issuesOf(await this.run()));
      this.issues = { items, fetchedAt: Date.now(), loading: false };
    } catch (err) {
      this.issues = { ...this.issues, loading: false, error: (err as Error).message, fetchedAt: Date.now() };
    }
    this.onIssues(this.issues);
  }
}
