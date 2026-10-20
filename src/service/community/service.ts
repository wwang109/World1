import { COMMUNITY_BODY_MAX_BYTES, contributionUrl, type ApiReply, type CommunityRequest, type ModerationInput, type ProposalKey } from '../../community/types';
import { CommunityError, boundedText, pageOffset, pageSize, parseCommunityJson, record, requireCommunity, validateOperationId, validateProposalKey, validateSha } from '../../community/validate';
import type { AccountRecord } from '../../meta/account';
import type { CommunityStore } from './store';
import type { GitHubReadPort } from './github';
import { proposalKeyFromUrl } from './github';
import { createProposalImporter, inspectRaster } from './importer';
import { createSupportService } from './support';
import { technicalAttestation, type HumanTechnicalEvidence, type TechnicalReadinessPort } from './technicalReadiness';
import runtimeManifest from '../../../content-manifest.v1.json';
import currentExecutor from '../runs/generated/current.json';
import { CONTENT_SHA, RULES_REVISION, CONTENT_API_VERSION } from '../../data/contentBuild';
export interface CommunityServiceDeps {
  store: CommunityStore;
  github: GitHubReadPort | null;
  repositoryId: string | null;
  authenticate: (authorization: string | null) => Promise<AccountRecord | null>;
  linkedProvider: (accountId: string) => Promise<boolean>;
  moderators: readonly string[];
  now: () => number;
  hash: (value: string) => Promise<string>;
  hashBytes: (value: Uint8Array) => Promise<string>;
  randomId: () => string;
  rulesRevision: string;
  contentApiVersion: number;
  readiness: TechnicalReadinessPort | null;
  pointsEnabled: boolean;
}
export function createCommunityService(deps: CommunityServiceDeps) {
  const importer = deps.github ? createProposalImporter({ github: deps.github, store: deps.store, now: deps.now, sha256: deps.hashBytes }) : null;
  const spendSupport = createSupportService(deps);
  const publicProposal = (value: Awaited<ReturnType<CommunityStore['getProposal']>>) => {
    if (!value) return value;
    const { technical, ...publicFields } = value;
    if (!technical) return { ...publicFields, technical: null };
    const { reviewerId: _reviewerId, ...publicTechnical } = technical;
    return { ...publicFields, technical: publicTechnical };
  };
  const keyFor = (number: number): ProposalKey => {
    requireCommunity(deps.repositoryId, 'community-source-unconfigured', 503);
    return validateProposalKey({ repositoryId: deps.repositoryId, number });
  };
  return {
    async handle(request: CommunityRequest): Promise<ApiReply<unknown>> {
      try {
        requireCommunity(new TextEncoder().encode(request.body).length <= COMMUNITY_BODY_MAX_BYTES, 'body-too-large', 413);
        const method = request.method; const path = request.path.replace(/\/$/, '');
        if (method === 'GET' && path === '/community/runtime') return { status: 200, body: { contentSha: CONTENT_SHA, rulesRevision: RULES_REVISION, contentApiVersion: CONTENT_API_VERSION, executor: currentExecutor, runtimeFiles: Object.fromEntries(runtimeManifest.files.map(file => [file.path, file.sha256])) } };
        const roundDetail = /^\/community\/rounds\/([^/]{1,200})$/.exec(path);
        if (method === 'GET' && roundDetail) {
          let id: string; try { id = decodeURIComponent(roundDetail[1]!); } catch { throw new CommunityError(400, 'invalid-round'); }
          requireCommunity(/^[A-Za-z0-9:_-]{1,100}$/.test(id), 'invalid-round');
          const round = await deps.store.getRound(id); requireCommunity(round, 'round-not-found', 404);
          return { status: 200, body: { round } };
        }
        const offset = pageOffset(request.url.searchParams.get('cursor')); const limit = pageSize(request.url.searchParams.get('limit'));
        if (method === 'GET' && (path === '/community/proposals' || path === '/community')) {
          const sort = request.url.searchParams.get('sort') ?? 'supported'; requireCommunity(sort === 'supported' || sort === 'newest', 'invalid-sort');
          const proposals = await deps.store.listProposals(offset, limit, sort);
          const synchronization = await deps.store.sourceSync();
          return { status: 200, body: { proposals: proposals.map(publicProposal), nextCursor: proposals.length === limit ? String(offset + limit) : null, contributionUrl: contributionUrl(), sourceAvailable: Boolean(deps.github), sourceSync: { lastSuccessAt: synchronization.lastSuccessAt, lastAttemptAt: synchronization.lastAttemptAt, nextPollAt: synchronization.nextPollAt, error: synchronization.lastError }, pointsEnabled: deps.pointsEnabled, round: await deps.store.ensureRound(deps.now()), checkedAt: deps.now(), staleAfterMs: 5 * 60_000 } };
        }
        const detail = /^\/community\/proposals\/([1-9]\d*)$/.exec(path);
        if (method === 'GET' && detail) { const proposal = await deps.store.getProposal(keyFor(Number(detail[1]))); requireCommunity(proposal, 'proposal-not-found', 404); return { status: 200, body: { proposal: publicProposal(proposal), checkedAt: deps.now(), staleAfterMs: 5 * 60_000 } }; }
        if (method !== 'POST' && !(method === 'GET' && path === '/community/me')) return { status: 404, body: { error: 'community-route-not-found' } };
        const account = await deps.authenticate(request.authorization); requireCommunity(account, 'missing-account', 401);
        if (method === 'GET' && path === '/community/me') {
          const canModerate = deps.moderators.includes(account.id) && await deps.linkedProvider(account.id);
          return { status: 200, body: { wallet: await deps.store.wallet(account.id), entries: await deps.store.ledger(account.id, offset, limit), pointsEnabled: deps.pointsEnabled, canModerate, moderation: { canReview: canModerate, canCorrectPoints: canModerate, technicalValidationConfigured: canModerate && Boolean(deps.readiness), reviewEndpoint: '/community/moderation/review', decisions: ['open', 'accepted', 'declined'], evidenceFields: ['fightOnOff', 'determinism', 'pairedUi', 'keywordSurfaces'], noteMaxLength: 4000, evidenceMinLength: 20, evidenceMaxLength: 2000, bodyMaxBytes: COMMUNITY_BODY_MAX_BYTES } } };
        }
        const input = record(parseCommunityJson(request.body || '{}'));
        if (path === '/community/import') {
          requireCommunity(importer && deps.repositoryId, 'github-source-unavailable', 503);
          return { status: 200, body: { proposal: publicProposal(await importer.importProposal(proposalKeyFromUrl(input.url, deps.repositoryId))) } };
        }
        if (path === '/community/reconcile' || path.startsWith('/community/moderation/')) {
          requireCommunity(deps.moderators.includes(account.id) && await deps.linkedProvider(account.id), 'moderator-required', 403);
          if (path === '/community/reconcile') { requireCommunity(importer, 'github-source-unavailable', 503); return { status: 200, body: await importer.reconcileProposals(typeof input.cursor === 'string' ? input.cursor : null) }; }
          if (path === '/community/moderation/correction') {
            const correction = { accountId: boundedText(input.accountId, 64), delta: input.delta as number, operationId: validateOperationId(input.operationId), reason: boundedText(input.reason, 1000) };
            requireCommunity(/^[a-f0-9]{32}$/.test(correction.accountId), 'invalid-account');
            return { status: 200, body: await deps.store.correctPoints(correction, account.id, await deps.hash(JSON.stringify({ ...correction, moderatorId: account.id })), deps.randomId(), deps.now()) };
          }
          requireCommunity(path === '/community/moderation/review', 'community-route-not-found', 404);
          const key = keyFor(Number(input.number));
          const headSha = validateSha(input.headSha); const operationId = validateOperationId(input.operationId);
          requireCommunity(Number.isSafeInteger(input.expectedRevision) && Number(input.expectedRevision) >= 0 && ['open', 'accepted', 'declined'].includes(String(input.decision)), 'invalid-review');
          requireCommunity(deps.github, 'github-source-unavailable', 503);
          const current = await deps.github.readPr(key); requireCommunity(current.headSha === headSha && current.state === 'open', 'proposal-changed', 409);
          const moderation: ModerationInput = { key, headSha, operationId, expectedRevision: Number(input.expectedRevision), decision: input.decision as ModerationInput['decision'], note: typeof input.note === 'string' && input.note === '' ? '' : boundedText(input.note, 4000) };
          const now = deps.now();
          if (input.technicalReady === true) {
            const rawEvidence = record(input.technicalEvidence);
            const human: HumanTechnicalEvidence = { fightOnOff: boundedText(rawEvidence.fightOnOff, 2000), determinism: boundedText(rawEvidence.determinism, 2000), pairedUi: boundedText(rawEvidence.pairedUi, 2000), keywordSurfaces: boundedText(rawEvidence.keywordSurfaces, 2000) };
            moderation.technical = await technicalAttestation(deps.readiness, key, headSha, deps.rulesRevision, deps.contentApiVersion, account.id, now, human, deps.hash);
            moderation.note = JSON.stringify({ note: moderation.note, technicalEvidence: human });
          }
          const payloadHash = await deps.hash(JSON.stringify({ ...moderation, technical: moderation.technical ? { headSha: moderation.technical.headSha, rulesRevision: moderation.technical.rulesRevision, contentApiVersion: moderation.technical.contentApiVersion, evidenceHash: moderation.technical.evidenceHash } : null }));
          return { status: 200, body: await deps.store.moderate({ accountId: account.id, input: moderation, payloadHash, now }) };
        }
        const support = /^\/community\/proposals\/([1-9]\d*)\/support$/.exec(path);
        if (support) {
          requireCommunity(deps.pointsEnabled, 'points-unavailable', 503);
          const key = keyFor(Number(support[1]));
          return { status: 200, body: await spendSupport(account.id, { key, expectedHeadSha: validateSha(input.expectedHeadSha), moderationRevision: Number(input.moderationRevision), roundId: String(input.roundId), amount: input.amount as number, operationId: validateOperationId(input.operationId) }) };
        }
        return { status: 404, body: { error: 'community-route-not-found' } };
      } catch (error) {
        return { status: error instanceof CommunityError ? error.status : error instanceof SyntaxError ? 400 : 503, body: { error: error instanceof CommunityError ? error.message : error instanceof SyntaxError ? 'invalid-json' : 'community-unavailable' } };
      }
    },
    async asset(number: number, headSha: string, path: string) {
      const key = keyFor(number); const proposal = await deps.store.getProposal(key);
      requireCommunity(proposal?.headSha === headSha && proposal.manifest.previewPaths.includes(path), 'preview-not-found', 404);
      const asset = await deps.store.getAsset(key, validateSha(headSha), path); requireCommunity(asset && deps.github, 'preview-source-unavailable', 503);
      const files = await deps.github.readFilesAtSha(key, headSha, [path]); const file = files[0]; requireCommunity(file && file.mode === '100644' && await deps.hashBytes(file.bytes) === asset.hash, 'preview-source-mismatch', 503);
      const image = inspectRaster(file.bytes); requireCommunity(image.width === asset.width && image.height === asset.height && image.contentType === asset.contentType, 'preview-source-mismatch', 503);
      return { ...asset, bytes: file.bytes };
    },
  };
}
