"use strict";
/*
 * GET /api/resumo-tv — números agregados do CS para o painel da sala de operações.
 * Sem nomes de clientes nem de pessoas. Acesso por chave (app setting RESUMO_TV_CHAVE),
 * enviada no cabeçalho "x-chave" ou no parâmetro ?chave=. Parâmetro opcional ?mes=AAAA-MM.
 */
const crypto = require("crypto");
const { calc, faixa, media, hojeBR, pad } = require("./lembretes").interno;

const LINHAS = ["Ergo", "Fisio", "Quiro", "AF", "Enfermagem/Med"];
let cache = null; // { chave, em, dados }

function chaveOk(req) {
  const esperada = process.env.RESUMO_TV_CHAVE || "";
  const dada = req.headers.get("x-chave") || req.query.get("chave") || "";
  if (esperada.length < 16 || dada.length !== esperada.length) return false;
  return crypto.timingSafeEqual(Buffer.from(dada), Buffer.from(esperada));
}
function fechado(config, ano, mes) {
  if ((config.reabertos || []).includes(`${ano}-${pad(mes)}`)) return false;
  const lim = Date.UTC(ano, mes, Number(config.diaFechamento) || 10, 23 + 3, 59, 59);
  return Date.now() > lim;
}
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

function agregar(itens, cfg, fech) {
  const val = itens.filter((x) => x.c);
  const notas = val.map((x) => x.c.nota);
  const completas = val.filter((x) => !x.c.pendentes.length);
  const comLanc = val.filter((x) => x.lancou);
  const emRisco = val.filter((x) => x.c.nota != null && faixa(x.c.nota, cfg) === "crit" && (fech || !x.c.pendentes.length));
  const prev = val.filter((x) => x.c.prev);
  const feitaNoCiclo = prev.filter((x) => typeof x.c.v.vis === "number" && x.c.v.vis > 0);
  const feitaTotal = val.filter((x) => typeof x.c.v.vis === "number" && x.c.v.vis > 0);
  const relOk = val.filter((x) => typeof x.c.v.rel === "number" && x.c.v.rel > 0);
  const fx = { saudavel: 0, atencao: 0, risco: 0 };
  for (const x of val) { const f = faixa(x.c.nota, cfg); if (f === "ok") fx.saudavel++; else if (f === "warn") fx.atencao++; else if (f === "crit") fx.risco++; }
  const notaAnt = media(val.map((x) => (x.cAnt ? x.cAnt.nota : null)));
  return {
    unidades: val.length,
    clientes: new Set(val.map((x) => x.u.cliente)).size,
    notaMedia: r1(media(notas)),
    notaMediaMesAnterior: r1(notaAnt),
    avaliadasCompletas: completas.length,
    pctAvaliadasCompletas: pct(completas.length, val.length),
    comAlgumLancamento: comLanc.length,
    pctComAlgumLancamento: pct(comLanc.length, val.length),
    unidadesEmRisco: emRisco.length,
    clientesEmRisco: new Set(emRisco.map((x) => x.u.cliente)).size,
    faixas: fx,
    visitas: { previstas: prev.length, realizadasPrevistas: feitaNoCiclo.length, pctRealizadas: pct(feitaNoCiclo.length, prev.length), realizadasTotal: feitaTotal.length },
    relatorios: { entregues: relOk.length, pendentes: val.filter((x) => x.c.v.rel === null).length },
  };
}

module.exports = function registrar({ rota, listar, ler, ErroHttp }) {
  rota("resumo-tv", ["GET"], async (req) => {
    if (!chaveOk(req)) throw new ErroHttp(401, "Chave inválida.");
    const h = hojeBR();
    const q = /^(\d{4})-(\d{2})$/.exec(req.query.get("mes") || "");
    const ano = q ? Number(q[1]) : h.ano, mes = q ? Number(q[2]) : h.mes;
    if (mes < 1 || mes > 12) throw new ErroHttp(400, "Mês inválido.");
    const k = `${ano}-${pad(mes)}`;
    if (cache && cache.chave === k && Date.now() - cache.em < 5 * 60 * 1000) return cache.dados;

    const config = { diaFechamento: 10, faixaOk: 85, faixaAtencao: 70, ...((await ler("config", "geral")) || {}) };
    const unidades = Object.entries(await listar("unidade")).filter(([, u]) => u.ativo !== false);
    const ant = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
    const av = {};
    for (const a of [...new Set([ano, ant.ano])]) for (const [rk, m] of Object.entries(await listar(`av-${a}`))) av[`${a}|${rk}`] = m;
    const mDe = (id, a, m) => av[`${a}|${id}__${pad(m)}`];
    const itens = unidades.map(([id, u]) => {
      const m = mDe(id, ano, mes) || {};
      return { u, c: calc(u, ano, mes, mDe(id, ano, mes)), cAnt: calc(u, ant.ano, ant.mes, mDe(id, ant.ano, ant.mes)), lancou: !!(m.atualizadoEm || m.importado) };
    });
    const fech = fechado(config, ano, mes);
    const lim = new Date(Date.UTC(ano, mes, Number(config.diaFechamento) || 10));
    const linhas = [...new Set([...LINHAS, ...itens.map((x) => x.u.linha)])].filter((l) => itens.some((x) => x.u.linha === l && x.c));
    const dados = {
      competencia: k,
      mesFechado: fech,
      prazoLancamento: lim.toISOString().slice(0, 10),
      metaSaudavel: config.faixaOk || 85,
      limiteRisco: config.faixaAtencao || 70,
      geral: agregar(itens, config, fech),
      porLinha: linhas.map((l) => ({ linha: l, ...agregar(itens.filter((x) => x.u.linha === l), config, fech) })),
      geradoEm: new Date().toISOString(),
    };
    cache = { chave: k, em: Date.now(), dados };
    return dados;
  });
};
