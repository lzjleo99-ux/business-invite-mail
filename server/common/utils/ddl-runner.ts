/**
 * 拿一个"绕开角色切换"的 DDL 执行器（供启动期幂等迁移使用）。
 *
 * 为什么不能直接用 drizzle 实例跑 DDL：请求上下文里 datapaas 会把每条
 * drizzle 查询包进 `SET LOCAL ROLE anon_/authenticated_/service_role_` 的事务，
 * 这些角色只有 DML 权限，CREATE TABLE / ALTER TABLE / GRANT 直接失败。
 *
 * 按可靠度依次尝试：
 * 1. `db.$client` —— drizzle(postgres-js) 构造时写入的底层客户端（datapaas 给
 *    postgres 客户端套的 Proxy 会正常透出 unsafe，且不经过 drizzle 的被 patch 路径）；
 * 2. `db.session.client` —— 同一个客户端的另一个持有点；
 * 3. 兜底：用 SUDA_DATABASE_URL 建一次性独立连接（与 init-db.js 同语义，
 *    连接用户就是 schema owner），用完 dispose 即关。
 */
export interface DdlRunner {
  run: (q: string) => Promise<unknown>;
  dispose: () => Promise<void>;
  via: string;
}

export async function getDdlRunner(
  db: unknown,
  contextLabel: string,
): Promise<DdlRunner> {
  type RawClient = { unsafe?: unknown };
  const record = db as Record<string, unknown> | null;
  const diagnostics: string[] = [];

  if (record) {
    const candidates: Array<[string, unknown]> = [
      ['$client', record['$client']],
      ['session.client', (record['session'] as { client?: unknown } | undefined)?.client],
    ];
    for (const [name, candidate] of candidates) {
      const raw = candidate as RawClient | undefined;
      diagnostics.push(`${name}:${raw ? (typeof raw.unsafe === 'function' ? 'unsafe✓' : `unsafe✗(${typeof raw.unsafe})`) : 'absent'}`);
      if (raw && typeof raw.unsafe === 'function') {
        const runner = raw as { unsafe: (q: string) => Promise<unknown> };
        return {
          run: (q) => runner.unsafe(q),
          dispose: async () => {},
          via: name,
        };
      }
    }
  } else {
    diagnostics.push('db:null');
  }

  // 兜底：独立连接
  const connectionString = process.env.SUDA_DATABASE_URL;
  diagnostics.push(`SUDA_DATABASE_URL:${connectionString ? 'set' : 'missing'}`);
  if (connectionString) {
    // postgres 是 @lark-apaas/nestjs-datapaas 的传递依赖，不在 package.json
    // 直接依赖里（沙箱与 CI 均无法 npm i 补声明），沿用 tesseract 的 require 先例。
    // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-extraneous-dependencies
    const postgres = require('postgres') as typeof import('postgres');
    const client = postgres(connectionString, { connect_timeout: 15, idle_timeout: 5, max: 1 });
    return {
      run: (q) => client.unsafe(q),
      dispose: () => client.end(),
      via: 'dedicated-connection',
    };
  }

  throw new Error(
    `${contextLabel} 无法获取 DDL 执行器 [${diagnostics.join(', ')}]；`
    + '请手动执行 node scripts/init-db.js "<SUDA_DATABASE_URL>" 后重试',
  );
}

/** 跑一次幂等迁移：拿 runner → 执行 → 必关连接；失败信息带上下文。 */
export async function runIdempotentMigration(
  db: unknown,
  contextLabel: string,
  migrate: (run: (q: string) => Promise<unknown>) => Promise<void>,
): Promise<string> {
  const runner = await getDdlRunner(db, contextLabel);
  try {
    await migrate(runner.run);
    return runner.via;
  } finally {
    await runner.dispose();
  }
}
