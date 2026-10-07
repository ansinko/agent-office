// Bitbucket, through the bkt CLI: the floor's pull requests. Its issues are on Jira.
import { BITBUCKET_COMMANDS } from '../../../shared/hosts.js';
import { originRemote } from '../../building.js';
import { emptyTracker } from '../none.js';
import type { HostAdapter } from '../types.js';
import type { BbRepo } from './bkt.js';
import { BitbucketPulls } from './pulls.js';

export const JIRA_PENDING = "Issues for this project come from Jira, which the office doesn't read yet";

/** The Bitbucket repository of the checkout at `dir`, from `remote` or else its origin. */
function repoOf(dir: string, remote = originRemote(dir)): BbRepo {
  // This adapter is only chosen for a Bitbucket origin.
  if (remote?.kind !== 'bitbucket') throw new Error(`${dir} has no Bitbucket origin`);
  const [ws, slug] = remote.repo.split('/');
  return { dir, ws, slug };
}

export const bitbucket: HostAdapter = {
  kind: 'bitbucket',
  name: 'Bitbucket',
  cli: {
    ...BITBUCKET_COMMANDS,
    merge: (n, method, deleteBranch, repo) => {
      const [ws, slug] = repo.split('/');
      return `bkt pr merge ${n} --strategy ${method}${deleteBranch ? '' : ' --close-source=false'} --workspace ${ws} --repo ${slug}`;
    },
  },
  pulls: (dir, onPulls, remote) => new BitbucketPulls(repoOf(dir, remote), onPulls),
  issues: () => emptyTracker(JIRA_PENDING),
};
