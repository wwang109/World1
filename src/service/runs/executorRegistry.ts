import { current, executors } from './generated/registry';
import type { EligibleRun, RevisionKey, RunExecutor } from '../../run/online/types';
import { RunServiceError } from './store';

export function getExecutor(key: RevisionKey): RunExecutor {
  const executor = executors.find(value => value.key.rulesRevision === key.rulesRevision && value.key.contentSha === key.contentSha);
  if (!executor) throw new RunServiceError('This run requires an unavailable retained executor', 503);
  return executor;
}
export const executorRegistry = { current, get: getExecutor };
export const presentEligibleRun = (run: EligibleRun) => ({ ...run, content: getExecutor(run.key).present(run.state) });
