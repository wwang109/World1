import { createD1CommunityStore } from '../functions/communityStoreD1';
import type { D1Database } from '../functions/d1';
import { createRoundMerger } from '../src/service/community/mergeWinner';
import { createGitHubMerger } from '../src/service/community/mergerGithub';
import { createTrustedValidationReader, proposalImplemented, trustedValidationConfig, type TrustedValidationEnv } from '../src/service/community/trustedValidation';
import { requireCommunity } from '../src/community/validate';
import { createGitHubReadPort } from '../src/service/community/github';
import { reconcileCommunitySources, sourcesFreshForRound } from '../src/service/community/reconcile';
import { webCryptoRandomHex } from '../src/meta/account';
import { createPrivateGithubReader } from '../src/service/community/privateGithubReader';
interface RoundEnv extends TrustedValidationEnv {
  GHOSTS_DB?: D1Database;
  COMMUNITY_MERGE_ENABLED?: string;
  COMMUNITY_MERGER_APP_ID?: string;
  COMMUNITY_MERGER_INSTALLATION_ID?: string;
  COMMUNITY_MERGER_PRIVATE_KEY?: string;
  COMMUNITY_MERGER_APP_SLUG?: string;
  COMMUNITY_REPOSITORY_ID?: string;
  GAME_RULES_REVISION?: string;
  CONTENT_API_VERSION?: string;
  COMMUNITY_SOURCE_SYNC_BUDGET?: string;
}
export async function runCommunityRounds(env: RoundEnv, now = Date.now()): Promise<{ closed: number; automationConfigured: boolean; sourceHealthy: boolean; imported: number }> {
  if (!env.GHOSTS_DB) throw new Error('community-store-unavailable');
  const store = createD1CommunityStore(env.GHOSTS_DB);
  await store.ensureRound(now);
  const source = env.COMMUNITY_REPOSITORY_ID ? createGitHubReadPort({ repositoryId: env.COMMUNITY_REPOSITORY_ID, token: env.COMMUNITY_READER_TOKEN, lookupCachedProposal: key => store.getProposal(key) }) : null;
  const synchronization = await reconcileCommunitySources({ store, github: source, now: () => Date.now(), randomId: () => webCryptoRandomHex(16), hashBytes: async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))).map(value => value.toString(16).padStart(2, '0')).join(''), budget: Number(env.COMMUNITY_SOURCE_SYNC_BUDGET ?? (env.COMMUNITY_READER_TOKEN ? 5 : 1)), intervalMs: env.COMMUNITY_READER_TOKEN ? 5 * 60_000 : 15 * 60_000 });
  const enabled = env.COMMUNITY_MERGE_ENABLED === 'true';
  const validation = trustedValidationConfig(env);
  const github = enabled ? createGitHubMerger({ enabled, appId: env.COMMUNITY_MERGER_APP_ID ?? '', installationId: env.COMMUNITY_MERGER_INSTALLATION_ID ?? '', privateKeyPem: env.COMMUNITY_MERGER_PRIVATE_KEY ?? '', appSlug: env.COMMUNITY_MERGER_APP_SLUG ?? '', repositoryId: env.COMMUNITY_REPOSITORY_ID ?? '', validateCandidate: async (candidate, readerToken) => {
    requireCommunity(validation, 'trusted-validation-unconfigured', 503);
    const proposal = await store.getProposal(candidate.key);
    requireCommunity(proposal?.technical, 'winner-technical-review-missing', 409);
    requireCommunity(proposal.state === 'open' && proposal.headSha === candidate.headSha && proposal.reviewedHeadSha === candidate.headSha && proposal.technical.evidenceHash === candidate.technicalEvidenceHash && proposal.technical.rulesRevision === validation.gameRulesRevision && candidate.rulesRevision === validation.gameRulesRevision, 'winner-technical-review-changed', 409);
    const verified = await createTrustedValidationReader({ ...validation, readerToken })(proposal);
    requireCommunity(verified.report.mechanicsValidation === 'valid' && proposalImplemented(verified.report, proposal) && verified.artifactSha256 === candidate.validationArtifactSha256 && proposal.technical.validationArtifactSha256 === verified.artifactSha256, 'winner-validation-artifact-changed-or-not-implemented', 409);
  } }) : null;
  const merger = createRoundMerger({ store, github, now: () => Date.now() });
  let closed = 0;
  for (const id of await store.dueRounds(now)) {
    if (!synchronization.healthy || !await sourcesFreshForRound(store, id)) continue;
    const round = await store.closeRound(id, now, env.GAME_RULES_REVISION ?? '', Number(env.CONTENT_API_VERSION ?? 1));
    closed++;
    if (round.state === 'closing' && github) await merger(id);
  }
  return { closed, automationConfigured: enabled, sourceHealthy: synchronization.healthy, imported: synchronization.updated };
}
let privateReader: { identity: string; key: string; handle: (request: Request) => Promise<Response> } | null = null;
export default {
  async fetch(request: Request, env: RoundEnv): Promise<Response> {
    const identity = JSON.stringify([env.COMMUNITY_REPOSITORY_ID, env.COMMUNITY_MERGER_APP_ID, env.COMMUNITY_MERGER_INSTALLATION_ID, env.COMMUNITY_MERGER_APP_SLUG]);
    const key = env.COMMUNITY_MERGER_PRIVATE_KEY ?? '';
    if (!privateReader || privateReader.identity !== identity || privateReader.key !== key) privateReader = { identity, key, handle: createPrivateGithubReader({ repositoryId: env.COMMUNITY_REPOSITORY_ID ?? '', appId: env.COMMUNITY_MERGER_APP_ID ?? '', installationId: env.COMMUNITY_MERGER_INSTALLATION_ID ?? '', appSlug: env.COMMUNITY_MERGER_APP_SLUG ?? '', privateKeyPem: key }) };
    return privateReader.handle(request);
  },
  async scheduled(_controller: unknown, env: RoundEnv): Promise<void> { await runCommunityRounds(env); },
};
