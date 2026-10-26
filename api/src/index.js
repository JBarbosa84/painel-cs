"use strict";
/*
 * API do Painel CS Elevalife (Azure Functions, modelo Node v4).
 * - Valida o token do Microsoft Entra ID (login Microsoft da Elevalife).
 * - Diretoria = e-mails em config.admins. Líder = e-mail cadastrado em lideres.
 * - O líder só lê e grava as unidades da própria carteira, e só em meses abertos.
 * Dados no Azure Table Storage, tabela "cs":
 *   PK "unidade" | "lider" | "config"  RK = id
 *   PK "av-<ano>"                      RK = <unidadeId>__<mm>
 */
const { app } = require("@azure/functions");
const { TableClient } = require("@azure/data-tables");
const { createRemoteJWKSet, jwtVerify } = require("jose");

const TENANT = process.env.TENANT_ID;
const CLIENT = process.env.CLIENT_ID;
const JWKS = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`));
const tabela = TableClient.fromConnectionString(process.env.TABLES_CONNECTION, "painelcs");
const LINHAS = ["Ergo", "Fisio", "Quiro", "AF", "Enfermagem/Med"];
const CONFIG_PADRAO = { diaFechamento: 10, faixaOk: 85, faixaAtencao: 70, reabertos: [], admins: [] };

class ErroHttp extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const pad = (n) => String(n).padStart(2, "0");
const txt = (v, max = 1000) => (v == null ? "" : String(v).slice(0, max));

/* ---------- autenticação ---------- */
async function usuario(req) {
  const m = (req.headers.get("authorization") || "").match(/^Bearer (.+)$/i);
  if (!m) throw new ErroHttp(401, "Faça login com sua conta Microsoft.");
  try {
    const { payload } = await jwtVerify(m[1], JWKS, { issuer: `https://login.microsoftonline.com/${TENANT}/v2.0`, audience: CLIENT });
    const email = String(payload.preferred_username || payload.upn || payload.email || "").toLowerCase();
    if (!email) throw new Error("sem e-mail");
    return { email, nome: payload.name || email };
  } catch (e) {
    throw new ErroHttp(401, "Sessão expirada ou inválida. Entre de novo.");
  }
}

/* ---------- tabela ---------- */
async function listar(pk) {
  const out = {};
  for await (const e of tabela.listEntities({ queryOptions: { filter: `PartitionKey eq '${pk}'` } })) out[e.rowKey] = JSON.parse(e.d || "{}");
  return out;
}
async function ler(pk, rk) {
  try { const e = await tabela.getEntity(pk, rk); return JSON.parse(e.d || "{}"); }
  catch (e) { if (e.statusCode === 404) return null; throw e; }
}
async function gravar(pk, rk, obj) {
  const d = JSON.stringify(obj);
  if (d.length > 30000) throw new ErroHttp(413, "Registro grande demais. Encurte as observações.");
  await tabela.upsertEntity({ partitionKey: pk, rowKey: rk, d }, "Replace");
}
const validoId = (id) => typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,179}$/.test(id);

async function contexto(req) {
  const eu = await usuario(req);
  const config = { ...CONFIG_PADRAO, ...((await ler("config", "geral")) || {}) };
  const lideres = await listar("lider");
  const admin = (config.admins || []).map((x) => String(x).toLowerCase()).includes(eu.email);
  const liderId = Object.keys(lideres).find((k) => lideres[k].ativo !== false && String(lideres[k].email || "").toLowerCase() === eu.email) || null;
  return { eu: { ...eu, admin, liderId }, config, lideres };
}
function exigeAdmin(ctx) { if (!ctx.eu.admin) throw new ErroHttp(403, "Somente a diretoria pode fazer essa alteração."); }

function fechado(config, ano, mes) {
  if ((config.reabertos || []).includes(`${ano}-${pad(mes)}`)) return false;
  const lim = new Date(Date.UTC(ano, mes, Number(config.diaFechamento) || 10, 23 + 3, 59, 59)); // 23:59 em Brasília
  return Date.now() > lim.getTime();
}
function futuro(ano, mes) { const h = new Date(); return ano * 12 + mes > h.getUTCFullYear() * 12 + h.getUTCMonth() + 1; }

