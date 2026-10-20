import { COMMUNITY_REPOSITORY } from '../../community/types';
import { requireCommunity, validateSha } from '../../community/validate';
import type { RoundCandidate } from '../../community/rounds';
import type { GitHubMergePort, MergeInspection } from './mergeWinner';
import { makeBackupReceipt, verifyBackupReceipt, type BackupReceipt } from '../../community/backup';
export const COMMUNITY_CHECK_NAMES = { vote: 'community/vote-winner', technical: 'community/technical-ready', content: 'community/content-valid', integration: 'community/integration' } as const;
export interface MergerConfig { appId: string; installationId: string; privateKeyPem: string; appSlug: string; repositoryId: string; enabled: boolean; validateCandidate: (candidate: RoundCandidate, readerToken: string) => Promise<void>; fetch?: typeof fetch }
function base64Url(bytes: Uint8Array): string { let raw = ''; for (const byte of bytes) raw += String.fromCharCode(byte); return btoa(raw).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
export async function githubAppJwt(appId: string, pem: string, now: number): Promise<string> {
  const raw = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const bytes = Uint8Array.from(atob(raw), char => char.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', bytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const encode = (value: unknown): string => base64Url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: Math.floor(now / 1000) - 60, exp: Math.floor(now / 1000) + 540, iss: appId })}`;
  return `${unsigned}.${base64Url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))))}`;
}
export function verifyCommunityRulesets(rulesets: readonly any[], appId: number): boolean {
  const main = rulesets.filter(rule => rule.enforcement === 'active' && rule.target === 'branch' && (rule.conditions?.ref_name?.include ?? []).some((ref: string) => ref === 'refs/heads/main' || ref === '~DEFAULT_BRANCH') && (rule.conditions?.ref_name?.exclude ?? []).length === 0);
  const restricted = main.some(rule => rule.rules?.some((item: any) => item.type === 'update') && rule.bypass_actors?.length === 1 && rule.bypass_actors[0].actor_type === 'Integration' && rule.bypass_actors[0].actor_id === appId && rule.bypass_actors[0].bypass_mode === 'pull_request');
  const protectedChecks = main.some(rule => {
    if ((rule.bypass_actors ?? []).length !== 0 || !rule.rules?.some((item: any) => item.type === 'pull_request')) return false;
    const required = rule.rules?.find((item: any) => item.type === 'required_status_checks')?.parameters;
    if (!required?.strict_required_status_checks_policy) return false;
    return Object.values(COMMUNITY_CHECK_NAMES).every(name => required.required_status_checks?.some((check: any) => check.context === name && check.integration_id === appId));
  });
  return restricted && protectedChecks && verifyBackupRulesets(rulesets);
}
export function verifyBackupRulesets(rulesets: readonly any[]): boolean {
  const protecting = rulesets.filter(rule => rule.enforcement === 'active' && rule.target === 'tag' && (rule.bypass_actors ?? []).length === 0 && (rule.conditions?.ref_name?.exclude ?? []).length === 0 && (rule.conditions?.ref_name?.include ?? []).some((ref: string) => ref === 'refs/tags/community-backup/*' || ref === '~ALL'));
  return ['update', 'deletion'].every(type => protecting.some(rule => rule.rules?.some((item: any) => item.type === type)));
}
export function createGitHubMerger(config: MergerConfig): GitHubMergePort {
  requireCommunity(config.enabled && /^\d+$/.test(config.repositoryId) && /^\d+$/.test(config.appId) && /^\d+$/.test(config.installationId) && /^[a-z0-9-]+$/.test(config.appSlug), 'merge-automation-unconfigured', 503);
  const transport = config.fetch ?? fetch;
  let cachedToken: { token: string; expiresAt: number } | null = null;
  const call = async (method: string, path: string, body?: unknown, acceptMissingOrConflict = false): Promise<any> => {
    if (!cachedToken || cachedToken.expiresAt <= Date.now() + 60_000) {
      const authorization = `Bearer ${await githubAppJwt(config.appId, config.privateKeyPem, Date.now())}`;
      const response = await transport(`https://api.github.com/app/installations/${config.installationId}/access_tokens`, { method: 'POST', headers: { authorization, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'Wandering-Hand-Community-Merger', 'x-github-api-version': '2022-11-28' }, body: JSON.stringify({ repository_ids: [Number(config.repositoryId)], permissions: { contents: 'write', pull_requests: 'write', checks: 'write', actions: 'read' } }), redirect: 'manual', signal: AbortSignal.timeout(15_000) });
      requireCommunity(response.ok, 'merger-auth-unavailable', 503);
      const token = await response.json() as { token: string; expires_at: string }; requireCommunity(typeof token.token === 'string', 'merger-auth-unavailable', 503);
      cachedToken = { token: token.token, expiresAt: Date.parse(token.expires_at) };
    }
    const response = await transport(`https://api.github.com/repos/${COMMUNITY_REPOSITORY}/${path}`, { method, headers: { authorization: `Bearer ${cachedToken.token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'Wandering-Hand-Community-Merger', 'x-github-api-version': '2022-11-28' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    if (acceptMissingOrConflict && (response.status === 404 || response.status === 409 || response.status === 422)) return null;
    requireCommunity(response.ok, 'merger-github-unavailable', 503);
    return response.json();
  };
  const verifyRules = async (): Promise<boolean> => {
    const summaries = await call('GET', 'rulesets?includes_parents=true&per_page=100');
    requireCommunity(Array.isArray(summaries) && summaries.length < 100, 'rulesets-unavailable', 503);
    const rulesets = [];
    for (const summary of summaries) rulesets.push(await call('GET', `rulesets/${Number(summary.id)}`));
    return verifyCommunityRulesets(rulesets, Number(config.appId));
  };
  const backupReference = async (receipt: BackupReceipt): Promise<any> => call('GET', `git/ref/${receipt.manifest.reference.slice('refs/'.length)}`, undefined, true);
  const verifyBackup = async (candidate: RoundCandidate, roundId: string, receipt: BackupReceipt): Promise<void> => {
    await verifyBackupReceipt(roundId, candidate, receipt);
    requireCommunity(candidate.key.repositoryId === config.repositoryId && await verifyRules(), 'backup-protection-unverified', 409);
    const reference = await backupReference(receipt);
    requireCommunity(reference?.ref === receipt.manifest.reference && reference.object?.type === 'commit' && reference.object.sha === candidate.baseSha, 'backup-ref-missing-or-changed', 409);
  };
  return {
    async inspect(candidate): Promise<MergeInspection> {
      requireCommunity(candidate.key.repositoryId === config.repositoryId, 'repository-mismatch', 409);
      const pr = await call('GET', `pulls/${candidate.key.number}`);
      requireCommunity(String(pr.base?.repo?.id) === config.repositoryId && pr.base?.repo?.full_name?.toLowerCase() === COMMUNITY_REPOSITORY && pr.base?.ref === 'main', 'repository-mismatch', 409);
      const main = await call('GET', 'git/ref/heads/main');
      if (!pr.merged_at) requireCommunity(main.object?.sha === pr.base?.sha, 'integration-base-not-current', 409);
      const checks = await call('GET', `commits/${validateSha(candidate.headSha)}/check-runs?per_page=100&filter=latest`);
      const checkPass = Object.values(COMMUNITY_CHECK_NAMES).every(name => checks.check_runs?.filter((check: any) => check.name === name).some((check: any) => check.app?.id === Number(config.appId) && check.head_sha === candidate.headSha && check.status === 'completed' && check.conclusion === 'success'));
      return { headSha: validateSha(pr.head?.sha), baseSha: validateSha(pr.base?.sha), open: pr.state === 'open' && !pr.draft, merged: Boolean(pr.merged_at), mergeCommitSha: pr.merged_at ? validateSha(pr.merge_commit_sha) : null, mergedByExpectedApp: pr.merged_by?.type === 'Bot' && pr.merged_by?.login === `${config.appSlug}[bot]`, trustedChecksPass: checkPass, rulesetsVerified: await verifyRules() };
    },
    async ensureBackup(candidate, roundId) {
      requireCommunity(candidate.key.repositoryId === config.repositoryId && await verifyRules(), 'backup-protection-unverified', 409);
      const receipt = await makeBackupReceipt(roundId, candidate, Date.now());
      const main = await call('GET', 'git/ref/heads/main'); requireCommunity(main.object?.sha === candidate.baseSha, 'backup-base-not-current', 409);
      let reference = await backupReference(receipt);
      if (!reference) {
        try { await call('POST', 'git/refs', { ref: receipt.manifest.reference, sha: candidate.baseSha }, true); }
        catch (error) { reference = await backupReference(receipt); if (!reference) throw error; }
        reference = await backupReference(receipt);
      }
      requireCommunity(reference?.ref === receipt.manifest.reference && reference.object?.type === 'commit' && reference.object.sha === candidate.baseSha, 'backup-ref-missing-or-changed', 409);
      const after = await call('GET', 'git/ref/heads/main'); requireCommunity(after.object?.sha === candidate.baseSha, 'backup-base-moved', 409);
      await verifyBackup(candidate, roundId, receipt);
      return receipt;
    },
    verifyBackup,
    async recordVoteWinner(candidate: RoundCandidate, roundId: string, backup: BackupReceipt) {
      await verifyBackup(candidate, roundId, backup);
      requireCommunity(cachedToken, 'merger-auth-unavailable', 503);
      await config.validateCandidate(candidate, cachedToken.token);
      for (const name of Object.values(COMMUNITY_CHECK_NAMES)) await call('POST', 'check-runs', { name, head_sha: candidate.headSha, external_id: `merge:${roundId}:${name}`, status: 'completed', conclusion: 'success', output: { title: 'Verified community round candidate', summary: `Round ${roundId}; proposal #${candidate.key.number}; support ${candidate.support}; evidence ${candidate.technicalEvidenceHash}` } });
    },
    async approve(candidate, backup) { await verifyBackup(candidate, backup.manifest.roundId, backup); await call('POST', `pulls/${candidate.key.number}/reviews`, { commit_id: candidate.headSha, event: 'APPROVE', body: `The persisted community round selected this exact reviewed head. Confirmed pre-merge restore point: ${backup.manifest.reference} at ${backup.manifest.baseSha}; manifest SHA256 ${backup.manifestSha256}.` }); },
    async merge(candidate, backup) { await verifyBackup(candidate, backup.manifest.roundId, backup); const result = await call('PUT', `pulls/${candidate.key.number}/merge`, { sha: candidate.headSha, merge_method: 'merge' }); requireCommunity(result.merged === true, 'github-merge-not-confirmed', 503); return { mergeCommitSha: validateSha(result.sha) }; },
  };
}
