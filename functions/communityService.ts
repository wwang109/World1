import { createCommunityService } from '../src/service/community/service';
import { createGitHubReadPort } from '../src/service/community/github';
import { webCryptoRandomHex, webCryptoSha256Hex } from '../src/meta/account';
import { createD1CommunityStore } from './communityStoreD1';
import { createD1AccountStore } from './accountStoreD1';
import { accountServiceFor, type AccountEnv } from './accountService';
import { createGitHubTechnicalReadiness, trustedValidationConfig, type TrustedValidationEnv } from '../src/service/community/trustedValidation';
import { privateGithubTransport, type PrivateGithubBinding } from '../src/service/community/privateGithubReader';
export interface CommunityEnv extends AccountEnv, TrustedValidationEnv {
  COMMUNITY_REPOSITORY_ID?: string;
  COMMUNITY_READER_TOKEN?: string;
  COMMUNITY_MODERATORS?: string;
  COMMUNITY_POINTS_ENABLED?: string;
  GAME_RULES_REVISION?: string;
  CONTENT_API_VERSION?: string;
  COMMUNITY_GITHUB_READER?: PrivateGithubBinding;
}
export function communityServiceFor(env: CommunityEnv) {
  const accounts = accountServiceFor(env);
  if (!env.GHOSTS_DB || !accounts) return null;
  const accountStore = createD1AccountStore(env.GHOSTS_DB);
  const repositoryId = env.COMMUNITY_REPOSITORY_ID && /^\d+$/.test(env.COMMUNITY_REPOSITORY_ID) ? env.COMMUNITY_REPOSITORY_ID : null;
  const store = createD1CommunityStore(env.GHOSTS_DB);
  const validation = trustedValidationConfig(env);
  return createCommunityService({
    store,
    github: repositoryId ? createGitHubReadPort({ repositoryId, token: env.COMMUNITY_READER_TOKEN, lookupCachedProposal: key => store.getProposal(key) }) : null,
    repositoryId,
    authenticate: accounts.authenticate,
    linkedProvider: async accountId => (await accountStore.linksFor(accountId)).length > 0,
    moderators: (env.COMMUNITY_MODERATORS ?? '').split(',').map(value => value.trim()).filter(Boolean),
    now: () => Date.now(),
    hash: webCryptoSha256Hex,
    hashBytes: async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))).map(value => value.toString(16).padStart(2, '0')).join(''),
    randomId: () => webCryptoRandomHex(16),
    rulesRevision: env.GAME_RULES_REVISION ?? '',
    contentApiVersion: Number(env.CONTENT_API_VERSION ?? 1),
    readiness: validation ? createGitHubTechnicalReadiness(store, env.COMMUNITY_GITHUB_READER ? { ...validation, readerToken: undefined, fetch: privateGithubTransport(env.COMMUNITY_GITHUB_READER) } : validation) : null,
    pointsEnabled: env.COMMUNITY_POINTS_ENABLED === 'true',
  });
}