/* ---------- respostas ---------- */
function rota(nome, metodos, fn) {
  app.http(nome, {
    methods: metodos, authLevel: "anonymous", route: nome,
    handler: async (req, inv) => {
      try { return { status: 200, jsonBody: await fn(req, inv) }; }
      catch (e) {
        if (!(e instanceof ErroHttp)) inv.error(e);
        return { status: e.status || 500, jsonBody: { erro: e instanceof ErroHttp ? e.message : "Erro interno. Tente de novo em instantes." } };
      }
    },
  });
}
async function corpo(req) { try { return await req.json(); } catch (e) { throw new ErroHttp(400, "Requisição inválida."); } }

/* ---------- GET estado ---------- */
rota("estado", ["GET"], async (req) => {
  const ctx = await contexto(req);
  const ano = Number(req.query.get("ano")) || new Date().getFullYear();
  const { eu, config, lideres } = ctx;
  const cfgPublica = { diaFechamento: config.diaFechamento, faixaOk: config.faixaOk, faixaAtencao: config.faixaAtencao, reabertos: config.reabertos || [] };
  if (!eu.admin && !eu.liderId) return { eu, config: cfgPublica, unidades: {}, lideres: {}, aval: {} };
  let unidades = await listar("unidade");
  if (!eu.admin) unidades = Object.fromEntries(Object.entries(unidades).filter(([, u]) => u.liderId === eu.liderId));
  const aval = {};
  for await (const e of tabela.listEntities({ queryOptions: { filter: `PartitionKey eq 'av-${ano}'` } })) {
    const [uid, mm] = e.rowKey.split("__");
    if (!unidades[uid]) continue;
    (aval[uid] = aval[uid] || { meses: {} }).meses[mm] = JSON.parse(e.d || "{}");
  }
  return {
    eu,
    config: eu.admin ? config : cfgPublica,
    unidades,
    lideres: eu.admin ? lideres : { [eu.liderId]: lideres[eu.liderId] },
    aval,
  };
});

/* ---------- PUT avaliação do mês ---------- */
function limparMes(d, anterior) {
  const nivel = (v, ok) => (ok.includes(v) ? v : null);
  const data = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const out = {
    objetivo: { nivel: nivel(d.objetivo && d.objetivo.nivel, [100, 75, 50, 0]), obs: txt(d.objetivo && d.objetivo.obs) },
    relatorio: { data: data(d.relatorio && d.relatorio.data), naoEntregue: !!(d.relatorio && d.relatorio.naoEntregue), obs: txt(d.relatorio && d.relatorio.obs) },
    visitas: (Array.isArray(d.visitas) ? d.visitas : []).slice(0, 40).filter((v) => data(v.data)).map((v) => ({ data: v.data, comGestor: !!v.comGestor, obs: txt(v.obs, 500) })),
    contatos: (Array.isArray(d.contatos) ? d.contatos : []).slice(0, 60).filter((v) => data(v.data)).map((v) => ({ data: v.data, canal: v.canal === "informal" ? "informal" : "reuniao", obs: txt(v.obs, 500) })),
    nota: typeof d.nota === "number" ? Math.max(0, Math.min(100, d.nota)) : null,
    notas: d.notas && typeof d.notas === "object" ? Object.fromEntries(["obj", "rel", "vis", "ctt"].map((k) => [k, [100, 75, 50, 0, "NA", null].includes(d.notas[k]) ? d.notas[k] : null])) : null,
  };
  if (anterior && anterior.importado) out.importado = anterior.importado;
  return out;
}
rota("avaliacao", ["PUT", "POST"], async (req) => {
  const ctx = await contexto(req);
  const b = await corpo(req);
  const ano = Number(b.ano), mes = Number(b.mes);
  if (!validoId(b.unidadeId) || !(ano >= 2020 && ano <= 2100) || !(mes >= 1 && mes <= 12)) throw new ErroHttp(400, "Unidade ou mês inválido.");
  const u = await ler("unidade", b.unidadeId);
  if (!u) throw new ErroHttp(404, "Unidade não encontrada.");
  if (futuro(ano, mes)) throw new ErroHttp(400, "Esse mês ainda não começou.");
  if (!ctx.eu.admin) {
    if (u.liderId !== ctx.eu.liderId) throw new ErroHttp(403, "Essa unidade não está na sua carteira.");
    if (fechado(ctx.config, ano, mes)) throw new ErroHttp(403, "Mês fechado. Peça à diretoria para reabrir.");
  }
  const rk = `${b.unidadeId}__${pad(mes)}`;
  const anterior = await ler(`av-${ano}`, rk);
  const novo = limparMes(b.dados || {}, anterior);
  novo.atualizadoPor = ctx.eu.email; novo.atualizadoPorNome = ctx.eu.nome; novo.atualizadoEm = new Date().toISOString();
  await gravar(`av-${ano}`, rk, novo);
  return { mes: novo };
});

