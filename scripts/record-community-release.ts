import { readFileSync } from 'node:fs';
import { createFileCommunityStore } from '../server/communityStoreFile';
import { createReleaseRecorder } from '../src/service/community/release';
import { COMMUNITY_REPOSITORY } from '../src/community/types';
import { parseCommunityJson, requireCommunity } from '../src/community/validate';
import type { ReleaseReceipt } from '../src/community/release';
import { createD1CommunityStore } from '../functions/communityStoreD1';
import { createRemoteCommunityD1 } from './community-remote-d1';
const value = (name: string): string | undefined => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
requireCommunity(['local', 'd1'].includes(value('--store') ?? '') && value('--receipt'), 'explicit-local-or-D1-store-and-receipt-required');
const receipt = parseCommunityJson(readFileSync(value('--receipt')!, 'utf8')) as ReleaseReceipt;
const account = process.env.CLOUDFLARE_ACCOUNT_ID; const token = process.env.CLOUDFLARE_API_TOKEN;
requireCommunity(account && token, 'cloudflare-read-proof-credentials-required', 503);
const githubHeaders: Record<string, string> = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }; if (process.env.COMMUNITY_READER_TOKEN) githubHeaders.authorization = `Bearer ${process.env.COMMUNITY_READER_TOKEN}`;
const github = async (path: string): Promise<any> => { const response = await fetch(`https://api.github.com/repos/${COMMUNITY_REPOSITORY}/${path}`, { headers: githubHeaders, redirect: 'error' }); requireCommunity(response.ok, 'github-release-evidence-unavailable', 503); return response.json(); };
const dryRun = value('--store') === 'd1' && !process.argv.includes('--apply');
const store = value('--store') === 'd1' ? createD1CommunityStore(await createRemoteCommunityD1({ readOnly: dryRun })) : createFileCommunityStore(process.env.ELIGIBLE_COMMUNITY_STORE_FILE);
const recordRelease = createReleaseRecorder(store, {
  async deployment(id) {
    requireCommunity(/^[A-Za-z0-9-]{1,100}$/.test(id), 'invalid-deployment-id');
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/proof-of-concept-ab-deckbuilder/deployments/${id}`, { headers: { authorization: `Bearer ${token}` }, redirect: 'error' });
    requireCommunity(response.ok, 'deployment-proof-unavailable', 503);
    const envelope = await response.json() as any; const deployed = envelope.result;
    requireCommunity(envelope.success === true && deployed?.id === id && deployed.latest_stage?.name === 'deploy' && deployed.latest_stage.status === 'success', 'deployment-not-successful', 409);
    const url = new URL(deployed.url); requireCommunity(url.protocol === 'https:' && url.hostname.endsWith('.pages.dev') && !url.username && !url.password, 'invalid-deployment-origin');
    const runtime = await fetch(new URL('/community/runtime', url), { redirect: 'error' }); requireCommunity(runtime.ok, 'deployed-runtime-proof-unavailable', 503);
    const evidence = await runtime.json() as { contentSha: string; runtimeFiles: Record<string, string> };
    return { succeeded: true, contentSha: evidence.contentSha, runtimeFiles: evidence.runtimeFiles };
  },
  async mergedAncestor(repositoryId, number, headSha, contentSha) {
    if (repositoryId !== '1426486653' || !Number.isSafeInteger(number) || number <= 0) return false;
    const pr = await github(`pulls/${number}`); if (!pr.merged_at || pr.head?.sha !== headSha || !/^[a-f0-9]{40}$/.test(pr.merge_commit_sha)) return false;
    const comparison = await github(`compare/${pr.merge_commit_sha}...${contentSha}`); return comparison.status === 'ahead' || comparison.status === 'identical';
  },
}, { dryRun });
await recordRelease(receipt);
console.log(`${dryRun ? 'Dry run verified' : 'Recorded verified'} release ${receipt.deploymentId}; no deployment was started.`);
