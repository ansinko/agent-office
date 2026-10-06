// GitHub, through the gh CLI: the floor's pull requests and its issues.
import { GITHUB_COMMANDS } from '../../../shared/hosts.js';
import type { HostAdapter } from '../types.js';
import { GitHubIssues } from './issues.js';
import { GitHubPulls } from './pulls.js';

export const github: HostAdapter = {
  kind: 'github',
  name: 'GitHub',
  cli: {
    ...GITHUB_COMMANDS,
    merge: (n, method, deleteBranch, repo) => `gh pr merge ${n} --${method}${deleteBranch ? ' --delete-branch' : ''} --repo ${repo}`,
  },
  pulls: (dir, onPulls) => new GitHubPulls(dir, onPulls),
  issues: (dir, onIssues, host) => new GitHubIssues(dir, onIssues, host),
};