/* ---------- PUT cadastro (diretoria) ---------- */
rota("unidade", ["PUT", "POST"], async (req) => {
  const ctx = await contexto(req); exigeAdmin(ctx);
  const b = await corpo(req); const d = b.dados || {};
  if (!validoId(b.id)) throw new ErroHttp(400, "Identificador inválido.");
  if (b.novo && (await ler("unidade", b.id))) throw new ErroHttp(409, "Já existe essa unidade nessa linha de serviço.");
  if (!txt(d.cliente).trim() || !txt(d.unidade).trim()) throw new ErroHttp(400, "Preencha cliente e unidade.");
  if (!LINHAS.includes(d.linha)) throw new ErroHttp(400, "Linha de serviço inválida.");
  if (d.liderId && !ctx.lideres[d.liderId]) throw new ErroHttp(400, "Líder não encontrado.");
  const u = {
    cliente: txt(d.cliente, 120).trim(), unidade: txt(d.unidade, 120).trim(), linha: d.linha, servico: txt(d.servico, 120),
    gestorCliente: txt(d.gestorCliente, 120), classFinan: ["A", "B", "C", "D"].includes(d.classFinan) ? d.classFinan : null,
    freqVisita: ["Mensal", "Bimestral", "Trimestral", "Semestral", "Anual", "Sem visita"].includes(d.freqVisita) ? d.freqVisita : "Sem visita",
    refVisita: Math.min(12, Math.max(1, Number(d.refVisita) || 1)), liderId: d.liderId || null,
    inicio: /^\d{4}-\d{2}$/.test(d.inicio || "") ? d.inicio : null, ativo: d.ativo !== false,
    biUnidadeId: txt(d.biUnidadeId, 200), origem: txt(d.origem, 30) || "sistema",
  };
  await gravar("unidade", b.id, u);
  return { unidade: u };
});
rota("lider", ["PUT", "POST"], async (req) => {
  const ctx = await contexto(req); exigeAdmin(ctx);
  const b = await corpo(req); const d = b.dados || {};
  if (!validoId(b.id)) throw new ErroHttp(400, "Identificador inválido.");
  const email = d.email ? String(d.email).trim().toLowerCase() : null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ErroHttp(400, "E-mail inválido.");
  if (email && Object.entries(ctx.lideres).some(([k, l]) => k !== b.id && String(l.email || "").toLowerCase() === email)) throw new ErroHttp(409, "Esse e-mail já está com outro líder.");
  const l = { rotulo: txt(d.rotulo, 80).trim() || b.id, email, linhas: (Array.isArray(d.linhas) ? d.linhas : []).filter((x) => LINHAS.includes(x)), ativo: d.ativo !== false };
  await gravar("lider", b.id, l);
  return { lider: l };
});
rota("config", ["PUT", "POST"], async (req) => {
  const ctx = await contexto(req); exigeAdmin(ctx);
  const d = (await corpo(req)).dados || {};
  const c = { ...ctx.config };
  if (d.diaFechamento != null) c.diaFechamento = Math.min(28, Math.max(1, Number(d.diaFechamento) || 10));
  if (d.faixaOk != null) c.faixaOk = Math.min(100, Math.max(1, Number(d.faixaOk) || 85));
  if (d.faixaAtencao != null) c.faixaAtencao = Math.min(99, Math.max(0, Number(d.faixaAtencao) || 70));
  if (Array.isArray(d.reabertos)) c.reabertos = d.reabertos.filter((x) => /^\d{4}-\d{2}$/.test(x)).slice(0, 60);
  if (Array.isArray(d.admins)) {
    const adm = [...new Set(d.admins.map((x) => String(x).trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))];
    if (!adm.includes(ctx.eu.email)) throw new ErroHttp(400, "Mantenha o seu próprio e-mail na diretoria para não perder o acesso.");
    c.admins = adm;
  }
  await gravar("config", "geral", c);
  return { config: c };
});
