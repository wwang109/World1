import { parseCommunityJson, requireCommunity } from '../src/community/validate';
import type { D1Database, D1PreparedStatement, D1Result } from '../functions/d1';
export async function createRemoteCommunityD1(options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch; readOnly?: boolean } = {}): Promise<D1Database> {
  const env = options.env ?? process.env, transport = options.fetch ?? fetch;
  const account = env.CLOUDFLARE_ACCOUNT_ID, database = env.D1_DATABASE_ID, token = env.CLOUDFLARE_API_TOKEN;
  requireCommunity(account && /^[a-f0-9]{32}$/.test(account) && database && /^[a-f0-9-]{36}$/.test(database) && token, 'explicit-remote-D1-target-and-token-required');
  const prefix = `https://api.cloudflare.com/client/v4/accounts/${account}`;
  const request = async (path: string, body?: unknown): Promise<any> => {
    const response = await transport(`${prefix}/${path}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    requireCommunity(response.ok && response.body, `remote-D1-http-${response.status}`);
    const reader = response.body!.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.length; requireCommunity(size <= 4 * 1024 * 1024, 'remote-D1-response-too-large'); chunks.push(item.value); } } finally { await reader.cancel(); }
    const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    const result = parseCommunityJson(new TextDecoder().decode(bytes)) as any; requireCommunity(result.success === true, 'remote-D1-API-failed'); return result.result;
  };
  requireCommunity((await request(`d1/database/${database}`)).uuid === database, 'remote-D1-target-identity-mismatch');
  const project = await request('pages/projects/proof-of-concept-ab-deckbuilder');
  requireCommunity(project.name === 'proof-of-concept-ab-deckbuilder' && project.deployment_configs?.production?.d1_databases?.GHOSTS_DB?.id === database, 'remote-D1-production-project-binding-mismatch');
  const definitions = new WeakMap<D1PreparedStatement, { sql: string; params: unknown[] }>();
  const execute = async (statements: D1PreparedStatement[], batch: boolean): Promise<D1Result<any>[]> => {
    requireCommunity(statements.length > 0 && statements.length <= 100, 'remote-D1-batch-size');
    const queries = statements.map(statement => { const value = definitions.get(statement); requireCommunity(value, 'foreign-remote-D1-statement'); requireCommunity(!options.readOnly || /^\s*SELECT\b/i.test(value.sql), 'remote-D1-read-only-mode'); return value; });
    const results = await request(`d1/database/${database}/query`, batch ? { batch: queries } : queries[0]);
    requireCommunity(Array.isArray(results) && results.length === queries.length && results.every(row => row.success === true && row.meta && Array.isArray(row.results)), 'remote-D1-batch-unconfirmed'); return results;
  };
  const prepare = (sql: string, params: unknown[] = []): D1PreparedStatement => {
    const statement: D1PreparedStatement = {
      bind(...values) { return prepare(sql, values); },
      async first<T>(column?: string) { const row = (await execute([statement], false))[0]!.results?.[0]; return (row ? column ? row[column] : row : null) as T | null; },
      async all<T>() { return (await execute([statement], false))[0] as D1Result<T>; },
      async run<T>() { return (await execute([statement], false))[0] as D1Result<T>; },
    }; definitions.set(statement, { sql, params }); return statement;
  };
  return { prepare, async batch<T>(statements: D1PreparedStatement[]) { return await execute(statements, true) as D1Result<T>[]; } };
}
