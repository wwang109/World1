import { COMMUNITY_REPOSITORY, type ProposalSnapshot } from '../../community/types';
import { parseCommunityJson, record, requireCommunity, validateSha } from '../../community/validate';
import type { TechnicalReadinessPort, TrustedTechnicalEvidence } from './technicalReadiness';
import type { CommunityStore } from './store';
export interface TrustedValidationConfig {
  repositoryId: string;
  workflowId: number;
  workflowPath: string;
  workflowSha256: string;
  approvedBaseSha: string;
  gameRulesRevision: string;
  fetch?: typeof fetch;
  readerToken?: string;
}
export interface CandidateValidationReport {
  version: 1;
  repositoryId: number;
  prNumber: number;
  headSha: string;
  baseSha: string;
  trustedGameRevision: string;
  contentManifestSha256: string;
  gameContentApiVersion: number;
  proposalManifests: { path: string; sha256: string; implementation?: { state: 'implemented' | 'needs_implementation'; runtimeChanges: { path: string; baseSha256: string | null; sha256: string }[] } }[];
  results: { snapshot: string; generated: string; proposal: string };
  mechanicsValidation: string;
  mechanicsEvidence?: string[];
  readiness?: Record<string, boolean>;
}
export interface VerifiedCandidateValidation { report: CandidateValidationReport; artifactSha256: string; runId: number }
export interface TrustedValidationEnv { COMMUNITY_REPOSITORY_ID?: string; COMMUNITY_VALIDATION_WORKFLOW_ID?: string; COMMUNITY_VALIDATION_WORKFLOW_SHA256?: string; COMMUNITY_VALIDATION_BASE_SHA?: string; GAME_RULES_REVISION?: string; COMMUNITY_READER_TOKEN?: string }
export function trustedValidationConfig(env: TrustedValidationEnv): TrustedValidationConfig | null {
  if (!env.COMMUNITY_REPOSITORY_ID || !env.COMMUNITY_VALIDATION_WORKFLOW_ID || !env.COMMUNITY_VALIDATION_WORKFLOW_SHA256 || !env.COMMUNITY_VALIDATION_BASE_SHA || !env.GAME_RULES_REVISION) return null;
  return { repositoryId: env.COMMUNITY_REPOSITORY_ID, workflowId: Number(env.COMMUNITY_VALIDATION_WORKFLOW_ID), workflowPath: '.github/workflows/validate-content.yml', workflowSha256: env.COMMUNITY_VALIDATION_WORKFLOW_SHA256, approvedBaseSha: env.COMMUNITY_VALIDATION_BASE_SHA, gameRulesRevision: env.GAME_RULES_REVISION, readerToken: env.COMMUNITY_READER_TOKEN };
}
const MAX_ARTIFACT = 1_048_576;
async function bytesBounded(response: Response, maximum: number): Promise<Uint8Array> {
  requireCommunity(response.ok && Number(response.headers.get('content-length') ?? 0) <= maximum, 'validation-source-unavailable', 503);
  const reader = response.body?.getReader(); requireCommunity(reader, 'validation-source-unavailable', 503);
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > maximum) { await reader.cancel(); requireCommunity(false, 'validation-artifact-too-large', 503); } chunks.push(item.value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
async function sha256(bytes: Uint8Array): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))).map(byte => byte.toString(16).padStart(2, '0')).join(''); }
export async function decodeValidationArtifact(bytes: Uint8Array): Promise<CandidateValidationReport> {
  requireCommunity(bytes.length <= MAX_ARTIFACT && bytes.length >= 22, 'invalid-validation-artifact', 503);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65_557) && view.getUint32(end, true) !== 0x06054b50) end--;
  requireCommunity(end >= 0 && view.getUint16(end + 8, true) === 1 && view.getUint16(end + 10, true) === 1, 'invalid-validation-archive', 503);
  const central = view.getUint32(end + 16, true);
  requireCommunity(central + 46 <= bytes.length && view.getUint32(central, true) === 0x02014b50, 'invalid-validation-archive', 503);
  const flags = view.getUint16(central + 8, true), method = view.getUint16(central + 10, true), packed = view.getUint32(central + 20, true), size = view.getUint32(central + 24, true), nameLength = view.getUint16(central + 28, true), local = view.getUint32(central + 42, true);
  const name = new TextDecoder().decode(bytes.slice(central + 46, central + 46 + nameLength));
  requireCommunity(name === 'content-validation-report.json' && !(flags & 1) && (method === 0 || method === 8) && size <= 256 * 1024 && local + 30 <= bytes.length && view.getUint32(local, true) === 0x04034b50, 'invalid-validation-archive', 503);
  const dataAt = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  requireCommunity(dataAt + packed <= central, 'invalid-validation-archive', 503);
  const compressed = bytes.slice(dataAt, dataAt + packed);
  const unpacked = method === 0 ? compressed : await bytesBounded(new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw' as CompressionFormat))), 256 * 1024);
  requireCommunity(unpacked.length === size, 'invalid-validation-archive', 503);
  return record(parseCommunityJson(new TextDecoder('utf-8', { fatal: true }).decode(unpacked))) as unknown as CandidateValidationReport;
}
export function verifyCandidateReport(report: CandidateValidationReport, proposal: ProposalSnapshot, config: TrustedValidationConfig): void {
  requireCommunity(report.version === 1 && String(report.repositoryId) === config.repositoryId && report.prNumber === proposal.key.number && report.headSha === proposal.headSha && report.baseSha === proposal.baseSha && report.trustedGameRevision === config.gameRulesRevision && report.gameContentApiVersion === 1 && /^[a-f0-9]{64}$/.test(report.contentManifestSha256), 'candidate-validation-identity-mismatch', 409);
  requireCommunity(report.results?.snapshot === 'valid' && report.results.generated === 'valid' && report.results.proposal === 'valid' && report.proposalManifests?.some(manifest => manifest.path === proposal.manifestPath && manifest.sha256 === proposal.manifestSha256), 'candidate-validation-failed', 409);
}
export function proposalImplemented(report: CandidateValidationReport, proposal: ProposalSnapshot): boolean {
  const matches = report.proposalManifests?.filter(manifest => manifest.path === proposal.manifestPath && manifest.sha256 === proposal.manifestSha256);
  if (matches?.length !== 1) return false;
  const evidence = matches[0]!.implementation;
  if (evidence?.state !== 'implemented' || !Array.isArray(evidence.runtimeChanges) || evidence.runtimeChanges.length === 0) return false;
  if (evidence.runtimeChanges.length > 36 || new Set(evidence.runtimeChanges.map(change => change.path)).size !== evidence.runtimeChanges.length) return false;
  const declared = [...proposal.manifest.contentPaths, ...proposal.manifest.previewPaths];
  return evidence.runtimeChanges.every(change => declared.includes(change.path) && (change.path === 'art-manifest.v1.json' || /^src\/data\/content\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.json$/.test(change.path) || /^public\/game-art\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:png|webp)$/.test(change.path)) && /^[a-f0-9]{64}$/.test(change.sha256) && (change.baseSha256 === null || /^[a-f0-9]{64}$/.test(change.baseSha256)) && change.baseSha256 !== change.sha256);
}
export function createTrustedValidationReader(config: TrustedValidationConfig) {
  const transport = config.fetch ?? fetch;
  const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'Wandering-Hand-Community-Reader', 'x-github-api-version': '2022-11-28' }; if (config.readerToken) headers.authorization = `Bearer ${config.readerToken}`;
  const get = async (path: string): Promise<any> => JSON.parse(new TextDecoder().decode(await bytesBounded(await transport(`https://api.github.com/repos/${COMMUNITY_REPOSITORY}/${path}`, { headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) }), 2_000_000)));
  return async function readValidation(proposal: ProposalSnapshot): Promise<VerifiedCandidateValidation> {
    requireCommunity(Number.isSafeInteger(config.workflowId) && config.workflowId > 0 && config.workflowPath === '.github/workflows/validate-content.yml' && /^[a-f0-9]{64}$/.test(config.workflowSha256) && /^[a-f0-9]{40}$/.test(config.gameRulesRevision), 'trusted-workflow-unconfigured', 503);
    validateSha(config.approvedBaseSha);
    const workflow = await get(`actions/workflows/${config.workflowId}`);
    requireCommunity(workflow.id === config.workflowId && workflow.path === config.workflowPath && workflow.state === 'active', 'trusted-workflow-mismatch', 409);
    const ancestry = await get(`compare/${config.approvedBaseSha}...${proposal.baseSha}`);
    requireCommunity(ancestry.status === 'ahead' || ancestry.status === 'identical', 'untrusted-validation-base', 409);
    const source = await get(`contents/${config.workflowPath}?ref=${proposal.baseSha}`);
    requireCommunity(source.type === 'file' && source.encoding === 'base64' && typeof source.content === 'string', 'trusted-workflow-source-unavailable', 503);
    const sourceBytes = Uint8Array.from(atob(source.content.replace(/\s/g, '')), value => value.charCodeAt(0));
    requireCommunity(await sha256(sourceBytes) === config.workflowSha256, 'trusted-workflow-digest-mismatch', 409);
    const sourcePr = await get(`pulls/${proposal.key.number}`);
    requireCommunity(sourcePr.head?.sha === proposal.headSha && sourcePr.base?.sha === proposal.baseSha && String(sourcePr.base?.repo?.id) === config.repositoryId, 'candidate-source-changed', 409);
    const runs = await get(`actions/workflows/${config.workflowId}/runs?event=pull_request_target&status=success&per_page=100`);
    requireCommunity(Array.isArray(runs.workflow_runs), 'trusted-workflow-runs-unavailable', 503);
    for (const summary of runs.workflow_runs) {
      const run = await get(`actions/runs/${Number(summary.id)}`);
      if (run.workflow_id !== config.workflowId || run.event !== 'pull_request_target' || run.head_sha !== proposal.baseSha || String(run.repository?.id) !== config.repositoryId || ![config.repositoryId, String(sourcePr.head?.repo?.id)].includes(String(run.head_repository?.id)) || run.path !== config.workflowPath || run.status !== 'completed' || run.conclusion !== 'success') continue;
      const artifacts = await get(`actions/runs/${run.id}/artifacts?per_page=100`);
      const matches = artifacts.artifacts?.filter((artifact: any) => artifact.name === 'content-validation-report' && !artifact.expired);
      if (!matches || matches.length !== 1) continue;
      const artifact = matches[0];
      requireCommunity(Number.isSafeInteger(artifact.id) && artifact.size_in_bytes <= MAX_ARTIFACT && /^sha256:[a-f0-9]{64}$/.test(artifact.digest), 'validation-artifact-unverifiable', 503);
      const response = await transport(`https://api.github.com/repos/${COMMUNITY_REPOSITORY}/actions/artifacts/${artifact.id}/zip`, { headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
      let download = response;
      if (response.status === 302) {
        const location = response.headers.get('location'); requireCommunity(location, 'validation-artifact-unavailable', 503); const url = new URL(location);
        requireCommunity(url.protocol === 'https:' && !url.username && !url.password && !url.port && (url.hostname.endsWith('.blob.core.windows.net') || url.hostname.endsWith('.actions.githubusercontent.com')), 'invalid-artifact-host', 503);
        download = await transport(url.toString(), { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
      }
      const bytes = await bytesBounded(download, MAX_ARTIFACT);
      const artifactSha256 = await sha256(bytes); requireCommunity(`sha256:${artifactSha256}` === artifact.digest, 'validation-artifact-digest-mismatch', 503);
      const report = await decodeValidationArtifact(bytes);
      if (report.prNumber !== proposal.key.number || report.headSha !== proposal.headSha) continue;
      verifyCandidateReport(report, proposal, config);
      return { report, artifactSha256, runId: Number(run.id) };
    }
    throw new Error('trusted-candidate-validation-unavailable');
  };
}
export function createGitHubTechnicalReadiness(store: CommunityStore, config: TrustedValidationConfig): TechnicalReadinessPort {
  const read = createTrustedValidationReader(config);
  return { async evidence(key, headSha): Promise<TrustedTechnicalEvidence | null> {
    const proposal = await store.getProposal(key); if (!proposal || proposal.headSha !== headSha) return null;
    const value = await read(proposal); const report = value.report;
    if (report.mechanicsValidation !== 'valid' || !proposalImplemented(report, proposal)) return null;
    const checked = ['schema-references', 'tier-budget-caps', 'equipment-catalog', 'equipment-battle', 'battle-passives'].every(name => report.mechanicsEvidence?.includes(name));
    return { repositoryId: key.repositoryId, number: key.number, headSha, rulesRevision: config.gameRulesRevision, contentApiVersion: report.gameContentApiVersion, evidenceHash: value.artifactSha256, implemented: checked, supportedKinds: checked, schemas: checked, tierBalanceAndCaps: checked, keywordSurfaces: false, fightOnOff: false, determinism: false, pairedUi: false, imageDecode: report.results.snapshot === 'valid' };
  } };
}
