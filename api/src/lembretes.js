"use strict";
/*
 * Lembretes por e-mail do Painel CS (horário de Brasília, UTC-3):
 *  - dia 10: lembrete do relatório mensal (vale 100 se entregue até hoje)
 *  - dia 20: desempenho parcial da carteira e criticidades
 *  - último dia do mês: o prazo de lançamento fecha amanhã (dia 1)
 * Vai para toda a equipe ativa com e-mail (coordenadores e supervisores).
 * Envio pelo Microsoft Graph com a identidade gerenciada da Function App; a permissão de
 * envio é dada no Exchange Online (RBAC for Applications) só para a caixa MAIL_FROM.
 */
const { ManagedIdentityCredential } = require("@azure/identity");

const MESES_L = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const FREQ = { Mensal: 1, Bimestral: 2, Trimestral: 3, Semestral: 6, Anual: 12 };
const KEYS = ["obj", "rel", "vis", "ctt"];
const CRIT_NOME = { obj: "Objetivos", rel: "Relatório", vis: "Visita", ctt: "Contato gestor" };
const pad = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (n == null ? "—" : String(Math.round(n)));
const SITE = () => process.env.SITE_URL || "https://jbarbosa84.github.io/painel-cs/";

/* ---------- data em Brasília ---------- */
function hojeBR(base) {
  const d = new Date((base || Date.now()) - 3 * 3600 * 1000);
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(), ultimoDia: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate() };
}
function tipoDoDia(h) {
  if (h.dia === 10) return "relatorio";
  if (h.dia === 20) return "desempenho";
  if (h.dia === h.ultimoDia) return "prazo";
  return null;
}

/* ---------- regra de pontuação (mesma do site) ---------- */
function prevista(u, mes) { const p = FREQ[u.freqVisita] || 0; if (!p) return false; const ref = u.refVisita || 1; return (((mes - ref) % p) + p) % p === 0; }
function relNivel(data, ano, mes) {
  const [y, m, d] = data.split("-").map(Number);
  if (y * 12 + m < ano * 12 + mes) return 100;
  if (y === ano && m === mes) return d <= 10 ? 100 : 50;
  return 0;
}
function calc(u, ano, mes, m) {
  if (u.inicio && `${ano}-${pad(mes)}` < u.inicio) return null;
  m = m || {}; const imp = m.importado || {}; const prev = prevista(u, mes); const v = {};
  const doImp = (k) => { if (imp[k] != null) { v[k] = imp[k]; return true; } return false; };
  if (m.objetivo && m.objetivo.nivel != null) v.obj = m.objetivo.nivel; else if (!doImp("obj")) v.obj = null;
  if (m.relatorio && m.relatorio.naoEntregue) v.rel = 0;
  else if (m.relatorio && m.relatorio.data) v.rel = relNivel(m.relatorio.data, ano, mes);
  else if (!doImp("rel")) v.rel = null;
  const vs = m.visitas || []; if (vs.length) v.vis = vs.some((x) => x.comGestor) ? 100 : 75; else if (!doImp("vis")) v.vis = prev ? null : "NA";
  const cs = m.contatos || []; if (cs.length) v.ctt = Math.max(...cs.map((c) => (c.canal === "informal" ? 50 : 100))); else if (!doImp("ctt")) v.ctt = null;
  const pendentes = KEYS.filter((k) => v[k] === null);
  const nums = KEYS.map((k) => (v[k] === null ? 0 : v[k])).filter((x) => typeof x === "number");
  return { v, pendentes, prev, nota: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null };
}
const faixa = (n, cfg) => (n == null ? "na" : n >= (cfg.faixaOk || 85) ? "ok" : n >= (cfg.faixaAtencao || 70) ? "warn" : "crit");
const COR = { ok: ["#1a8a43", "#E4F3E8", "Saudável"], warn: ["#a86f00", "#FBF0D9", "Atenção"], crit: ["#c53030", "#FBE5E5", "Risco"], na: ["#8A7A78", "#EFE9E6", "Sem avaliação"] };
const media = (a) => { const x = a.filter((n) => n != null); return x.length ? x.reduce((p, q) => p + q, 0) / x.length : null; };

