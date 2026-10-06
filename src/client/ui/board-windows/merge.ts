import type { Check, Pull, PullDetail } from '../../../shared/protocol';
import type { Net } from '../../net';
import { h, openModal } from '../dom';
import { mergeWaiters } from './api';
import { deleteBranchPref, MERGE_KEY, mergePref, savePref } from './prefs';

// ---- Whether a PR can merge ---------------------------------------------------------------------

const CHECK_ICON: Record<Check['state'], string> = { pass: '✅', fail: '❌', pending: '🟡', skip: '⚪' };

interface MergeStatus {
  icon: string;
  text: string;
  cls: 'ok' | 'warn' | 'bad' | 'muted';
  /** False when merging can't work at all (draft, conflicts, already merged). */
  can: boolean;
  /** GitHub could merge it on its own once the requirements pass. */
  auto: boolean;
}

/** An open PR whose branch can't merge until someone resolves conflicts with the base. */
export function conflicted(d: PullDetail) {
  return d.state === 'open' && d.readiness === 'conflict';
}

export function mergeStatus(d: PullDetail): MergeStatus {
  const failing = d.checks.filter((c) => c.state === 'fail').length;
  const pending = d.checks.filter((c) => c.state === 'pending').length;
  if (d.state === 'merged') return { icon: '🎉', text: 'Merged.', cls: 'ok', can: false, auto: false };
  if (d.state === 'closed') return { icon: '🗑️', text: 'Closed without merging.', cls: 'muted', can: false, auto: false };
  if (d.state === 'draft') return { icon: '📝', text: 'This is still a draft. Mark it ready for review on GitHub before merging.', cls: 'muted', can: false, auto: false };
  if (conflicted(d))
    return { icon: '⚠️', text: `This branch has conflicts with ${d.baseRefName} that must be resolved first.`, cls: 'bad', can: false, auto: false };
  if (d.readiness === 'behind') return { icon: '⤵️', text: `The branch is behind ${d.baseRefName}, and this repo wants it up to date before merging.`, cls: 'warn', can: true, auto: true };
  if (d.readiness === 'blocked') {
    const why = d.review === 'changes' ? 'changes were requested' : d.review === 'pending' ? 'it needs an approving review' : failing ? `${failing} check${failing > 1 ? 's are' : ' is'} failing` : pending ? 'required checks are still running' : 'a branch rule is not met yet';
    return { icon: '🚫', text: `Merging is blocked: ${why}.`, cls: 'bad', can: true, auto: true };
  }
  if (failing) return { icon: '❌', text: `${failing} check${failing > 1 ? 's' : ''} failing. It can still be merged.`, cls: 'warn', can: true, auto: false };
  if (pending || d.readiness === 'checks') return { icon: '🟡', text: 'Checks are still running. It can be merged now, or once they pass.', cls: 'warn', can: true, auto: true };
  if (d.readiness === 'unknown') return { icon: '⏳', text: 'GitHub is still working out whether this can merge. Refresh in a moment.', cls: 'muted', can: true, auto: false };
  return { icon: '✅', text: `Ready to merge: no conflicts with ${d.baseRefName}${d.checks.length ? ' and all checks passed' : ''}.`, cls: 'ok', can: true, auto: false };
}

export function checksList(checks: Check[]) {
  const order: Check['state'][] = ['fail', 'pending', 'pass', 'skip'];
  const sorted = [...checks].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
  return h(
    'ul.gh-checks',
    {},
    ...sorted.map((c) => h('li', {}, h('span', { 'aria-label': c.state }, CHECK_ICON[c.state]), c.url ? h('a', { href: c.url, target: '_blank', rel: 'noopener noreferrer' }, c.name) : h('span', {}, c.name))),
  );
}

// ---- Merge dialog -------------------------------------------------------------------------------

