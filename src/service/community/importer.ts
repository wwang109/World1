import type { ProposalKey, ProposalSnapshot } from '../../community/types';
import { parseCommunityJson, requireCommunity, validateProposalManifest } from '../../community/validate';
import type { CommunityStore, StoredAsset } from './store';
import type { GitHubReadPort } from './github';
export function inspectRaster(bytes: Uint8Array): { contentType: string; width: number; height: number } {
  requireCommunity(bytes.length > 24 && bytes.length <= 8 * 1024 * 1024, 'invalid-preview-size');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0; let height = 0; let contentType = '';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) && new TextDecoder().decode(bytes.slice(12, 16)) === 'IHDR') {
    width = view.getUint32(16); height = view.getUint32(20); contentType = 'image/png';
  } else if (new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') {
    requireCommunity(view.getUint32(4, true) + 8 === bytes.length, 'invalid-webp');
    const kind = new TextDecoder().decode(bytes.slice(12, 16));
    if (kind === 'VP8X') { requireCommunity(bytes.length >= 30 && (bytes[20]! & 2) === 0, 'animated-preview-not-supported'); width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16); height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16); }
    else if (kind === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) { width = view.getUint16(26, true) & 16383; height = view.getUint16(28, true) & 16383; }
    else if (kind === 'VP8L' && bytes[20] === 47) { const bits = view.getUint32(21, true); width = 1 + (bits & 16383); height = 1 + ((bits >>> 14) & 16383); }
    contentType = 'image/webp';
  }
  requireCommunity(width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 32_000_000, 'invalid-preview-dimensions');
  return { width, height, contentType };
}
export function createProposalImporter(deps: { github: GitHubReadPort; store: CommunityStore; now: () => number; sha256: (bytes: Uint8Array) => Promise<string> }) {
  async function importProposal(key: ProposalKey): Promise<ProposalSnapshot> {
    const pr = await deps.github.readPr(key);
    const previous = await deps.store.getProposal(key);
    requireCommunity(!previous?.mergedCommitSha || pr.mergedCommitSha === previous.mergedCommitSha, 'source-merge-regression', 409);
    if (previous && previous.headSha === pr.headSha && previous.manifestPath === pr.manifestPath) return deps.store.importProposal({ ...previous, baseSha: pr.baseSha, sourceState: pr.state, mergedCommitSha: pr.mergedCommitSha, sourceCheckedAt: deps.now() }, []);
    const manifestFiles = await deps.github.readFilesAtSha(key, pr.headSha, [pr.manifestPath]);
    const manifestFile = manifestFiles[0];
    requireCommunity(manifestFile && manifestFile.mode === '100644' && manifestFile.bytes.byteLength <= 256 * 1024, 'invalid-manifest-file');
    const manifest = validateProposalManifest(parseCommunityJson(new TextDecoder('utf-8', { fatal: true }).decode(manifestFile.bytes)));
    const files = await deps.github.readFilesAtSha(key, pr.headSha, [...manifest.previewPaths, ...manifest.contentPaths]);
    requireCommunity(files.length === manifest.previewPaths.length + manifest.contentPaths.length, 'missing-source-files');
    const assets: StoredAsset[] = [];
    for (const path of manifest.previewPaths) {
      const file = files.find(file => file.path === path);
      requireCommunity(file && file.mode === '100644', 'missing-preview');
      const image = inspectRaster(file.bytes);
      assets.push({ key, headSha: pr.headSha, path, hash: await deps.sha256(file.bytes), contentType: image.contentType, width: image.width, height: image.height });
    }
    for (const path of manifest.contentPaths) {
      const file = files.find(file => file.path === path);
      const canonical = path === 'art-manifest.v1.json' || /^src\/data\/content\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.json$/.test(path);
      requireCommunity(file && file.mode === '100644' && file.bytes.length <= (canonical ? 8 * 1024 * 1024 : 256 * 1024) && path.endsWith('.json'), 'invalid-content-file');
      parseCommunityJson(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes));
    }
    const confirmed = await deps.github.readPr(key);
    requireCommunity(confirmed.headSha === pr.headSha && confirmed.state === pr.state && confirmed.baseSha === pr.baseSha && confirmed.mergedCommitSha === pr.mergedCommitSha, 'github-revision-changed', 409);
    const now = deps.now();
    return deps.store.importProposal({ key, headSha: pr.headSha, baseSha: pr.baseSha, manifest, manifestPath: pr.manifestPath, manifestSha256: await deps.sha256(manifestFile.bytes), moderationRevision: 0, state: pr.mergedCommitSha ? 'merged' : pr.state === 'closed' ? 'withdrawn' : 'pending_review', sourceState: pr.state, sourceUrl: pr.url, sourceCheckedAt: now, importedAt: now, mergedCommitSha: pr.mergedCommitSha, reviewedHeadSha: null, technical: null, validation: 'needs_review', supportTotal: 0 }, assets);
  }
  return {
    importProposal,
    async reconcileProposals(cursor: string | null): Promise<{ nextCursor: string | null; updated: number; failed: number }> {
      const page = await deps.github.listChangedPrs(cursor); let updated = 0; let failed = 0;
      for (const key of page.keys) { try { await importProposal(key); updated++; } catch { failed++; } }
      return { nextCursor: page.nextCursor, updated, failed };
    },
  };
}