/* ---------- montagem dos dados ---------- */
async function carregar({ listar, ler }, h) {
  const config = { diaFechamento: 1, faixaOk: 85, faixaAtencao: 70, ...((await ler("config", "geral")) || {}) };
  const unidades = Object.fromEntries(Object.entries(await listar("unidade")).filter(([, u]) => u.ativo !== false));
  const lideres = await listar("lider");
  const ant = h.mes === 1 ? { ano: h.ano - 1, mes: 12 } : { ano: h.ano, mes: h.mes - 1 };
  const av = {};
  for (const ano of [...new Set([h.ano, ant.ano])]) {
    const pk = await listar(`av-${ano}`);
    for (const [rk, m] of Object.entries(pk)) av[`${ano}|${rk}`] = m;
  }
  const mesDe = (uid, ano, mes) => av[`${ano}|${uid}__${pad(mes)}`];
  const linhas = Object.entries(unidades).map(([id, u]) => {
    const c = calc(u, h.ano, h.mes, mesDe(id, h.ano, h.mes));
    const cAnt = calc(u, ant.ano, ant.mes, mesDe(id, ant.ano, ant.mes));
    const mAt = mesDe(id, h.ano, h.mes) || {};
    const relPendente = c && c.v.rel === null;
    return { id, u, c, cAnt, relPendente, semLancamento: !mAt.atualizadoEm && !mAt.importado };
  }).filter((x) => x.c);
  return { config, unidades, lideres, linhas };
}
function resumo(itens, cfg) {
  const nota = media(itens.map((x) => x.c.nota));
  const completos = itens.filter((x) => !x.c.pendentes.length).length;
  const crit = criticidades(itens, cfg);
  return { nota, total: itens.length, completos, pct: itens.length ? Math.round((completos / itens.length) * 100) : 0, crit };
}
function criticidades(itens, cfg) {
  const out = [];
  for (const x of itens) {
    const nome = `${x.u.cliente} · ${x.u.unidade} (${x.u.linha})`;
    if (x.u.classFinan === "A" && x.c.nota != null && x.c.nota < (cfg.faixaAtencao || 70)) out.push({ g: 0, nome, s: `Cliente classe A com nota ${fmt(x.c.nota)} no mês` });
    if (x.cAnt && x.cAnt.nota != null && x.c.nota != null && !x.c.pendentes.length && x.c.nota - x.cAnt.nota <= -15) out.push({ g: 1, nome, s: `Caiu ${Math.round(x.cAnt.nota - x.c.nota)} pts em relação ao mês anterior` });
    if (x.c.prev && x.c.v.vis === null) out.push({ g: 2, nome, s: "Visita prevista no mês e ainda sem registro" });
    if (x.semLancamento) out.push({ g: 3, nome, s: "Nenhum lançamento no mês até agora" });
  }
  return out.sort((a, b) => a.g - b.g);
}

/* ---------- HTML do e-mail ---------- */
function casca(titulo, saudacao, corpo) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F5EFEA;font-family:Montserrat,Segoe UI,Arial,sans-serif;color:#3D2E30">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5EFEA"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%">
<tr><td style="background:#5E2A30;border-radius:10px 10px 0 0;padding:18px 22px;color:#FBF5F2">
<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#E3C9CC;font-weight:700">Painel CS · Elevalife</div>
<div style="font-size:20px;font-weight:700;margin-top:4px">${esc(titulo)}</div></td></tr>
<tr><td style="background:#FFFFFF;border-radius:0 0 10px 10px;padding:22px">
<p style="margin:0 0 14px;font-size:14px">${saudacao}</p>${corpo}
<p style="margin:22px 0 4px"><a href="${SITE()}" style="display:inline-block;background:#8B3A42;color:#FFFFFF;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:8px;font-size:14px">Abrir o Painel CS</a></p>
</td></tr>
<tr><td style="padding:12px 4px;font-size:11px;color:#8A7A78">Aviso automático do Painel CS. Entre com sua conta Microsoft da Elevalife. Dúvidas sobre a carteira, fale com sua coordenação.</td></tr>
</table></td></tr></table></body></html>`;
}
const pill = (f) => `<span style="display:inline-block;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;color:${COR[f][0]};background:${COR[f][1]}">${COR[f][2]}</span>`;
function cards(lista) {
  const cel = lista.map((k) => `<td style="padding:4px" width="${Math.floor(100 / lista.length)}%"><div style="border:1px solid #E7DED9;border-radius:8px;padding:10px 12px">
