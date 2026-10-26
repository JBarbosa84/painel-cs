// Carrega o histórico inicial (exportado do painel no claude.ai) na tabela "cs".
// Uso: TABLES_CONNECTION="..." ADMIN_EMAIL="..." node deploy/seed.js
const { TableClient } = require("../api/node_modules/@azure/data-tables");
const seed = require("./seed.json");
const t = TableClient.fromConnectionString(process.env.TABLES_CONNECTION, "painelcs");
(async () => {
  await t.createTable().catch(() => {});
  const put = (pk, rk, obj) => t.upsertEntity({ partitionKey: pk, rowKey: rk, d: JSON.stringify(obj) }, "Replace");
  const cfg = { ...seed.config, admins: String(process.env.ADMIN_EMAIL || "").toLowerCase().split(/[\s,;]+/).filter(Boolean) };
  await put("config", "geral", cfg);
  for (const [id, l] of Object.entries(seed.lideres)) await put("lider", id, l);
  for (const [id, u] of Object.entries(seed.unidades)) await put("unidade", id, u);
  let n = 0;
  for (const [uid, a] of Object.entries(seed.aval)) for (const [mm, m] of Object.entries(a.meses)) { await put(`av-${a.ano}`, `${uid}__${mm}`, m); n++; }
  console.log(`Carregados: ${Object.keys(seed.unidades).length} unidades, ${Object.keys(seed.lideres).length} líderes, ${n} meses avaliados. Diretoria: ${cfg.admins.join(", ")}`);
})().catch((e) => { console.error(e); process.exit(1); });
