import { createHash } from 'node:crypto';
import { COMMUNITY_REPOSITORY } from '../src/community/types';
import { parseCommunityJson, requireCommunity } from '../src/community/validate';
import { COMMUNITY_CHECK_NAMES, githubAppJwt, verifyBackupRulesets, verifyCommunityRulesets } from '../src/service/community/mergerGithub';
import type { AutomationConfig } from './community-automation';

export async function configureCommunityGithub(config: AutomationConfig, options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}): Promise<{ rulesetIds: number[]; trustedGameRevision: string; mergeEnabled: false }> {
  const env = options.env ?? process.env, transport = options.fetch ?? fetch;
  requireCommunity(config.schemaVersion === 1 && config.repository === COMMUNITY_REPOSITORY && config.repositoryId === '1426486653' && Number.isSafeInteger(config.mainUpdateRulesetId) && config.mainUpdateRulesetId! > 0, 'setup-exact-target-and-main-ruleset-ID-required');
  requireCommunity(Boolean(env.COMMUNITY_SETUP_OWNER_TOKEN) && Boolean(env.COMMUNITY_MERGER_PRIVATE_KEY), 'setup-explicit-owner-token-and-App-key-required');
  requireCommunity(/^\d+$/.test(config.mergerAppId) && /^\d+$/.test(config.mergerInstallationId) && /^[a-z0-9-]+$/.test(config.mergerAppSlug), 'setup-correct-target-installation-required');
  const prefix = `repos/${COMMUNITY_REPOSITORY}`, owner = `Bearer ${env.COMMUNITY_SETUP_OWNER_TOKEN}`;
  const request = async (method: string, path: string, authorization = owner, body?: unknown, missing = false): Promise<any> => {
    const response = await transport(`https://api.github.com/${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { authorization, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'x-github-api-version': '2022-11-28' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (missing && response.status === 404) return null;
    requireCommunity(response.ok, `GitHub-setup-${method}-http-${response.status}`);
    if (response.status === 204) return null;
    const bytes = new Uint8Array(await response.arrayBuffer()); requireCommunity(bytes.length <= 4 * 1024 * 1024, 'setup-response-too-large'); return parseCommunityJson(new TextDecoder().decode(bytes));
  };
  const repository = await request('GET', prefix);
  requireCommunity(String(repository.id) === config.repositoryId && repository.default_branch === 'main' && repository.permissions?.admin === true, 'setup-target-admin-access-unverified');
  const jwt = `Bearer ${await githubAppJwt(config.mergerAppId, env.COMMUNITY_MERGER_PRIVATE_KEY!, Date.now())}`;
  const installation = await request('GET', `${prefix}/installation`, jwt);
  requireCommunity(String(installation.id) === config.mergerInstallationId && String(installation.app_id) === config.mergerAppId && installation.app_slug === config.mergerAppSlug && installation.account?.login?.toLowerCase() === 'wwang109' && installation.repository_selection === 'selected' && !installation.suspended_at, 'setup-wrong-owner-or-broad-installation');
  requireCommunity(['contents', 'pull_requests', 'checks'].every(permission => installation.permissions?.[permission] === 'write') && ['read', 'write'].includes(installation.permissions?.actions), 'setup-App-permissions-mismatch');
  const token = await request('POST', `app/installations/${config.mergerInstallationId}/access_tokens`, jwt, { repository_ids: [Number(config.repositoryId)], permissions: { contents: 'read', pull_requests: 'read', checks: 'read', actions: 'read' } });
  requireCommunity(typeof token.token === 'string', 'setup-installation-token-unavailable');
  const scoped = await request('GET', 'installation/repositories?per_page=100', `Bearer ${token.token}`);
  requireCommunity(scoped.total_count === 1 && String(scoped.repositories?.[0]?.id) === config.repositoryId, 'setup-installation-token-not-target-only');
  requireCommunity(/^[a-f0-9]{40}$/.test(config.trustedGameRevision) && /^[a-f0-9]{40}$/.test(config.validationAnchorSha) && /^[a-f0-9]{64}$/.test(config.validationWorkflowSha256) && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.trustedGameRepository) && Number.isSafeInteger(config.validationWorkflowId) && config.validationWorkflowId > 0, 'setup-published-trusted-tooling-config-required');
  const commit = await request('GET', `repos/${config.trustedGameRepository}/commits/${config.trustedGameRevision}`); requireCommunity(commit.sha === config.trustedGameRevision, 'setup-trusted-game-unpublished');
  const tooling = await request('GET', `repos/${config.trustedGameRepository}/contents/scripts/validate-community-candidate.ts?ref=${config.trustedGameRevision}`); requireCommunity(tooling.type === 'file' && tooling.encoding === 'base64' && typeof tooling.content === 'string', 'setup-trusted-validation-tooling-missing');
  const main = await request('GET', `${prefix}/git/ref/heads/main`); const mainSha = main.object?.sha; requireCommunity(/^[a-f0-9]{40}$/.test(mainSha), 'setup-current-main-unavailable');
  const ancestry = await request('GET', `${prefix}/compare/${config.validationAnchorSha}...${mainSha}`); requireCommunity(['identical', 'ahead'].includes(ancestry.status), 'setup-main-outside-approved-anchor');
  const workflow = await request('GET', `${prefix}/actions/workflows/${config.validationWorkflowId}`); requireCommunity(workflow.path === '.github/workflows/validate-content.yml' && workflow.state === 'active', 'setup-workflow-identity-mismatch');
  const bytes = await request('GET', `${prefix}/contents/.github/workflows/validate-content.yml?ref=${mainSha}`);
  requireCommunity(bytes.encoding === 'base64' && typeof bytes.content === 'string' && createHash('sha256').update(Buffer.from(bytes.content, 'base64')).digest('hex') === config.validationWorkflowSha256, 'setup-approved-workflow-digest-mismatch');
  const allRules = async (): Promise<any[]> => { const summaries = await request('GET', `${prefix}/rulesets?includes_parents=true&per_page=100`); requireCommunity(Array.isArray(summaries) && summaries.length < 100, 'setup-ruleset-list-incomplete'); return Promise.all(summaries.map((summary: { id: number }) => request('GET', `${prefix}/rulesets/${Number(summary.id)}`))); };
  const rules = await allRules(); requireCommunity(verifyBackupRulesets(rules), 'setup-protected-backup-namespace-required');
  const exactMain = (rule: any): boolean => rule.conditions?.ref_name?.exclude?.length === 0 && rule.conditions?.ref_name?.include?.length === 1 && rule.conditions.ref_name.include[0] === 'refs/heads/main';
  const updater = rules.find(rule => rule.id === config.mainUpdateRulesetId);
  requireCommunity(updater && updater.source_type === 'Repository' && updater.enforcement === 'active' && updater.target === 'branch' && exactMain(updater) && Array.isArray(updater.rules) && updater.rules.some((rule: any) => rule.type === 'update') && updater.rules.every((rule: any) => ['update', 'deletion', 'non_fast_forward'].includes(rule.type)) && new Set(updater.rules.map((rule: any) => rule.type)).size === updater.rules.length, 'setup-main-updater-scope-or-rules-mismatch');
  requireCommunity((updater.bypass_actors ?? []).length === 0 || (updater.bypass_actors.length === 1 && updater.bypass_actors[0].actor_type === 'Integration' && updater.bypass_actors[0].actor_id === Number(config.mergerAppId) && updater.bypass_actors[0].bypass_mode === 'pull_request'), 'setup-unreviewed-existing-bypass');
  const checksName = 'Community required reviewed winner';
  const existing = rules.filter(rule => rule.name === checksName); requireCommunity(existing.length <= 1, 'setup-ambiguous-required-check-ruleset');
  if (existing[0]) requireCommunity(existing[0].source_type === 'Repository' && existing[0].target === 'branch' && exactMain(existing[0]) && (existing[0].bypass_actors ?? []).length === 0 && existing[0].rules?.length === 2 && existing[0].rules.every((rule: any) => ['pull_request', 'required_status_checks'].includes(rule.type)) && existing[0].rules.find((rule: any) => rule.type === 'required_status_checks')?.parameters?.required_status_checks?.length === 4 && verifyCommunityRulesets([existing[0], { ...updater, bypass_actors: [{ actor_type: 'Integration', actor_id: Number(config.mergerAppId), bypass_mode: 'pull_request' }] }, ...rules.filter(rule => rule.target === 'tag')], Number(config.mergerAppId)), 'setup-existing-checks-rule-needs-review');
  if (existing[0]) { const review = existing[0].rules.find((rule: any) => rule.type === 'pull_request')?.parameters; requireCommunity(review?.required_approving_review_count >= 1 && review.dismiss_stale_reviews_on_push === true && review.require_last_push_approval === true && review.required_review_thread_resolution === true, 'setup-existing-review-policy-needs-review'); }
  const ruleBody = { name: checksName, target: 'branch', enforcement: 'active', conditions: { ref_name: { exclude: [], include: ['refs/heads/main'] } }, bypass_actors: [], rules: [{ type: 'pull_request', parameters: { required_approving_review_count: 1, dismiss_stale_reviews_on_push: true, require_code_owner_review: false, require_last_push_approval: true, required_review_thread_resolution: true } }, { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, do_not_enforce_on_create: false, required_status_checks: Object.values(COMMUNITY_CHECK_NAMES).map(context => ({ context, integration_id: Number(config.mergerAppId) })) } }] };
  // The no-bypass gate is created and read back before main's existing update lock gains its App bypass.
  const checkRule = existing[0] ?? await request('POST', `${prefix}/rulesets`, owner, ruleBody);
  const confirmedChecks = await request('GET', `${prefix}/rulesets/${Number(checkRule.id)}`);
  const proposedUpdater = { ...updater, bypass_actors: [{ actor_type: 'Integration', actor_id: Number(config.mergerAppId), bypass_mode: 'pull_request' }] };
  requireCommunity(verifyCommunityRulesets([proposedUpdater, confirmedChecks, ...rules.filter(rule => rule.target === 'tag')], Number(config.mergerAppId)), 'setup-created-pinned-checks-unconfirmed');
  const variable = await request('GET', `${prefix}/actions/variables/TRUSTED_GAME_REVISION`, owner, undefined, true);
  if (variable?.value !== config.trustedGameRevision) await request(variable ? 'PATCH' : 'POST', `${prefix}/actions/variables${variable ? '/TRUSTED_GAME_REVISION' : ''}`, owner, { name: 'TRUSTED_GAME_REVISION', value: config.trustedGameRevision });
  requireCommunity((await request('GET', `${prefix}/actions/variables/TRUSTED_GAME_REVISION`)).value === config.trustedGameRevision, 'setup-tooling-variable-unconfirmed');
  requireCommunity((await request('GET', `${prefix}/git/ref/heads/main`)).object?.sha === mainSha, 'setup-base-moved-before-update-policy');
  await request('PUT', `${prefix}/rulesets/${config.mainUpdateRulesetId}`, owner, { name: updater.name, target: updater.target, enforcement: 'active', conditions: updater.conditions, rules: updater.rules, bypass_actors: proposedUpdater.bypass_actors });
  const finalRules = await allRules(); requireCommunity(verifyCommunityRulesets(finalRules, Number(config.mergerAppId)), 'setup-final-protections-unconfirmed');
  return { rulesetIds: [config.mainUpdateRulesetId!, Number(checkRule.id)], trustedGameRevision: config.trustedGameRevision, mergeEnabled: false };
}
