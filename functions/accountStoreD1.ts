import type { AccountLink, AccountProvider, AccountRecord, AccountStore, AuthCode, AuthCodePurpose } from '../src/meta/account';
import type { D1Database } from './d1';

interface AccountRow { id: string; display_name: string; created_at: number }
interface LinkRow { provider: AccountProvider; subject: string; account_id: string; created_at: number }
interface CodeRow {
  code_hash: string;
  purpose: AuthCodePurpose;
  account_id: string | null;
  subject: string | null;
  return_to: string | null;
  created_at: number;
  expires_at: number;
}

function toLink(row: LinkRow): AccountLink {
  return { provider: row.provider, subject: row.subject, accountId: row.account_id, createdAt: row.created_at };
}

function toCode(row: CodeRow): AuthCode {
  return {
    codeHash: row.code_hash,
    purpose: row.purpose,
    accountId: row.account_id,
    subject: row.subject,
    returnTo: row.return_to,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export function createD1AccountStore(db: D1Database): AccountStore {
  return {
    async getAccount(id) {
      const row = await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first<AccountRow>();
      return row === null ? null : { id: row.id, displayName: row.display_name, createdAt: row.created_at } satisfies AccountRecord;
    },
    async createAccount(record) {
      await db.prepare('INSERT INTO accounts (id, display_name, created_at) VALUES (?, ?, ?)')
        .bind(record.id, record.displayName, record.createdAt).run();
    },
    async renameAccount(id, displayName) {
      await db.prepare('UPDATE accounts SET display_name = ? WHERE id = ?').bind(displayName, id).run();
    },
    async addSession(tokenHash, accountId, createdAt) {
      await db.prepare('INSERT INTO account_sessions (token_hash, account_id, created_at) VALUES (?, ?, ?)')
        .bind(tokenHash, accountId, createdAt).run();
    },
    async accountIdForSession(tokenHash) {
      return db.prepare('SELECT account_id FROM account_sessions WHERE token_hash = ?').bind(tokenHash).first<string>('account_id');
    },
    async linksFor(accountId) {
      const rows = await db.prepare('SELECT * FROM account_links WHERE account_id = ? ORDER BY created_at ASC')
        .bind(accountId).all<LinkRow>();
      return (rows.results ?? []).map(toLink);
    },
    async findLink(provider, subject) {
      const row = await db.prepare('SELECT * FROM account_links WHERE provider = ? AND subject = ?')
        .bind(provider, subject).first<LinkRow>();
      return row === null ? null : toLink(row);
    },
    async addLink(link) {
      await db.prepare('INSERT INTO account_links (provider, subject, account_id, created_at) VALUES (?, ?, ?, ?)')
        .bind(link.provider, link.subject, link.accountId, link.createdAt).run();
    },
    async putCode(code) {
      await db.batch([
        db.prepare('DELETE FROM auth_codes WHERE expires_at < ?').bind(code.createdAt),
        db.prepare(
          'INSERT INTO auth_codes (code_hash, purpose, account_id, subject, return_to, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).bind(code.codeHash, code.purpose, code.accountId, code.subject, code.returnTo, code.createdAt, code.expiresAt),
      ]);
    },
    async takeCode(codeHash) {
      const row = await db.prepare('SELECT * FROM auth_codes WHERE code_hash = ?').bind(codeHash).first<CodeRow>();
      if (row === null) return null;
      const deleted = await db.prepare('DELETE FROM auth_codes WHERE code_hash = ?').bind(codeHash).run();
      return deleted.meta.changes === 0 ? null : toCode(row);
    },
    async latestCodeFor(purpose, subject) {
      const row = await db.prepare(
        'SELECT * FROM auth_codes WHERE purpose = ? AND subject = ? ORDER BY created_at DESC LIMIT 1',
      ).bind(purpose, subject).first<CodeRow>();
      return row === null ? null : toCode(row);
    },
  };
}
