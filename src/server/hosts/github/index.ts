// GitHub, through the gh CLI: the floor's pull requests and its issues.
import type { HostAdapter } from '../types.js';
import { GitHubIssues } from './issues.js';
import { GitHubPulls } from './pulls.js';

export const github: HostAdapter = {
  kind: 'github',
  name: 'GitHub',
  cli: {
    viewPull: 'gh pr view {{number}}',
    diffPull: 'gh pr diff {{number}}',
    checkout: 'gh pr checkout {{number}}',
    checks: 'gh pr checks {{number}} --watch',
    lineComments: 'gh api repos/{{repo}}/pulls/{{number}}/comments',
    createPr: 'gh pr create',
    viewIssue: 'gh issue view {{number}} --comments',
    listIssues: 'gh issue list',
    merge: (n, method, deleteBranch, repo) => `gh pr merge ${n} --${method}${deleteBranch ? ' --delete-branch' : ''} --repo ${repo}`,
  },
  pulls: (dir, onPulls) => new GitHubPulls(dir, onPulls),
  issues: (dir, onIssues, host) => new GitHubIssues(dir, onIssues, host),
};