<div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#8A7A78;font-weight:700">${esc(k[0])}</div>
<div style="font-size:24px;font-weight:700;margin-top:2px;color:${k[2] || "#3D2E30"}">${esc(k[1])}</div></div></td>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 14px"><tr>${cel}</tr></table>`;
}
function tabelaUnidades(itens, cfg) {
  if (!itens.length) return `<p style="font-size:13px;color:#6E5C5C">Nenhuma unidade.</p>`;
  const linhas = itens.map((x) => {
    const f = faixa(x.c.nota, cfg);
    const pend = x.c.pendentes.length ? x.c.pendentes.map((k) => CRIT_NOME[k]).join(", ") : "Tudo lançado";
    return `<tr><td style="padding:8px;border-bottom:1px solid #E7DED9;font-size:13px"><b>${esc(x.u.cliente)}</b> · ${esc(x.u.unidade)}<div style="font-size:11px;color:#8A7A78">${esc(x.u.linha)}</div></td>
<td style="padding:8px;border-bottom:1px solid #E7DED9;font-size:12px;color:#6E5C5C">${esc(pend)}</td>
<td style="padding:8px;border-bottom:1px solid #E7DED9;font-size:15px;font-weight:700;text-align:right;color:${COR[f][0]}">${fmt(x.c.nota)}</td></tr>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E7DED9;border-radius:8px;border-collapse:separate">
<tr><td style="padding:8px;font-size:10.5px;text-transform:uppercase;color:#8A7A78;font-weight:700;border-bottom:1px solid #E7DED9">Unidade</td><td style="padding:8px;font-size:10.5px;text-transform:uppercase;color:#8A7A78;font-weight:700;border-bottom:1px solid #E7DED9">Pendente no mês</td><td style="padding:8px;font-size:10.5px;text-transform:uppercase;color:#8A7A78;font-weight:700;border-bottom:1px solid #E7DED9;text-align:right">Nota</td></tr>${linhas}</table>`;
}
function listaCrit(crit) {
  if (!crit.length) return `<p style="font-size:13px;color:#1a8a43;margin:4px 0 0">Nenhuma criticidade no momento.</p>`;
  const cor = ["#c53030", "#a86f00", "#2E6F72", "#8A7A78"];
  return crit.slice(0, 25).map((c) => `<div style="border-left:4px solid ${cor[c.g]};background:#F5EFEA;border-radius:6px;padding:8px 10px;margin:6px 0">
<div style="font-size:13px;font-weight:700">${esc(c.nome)}</div><div style="font-size:12px;color:#6E5C5C">${esc(c.s)}</div></div>`).join("") +
    (crit.length > 25 ? `<p style="font-size:12px;color:#6E5C5C">E mais ${crit.length - 25} itens no painel.</p>` : "");
}
function cardsEquipe(grupos, cfg) {
  const linhas = grupos.map((g) => {
    const f = faixa(g.r.nota, cfg);
    return `<tr><td style="padding:8px;border-bottom:1px solid #E7DED9;font-size:13px"><b>${esc(g.nome)}</b><div style="font-size:11px;color:#8A7A78">${esc(g.papel)}</div></td>
<td style="padding:8px;border-bottom:1px solid #E7DED9;font-size:12px;text-align:center">${g.r.total} unid.</td>
<td style="padding:8px;border-bottom:1px solid #E7DED9;font-size:12px;text-align:center">${g.r.pct}% lançado</td>
<td style="padding:8px;border-bottom:1px solid #E7DED9;font-size:12px;text-align:center">${g.r.crit.length} criticid.</td>
<td style="padding:8px;border-bottom:1px solid #E7DED9;font-size:15px;font-weight:700;text-align:right;color:${COR[f][0]}">${fmt(g.r.nota)}</td></tr>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E7DED9;border-radius:8px;border-collapse:separate">${linhas}</table>`;
}
const h2 = (t) => `<div style="font-size:15px;font-weight:700;margin:18px 0 6px">${esc(t)}</div>`;

/* ---------- e-mail de cada pessoa ---------- */
function montar(tipo, pessoa, id, dados, h) {
  const { config, linhas, lideres } = dados;
  const minhas = linhas.filter((x) => x.u.liderId === id);
  const coord = pessoa.perfil === "coordenador" ? (pessoa.coordenaLinhas || []) : [];
  const area = linhas.filter((x) => coord.includes(x.u.linha));
  const primeiro = esc((pessoa.rotulo || "").split(" ")[0] || "equipe");
  const mesNome = MESES_L[h.mes - 1];
  const prox = h.mes === 12 ? { m: 1, a: h.ano + 1 } : { m: h.mes + 1, a: h.ano };
  const porPessoa = () => {
    const ids = [...new Set(area.map((x) => x.u.liderId || ""))];
    return ids.map((lid) => ({ nome: (lideres[lid] && lideres[lid].rotulo) || "Sem responsável", papel: lideres[lid] && lideres[lid].perfil === "coordenador" ? "Coordenador" : "Supervisor", r: resumo(area.filter((x) => (x.u.liderId || "") === lid), config) }))
      .sort((a, b) => (a.r.nota == null) - (b.r.nota == null) || (a.r.nota || 0) - (b.r.nota || 0));
  };
  if (tipo === "relatorio") {
    const pend = minhas.filter((x) => x.relPendente);
    let corpo = `<p style="font-size:14px;margin:0 0 10px">Hoje, <b>${pad(h.dia)}/${pad(h.mes)}</b>, é o último dia para o relatório mensal de ${esc(mesNome)} valer <b>100</b>. A partir de amanhã, a entrega vale 50 até o fim do mês.</p>`;
    corpo += pend.length
      ? h2(`Unidades da sua carteira ainda sem relatório registrado (${pend.length})`) + tabelaUnidades(pend, config)
      : `<p style="font-size:13px;color:#1a8a43">Todas as unidades da sua carteira já têm o relatório registrado. Obrigado!</p>`;
    if (coord.length) {
      const pa = area.filter((x) => x.relPendente && x.u.liderId !== id);
      corpo += h2(`Na sua área (${coord.join(", ")})`) + `<p style="font-size:13px;margin:0">${pa.length ? `${pa.length} unidades de outros responsáveis ainda sem relatório.` : "As demais carteiras da área estão em dia com o relatório."}</p>`;
    }
    return { assunto: `Painel CS · Relatório mensal de ${mesNome}: o prazo para nota 100 é hoje`, html: casca(`Relatório mensal de ${mesNome}`, `Olá, ${primeiro}!`, corpo) };
  }
  if (tipo === "desempenho") {
    const r = resumo(minhas, config);
    const f = faixa(r.nota, config);
    let corpo = `<p style="font-size:14px;margin:0 0 6px">Esta é a foto parcial de ${esc(mesNome)} até hoje. Critérios ainda sem registro contam como 0, então a nota sobe conforme você lança.</p>`;
    corpo += cards([["Nota da carteira", fmt(r.nota), COR[f][0]], ["Unidades", String(r.total)], ["Mês lançado", `${r.pct}%`], ["Criticidades", String(r.crit.length), r.crit.length ? "#c53030" : "#1a8a43"]]);
    corpo += `<div>${pill(f)}</div>`;
    corpo += h2("Criticidades da sua carteira") + listaCrit(r.crit);
    corpo += h2("Unidades da carteira (menor nota primeiro)") + tabelaUnidades([...minhas].sort((a, b) => (a.c.nota ?? 999) - (b.c.nota ?? 999)), config);
    if (coord.length) {
      const ra = resumo(area, config);
      corpo += h2(`Sua área como coordenador (${coord.join(", ")})`) + cards([["Nota da área", fmt(ra.nota), COR[faixa(ra.nota, config)][0]], ["Unidades", String(ra.total)], ["Lançado", `${ra.pct}%`], ["Criticidades", String(ra.crit.length)]]) + cardsEquipe(porPessoa(), config);
    }
    return { assunto: `Painel CS · Seu desempenho parcial em ${mesNome}`, html: casca(`Desempenho de ${mesNome} (parcial)`, `Olá, ${primeiro}!`, corpo) };
  }
  // prazo
  const pend = minhas.filter((x) => x.c.pendentes.length);
  let corpo = `<p style="font-size:14px;margin:0 0 10px">Os lançamentos de <b>${esc(mesNome)}</b> fecham <b>amanhã, ${pad(1)}/${pad(prox.m)}</b>, ao fim do dia. Depois disso, só a diretoria consegue alterar. Critério previsto e sem registro fica com nota 0.</p>`;
  corpo += pend.length
    ? h2(`Unidades da sua carteira com lançamento pendente (${pend.length})`) + tabelaUnidades(pend, config)
    : `<p style="font-size:13px;color:#1a8a43">Sua carteira está com tudo lançado em ${esc(mesNome)}. Obrigado!</p>`;
  if (coord.length) corpo += h2(`Sua área (${coord.join(", ")})`) + cardsEquipe(porPessoa(), config);
  return { assunto: `Painel CS · Último dia: lançamentos de ${mesNome} fecham amanhã`, html: casca(`Prazo de ${mesNome} termina amanhã`, `Olá, ${primeiro}!`, corpo) };
}

/* ---------- envio ---------- */
const cred = new ManagedIdentityCredential();
async function enviar(para, assunto, html) {
  const de = process.env.MAIL_FROM;
  if (!de) throw new Error("MAIL_FROM não configurado");
  const tk = await cred.getToken("https://graph.microsoft.com/.default");
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(de)}/sendMail`, {
    method: "POST", headers: { Authorization: `Bearer ${tk.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { subject: assunto, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: para } }] }, saveToSentItems: true }),
  });
  if (!r.ok) throw new Error(`Graph ${r.status}: ${(await r.text()).slice(0, 300)}`);
}
async function executar(deps, tipo, h, opcoes) {
  const dados = await carregar(deps, h);
  const equipe = Object.entries(dados.lideres).filter(([, l]) => l.ativo !== false && l.email);
  const res = [];
  for (const [id, l] of equipe) {
    const m = montar(tipo, l, id, dados, h);
    if (opcoes.preview) { res.push({ id, para: l.email, assunto: m.assunto, html: m.html }); continue; }
    const para = opcoes.redirecionar || l.email;
    const assunto = opcoes.redirecionar ? `[Teste · ${l.rotulo}] ${m.assunto}` : m.assunto;
    try { await enviar(para, assunto, m.html); res.push({ id, para, ok: true }); }
    catch (e) { res.push({ id, para, ok: false, erro: String(e.message || e) }); }
  }
  return res;
}

