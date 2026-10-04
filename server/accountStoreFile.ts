import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AccountLink, AccountRecord, AccountStore, AuthCode } from '../src/meta/account';

const DEFAULT_FILE_PATH = '.tmp/account-store.json';

interface AccountStoreFileShape {
  accounts: AccountRecord[];
  sessions: { tokenHash: string; accountId: string; createdAt: number }[];
  links: AccountLink[];
  codes: AuthCode[];
}

function emptyShape(): AccountStoreFileShape {
  return { accounts: [], sessions: [], links: [], codes: [] };
}

function loadFromDisk(filePath: string): AccountStoreFileShape {
  if (!existsSync(filePath)) return emptyShape();
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<AccountStoreFileShape>;
    return {
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      links: Array.isArray(parsed.links) ? parsed.links : [],
      codes: Array.isArray(parsed.codes) ? parsed.codes : [],
    };
  } catch {
    return emptyShape();
  }
}

export function createFileAccountStore(filePath: string = DEFAULT_FILE_PATH): AccountStore {
  const state = loadFromDisk(filePath);
  const persist = (): void => {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(state, null, 2));
  };

  return {
    async getAccount(id) {
      return state.accounts.find((account) => account.id === id) ?? null;
    },
    async createAccount(record) {
      state.accounts.push(record);
      persist();
    },
    async renameAccount(id, displayName) {
      const account = state.accounts.find((entry) => entry.id === id);
      if (account) account.displayName = displayName;
      persist();
    },
    async addSession(tokenHash, accountId, createdAt) {
      state.sessions.push({ tokenHash, accountId, createdAt });
      persist();
    },
    async accountIdForSession(tokenHash) {
      return state.sessions.find((session) => session.tokenHash === tokenHash)?.accountId ?? null;
    },
    async linksFor(accountId) {
      return state.links.filter((link) => link.accountId === accountId);
    },
    async findLink(provider, subject) {
      return state.links.find((link) => link.provider === provider && link.subject === subject) ?? null;
    },
    async addLink(link) {
      state.links.push(link);
      persist();
    },
    async putCode(code) {
      state.codes = state.codes.filter((entry) => entry.expiresAt >= code.createdAt);
      state.codes.push(code);
      persist();
    },
    async takeCode(codeHash) {
      const index = state.codes.findIndex((code) => code.codeHash === codeHash);
      if (index === -1) return null;
      const [code] = state.codes.splice(index, 1);
      persist();
      return code ?? null;
    },
    async latestCodeFor(purpose, subject) {
      let latest: AuthCode | null = null;
      for (const code of state.codes) {
        if (code.purpose === purpose && code.subject === subject && (latest === null || code.createdAt > latest.createdAt)) latest = code;
      }
      return latest;
    },
  };
}
