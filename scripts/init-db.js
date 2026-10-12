#!/usr/bin/env node
/**
 * 通用数据库初始化：建表 + 建平台角色 + 授权。
 *
 * 用法：
 *   node scripts/init-db.js "postgres://user:pass@host:5432/dbname"
 *
 * 适用于任何目标库（Neon / Render PostgreSQL / 自建 Postgres / Oracle VM 本地库）。
 * 需要在安装了依赖（postgres 包）的目录里运行，即项目根目录或部署包根目录。
 * 幂等，可重复执行。
 */
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const connectionString = process.argv[2];
if (!connectionString) {
  console.error('用法: node scripts/init-db.js "postgres://user:pass@host:5432/dbname"');
  process.exit(1);
}

// dollar-quote 感知的语句切分（兼容 $$ ... $$ 块）
function splitStatements(text) {
  const stmts = [];
  let cur = '';
  let inDollar = false;
  let tag = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inDollar && ch === '$') {
      const m = text.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (m) { inDollar = true; tag = m[0]; cur += tag; i += tag.length - 1; continue; }
    } else if (inDollar && text.startsWith(tag, i)) {
      inDollar = false; cur += tag; i += tag.length - 1; continue;
    }
    if (ch === ';' && !inDollar) { stmts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) stmts.push(cur);
  return stmts
    .map(s => s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').trim())
    .filter(s => s.length > 0 && !/^(BEGIN|COMMIT)$/i.test(s));
}

// 平台中间件按请求 SET LOCAL ROLE 切换的三个角色 + 授权
const ROLES_SQL = `
DO $$ BEGIN CREATE ROLE anon_ NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated_ NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role_ NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon_, authenticated_, service_role_;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon_, authenticated_, service_role_;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO anon_, authenticated_, service_role_;
`;

(async () => {
  const sql = postgres(connectionString, { connect_timeout: 15, idle_timeout: 5 });

  const schemaFile = path.join(__dirname, 'schema.sql');
  const stmts = splitStatements(fs.readFileSync(schemaFile, 'utf8'));
  console.log(`[init-db] 执行 ${stmts.length} 条建表语句 ...`);
  let ok = 0;
  for (const st of stmts) {
    try { await sql.unsafe(st); ok++; }
    catch (e) {
      const msg = String(e).split('\n')[0];
      if (/already exists/i.test(msg)) { ok++; continue; } // 幂等：已存在跳过
      console.log('  FAIL:', st.slice(0, 60).replace(/\n/g, ' '), '=>', msg.slice(0, 140));
    }
  }
  console.log(`[init-db] 建表完成 ${ok}/${stmts.length}`);

  console.log('[init-db] 创建平台角色并授权 ...');
  try {
    await sql.unsafe(ROLES_SQL);
    console.log('[init-db] 角色就绪（anon_ / authenticated_ / service_role_）');
  } catch (e) {
    console.log('[init-db] 角色创建失败:', String(e).split('\n')[0]);
    console.log('           若连接用户没有 CREATEROLE 权限（部分托管库限制），请在控制台建角色后重试。');
  }

  const tables = await sql`select table_name from information_schema.tables where table_schema='public' order by 1`;
  console.log(`[init-db] 当前表（${tables.length}）:`, tables.map(t => t.table_name).join(', '));
  await sql.end();
  console.log('[init-db] 完成');
})().catch(e => { console.error('[init-db] 致命错误:', String(e).split('\n')[0]); process.exit(1); });