module.exports = function registrar(deps) {
  const { app, rota, contexto, exigeAdmin, corpo, ler, gravar, ErroHttp } = deps;
  // Todo dia às 10:00 UTC (07:00 em Brasília). Só envia nos dias 10, 20 e no último dia do mês.
  app.timer("lembretesAgendados", {
    schedule: "0 0 10 * * *",
    handler: async (_t, inv) => {
      const h = hojeBR(); const tipo = tipoDoDia(h);
      if (!tipo) return;
      const chave = `${h.ano}-${pad(h.mes)}-${pad(h.dia)}-${tipo}`;
      if (await ler("envio", chave)) { inv.log(`Lembrete ${chave} já enviado.`); return; }
      const res = await executar(deps, tipo, h, {});
      await gravar("envio", chave, { em: new Date().toISOString(), res: res.map((r) => ({ id: r.id, ok: r.ok, erro: r.erro || null })) });
      inv.log(`Lembrete ${chave}: ${res.filter((r) => r.ok).length}/${res.length} enviados.`);
    },
  });
  // Diretoria: prévia ou teste. {tipo, modo: "previa" | "teste"}; o teste manda todos os e-mails só para quem pediu.
  rota("lembretes", ["POST"], async (req) => {
    const ctx = await contexto(req); exigeAdmin(ctx);
    const b = await corpo(req);
    if (!["relatorio", "desempenho", "prazo"].includes(b.tipo)) throw new ErroHttp(400, "Tipo de lembrete inválido.");
    const h = hojeBR();
    if (b.modo === "teste") return { resultado: await executar(deps, b.tipo, h, { redirecionar: ctx.eu.email }) };
    return { resultado: await executar(deps, b.tipo, h, { preview: true }) };
  });
};
module.exports._teste = { calc, hojeBR, tipoDoDia, montar, resumo };