export function openMerge(it: Pull, d: PullDetail, net: Net, handToWorker: () => void, onMerged: () => void) {
  const st = mergeStatus(d);
  const { methods, caps } = d.repo;
  // Auto-merge is offered only where the host can merge once the requirements pass.
  const canAuto = st.auto && caps.autoMerge;
  let method = mergePref(methods);
  let deleteBranch = deleteBranchPref();
  let busy = false;

  const methodBtns = h('div.seg');
  const go = h('button.btn.primary', { type: 'button' });
  const auto = h('input', { type: 'checkbox', id: 'merge-auto' }) as HTMLInputElement;
  auto.checked = canAuto && st.cls !== 'ok';
  const renderMethods = () => {
    methodBtns.replaceChildren(
      ...methods.map((m) =>
        h('button.btn', { type: 'button', class: m.id === method ? 'on' : '', onclick: () => ((method = m.id), savePref(MERGE_KEY, { method, deleteBranch }), renderMethods()) }, m.label),
      ),
    );
    go.textContent = auto.checked ? '⏱ Merge when ready' : `🔀 ${methods.find((m) => m.id === method)?.label ?? method}`;
  };
  auto.addEventListener('change', renderMethods);
  const del = h('input', { type: 'checkbox', id: 'merge-del' }) as HTMLInputElement;
  del.checked = deleteBranch;
  del.addEventListener('change', () => {
    deleteBranch = del.checked;
    savePref(MERGE_KEY, { method, deleteBranch });
  });
  const result = h('div.gh-merge-result.hidden');
  const cancel = h('button.btn', { type: 'button' }, 'Cancel');
  // Conflicts can't be merged from here, so fixing them is the main button.
  const worker = conflicted(d)
    ? h('button.btn.primary', { type: 'button', title: 'A new worker merges the base in, resolves the conflicts, then merges it the way picked above' }, '✨ New worker: fix conflicts & merge')
    : h('button.btn', { type: 'button', title: 'A worker fixes whatever is in the way, then merges' }, '🤖 Hand to a worker');

  const el = h(
    'div.modal.gh-merge',
    { role: 'dialog', 'aria-label': `Merge PR #${it.number}` },
    h('header', {}, h('h2', {}, `🔀 Merge #${it.number}`)),
    h(
      'div.body',
      {},
      h('p.gh-merge-title', {}, it.title, h('small', {}, `${it.headRefName} → ${it.baseRefName}`)),
      h('div.gh-status', { class: st.cls }, h('span', {}, st.icon), st.text),
      d.checks.length ? checksList(d.checks) : null,
      h('label', { style: 'margin-top:14px' }, 'How'),
      methodBtns,
      caps.deleteBranch ? h('label.gh-check', { for: 'merge-del' }, del, `Delete ${it.headRefName} after merging`) : null,
      canAuto ? h('label.gh-check', { for: 'merge-auto', title: 'gh pr merge --auto (the repo must allow auto-merge)' }, auto, 'Merge automatically once the requirements pass') : null,
      result,
    ),
    h('footer', {}, st.can || conflicted(d) ? null : worker, h('span.grow'), cancel, conflicted(d) ? worker : go),
  );
  renderMethods();
  if (!st.can) go.disabled = true;

  const modal = openModal(el, { onClose: () => mergeWaiters.delete(it.number) });
  cancel.addEventListener('click', () => modal.close());
  worker.addEventListener('click', () => {
    modal.close();
    handToWorker();
  });
  go.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    go.disabled = true;
    result.className = 'gh-merge-result';
    result.replaceChildren(h('span.spinner'), auto.checked && canAuto ? 'Asking GitHub to merge it when ready…' : 'Merging…');
    mergeWaiters.set(it.number, (msg) => {
      mergeWaiters.delete(it.number);
      busy = false;
      if (msg.error) {
        go.disabled = false;
        result.className = 'gh-merge-result error';
        result.replaceChildren(msg.error);
        return;
      }
      modal.close();
      onMerged();
    });
    net.send({ t: 'board.merge', number: it.number, method, deleteBranch: deleteBranch && caps.deleteBranch, auto: auto.checked && canAuto });
  });
  setTimeout(() => (st.can ? go : cancel).focus(), 30);
}
