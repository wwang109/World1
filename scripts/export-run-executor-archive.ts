import { resolve, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { exportRequiredExecutors } from './run-executor-preflight';
import { executorArchiveId, exportExecutorArchive } from './run-executor-archive';

const option = (name: string): string | undefined => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
const output = resolve(option('--output') ?? 'tmp/community/executor-registry');
const required = await exportRequiredExecutors();
mkdirSync(output, { recursive: true });
for (const approval of required.approvals!) {
  const id = executorArchiveId(approval.key);
  const envelope = exportExecutorArchive(resolve('.run-executor-archive', id), join(output, id), approval);
  console.log(`approved executor export ${id}: ${Object.keys(envelope.byteLengths).length} files; ${envelope.totalBytes} bytes`);
}
writeFileSync(join(output, 'approved-executors.json'), JSON.stringify(required, null, 2));
console.log('Publish the immutable per-ID directories to the configured HTTPS registry using the reviewed storage provider. No remote writes performed.');
