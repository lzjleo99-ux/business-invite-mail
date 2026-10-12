#!/usr/bin/env node
/**
 * 零成本数据库备份：整库数据导成 JSON（不依赖 psql/pg_dump）。
 *
 * 用法：
 *   node scripts/backup-db.js "postgres://..._ADMIN连接串" [输出目录]
 *
 * 说明：Northflank 免费层的自动备份可能产生存储费用，用这个脚本定期在你自己
 * 电脑上备份最稳妥。表结构重建用 scripts/schema.sql；需要恢复时把 JSON 给我，
 * 我写对应的导入逻辑（或先 TRUNCATE 再按 JSON 逐表插回）。
 */
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const connectionString = process.argv[2];
const outDir = process.argv[3] || path.join(__dirname, '..', 'db-backups');

if (!connectionString) {
  console.error('用法: node scripts/backup-db.js "postgres://user:pass@host:5432/db" [输出目录]');
  process.exit(1);
}

(async () => {
  const sql = postgres(connectionString, { connect_timeout: 15, idle_timeout: 5 });

  const tables = await sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by 1`;
  console.log(`[backup] ${tables.length} 张表`);

  const dump = { createdAt: new Date().toISOString(), tables: {} };
  for (const t of tables) {
    const rows = await sql.unsafe(`select * from "${t.table_name}"`);
    dump.tables[t.table_name] = rows;
    console.log(`  ${t.table_name}: ${rows.length} 行`);
  }
  await sql.end();

  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(outDir, `backup-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(dump, null, 2));
  console.log(`[backup] 完成: ${file}`);
})().catch((e) => {
  console.error('[backup] 失败:', String(e).split('\n')[0]);
  process.exit(1);
});
