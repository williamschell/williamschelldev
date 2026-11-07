// Loads the real schema.sql into PGlite (Postgres compiled to run in-process), with a small
// stand-in for what Supabase provides: the auth schema and the anon and authenticated roles.
// RLS is really enforced, because queries run under those roles.

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SUPABASE_STANDIN = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  -- Supabase keeps pgcrypto in its own schema, so the SQL names it as extensions.crypt.
  create schema extensions;
  create extension pgcrypto with schema extensions;
  grant usage on schema extensions to anon, authenticated;
`;

/** Quotes a value as a SQL literal. Test code only. */
function literal(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `'${text.replace(/'/g, "''")}'`;
}

/**
 * @param {string} depsDir the folder holding node_modules with PGlite in it
 * @param {string} schemaPath
 */
export async function createDatabase(depsDir, schemaPath) {
  const base = join(depsDir, 'node_modules/@electric-sql/pglite/dist');
  const { PGlite } = await import(pathToFileURL(join(base, 'index.js')).href);
  const { pgcrypto } = await import(pathToFileURL(join(base, 'contrib/pgcrypto.js')).href);
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STANDIN);
  await db.exec(readFileSync(schemaPath, 'utf8'));

  /** Runs a statement as a given user, or as anon with null, and always rolls back to a clean role. */
  const as = async (userId, sql) => {
    const role = userId ? 'authenticated' : 'anon';
    return db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}; select set_config('request.jwt.claim.sub', ${literal(userId ?? '')}, true);`);
      return (await tx.query(sql)).rows;
    });
  };

  return {
    db,
    as,
    literal,
    /** Runs as the database owner, which is what the dashboard does. */
    admin: async (sql) => (await db.query(sql)).rows,
    /** A device: an anonymous auth user with no account yet. */
    newUser: async () => {
      const id = randomUUID();
      await db.query(`insert into auth.users (id) values ('${id}')`);
      return id;
    },
  };
}

/** Functions that return one value, which PostgREST hands back bare. */
const SCALAR = new Set(['add_friend', 'rotate_friend_code', 'sign_in', 'change_password', 'save_list']);

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

const fakeJwt = (sub) => {
  const encode = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.test`;
};

const subFromHeader = (req) => {
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub ?? null;
  } catch {
    return null;
  }
};

/**
 * Stands in for Supabase's auth and PostgREST, for the handful of requests the app makes.
 * @param {Awaited<ReturnType<typeof createDatabase>>} database
 * @returns {(req: any, res: any, path: string, body: string) => Promise<void>}
 */
export function supabaseShim(database) {
  return async (req, res, path, body) => {
    if (path === '/auth/v1/signup') {
      const id = await database.newUser();
      const user = {
        id, aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
      };
      send(res, 200, {
        access_token: fakeJwt(id),
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: `refresh-${id}`,
        user,
      });
      return;
    }
    if (path.startsWith('/auth/v1/logout')) {
      send(res, 204);
      return;
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.slice('/rest/v1/rpc/'.length).replace(/[^a-z_]/g, '');
      const args = JSON.parse(body || '{}');
      const list = Object.entries(args).map(([k, v]) => `${k} => ${literal(v)}`).join(', ');
      try {
        const rows = await database.as(subFromHeader(req), `select * from public.${fn}(${list})`);
        if (SCALAR.has(fn)) send(res, 200, rows[0][fn]);
        else if (rows.length === 1 && Object.keys(rows[0]).join() === fn) send(res, 204);
        else send(res, 200, rows);
      } catch (err) {
        send(res, err.code === '42501' ? 403 : 400, {
          code: err.code, message: err.message, details: null, hint: null,
        });
      }
      return;
    }
    send(res, 404, { message: `shim has no ${path}` });
  };
}
