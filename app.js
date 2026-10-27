(() => {
"use strict";

/* ---------- constantes de negócio ---------- */
const LINHAS = ["Ergo", "Fisio", "Quiro", "AF", "Enfermagem/Med"];
const COR_LINHA = { "Ergo": "var(--s-ergo)", "Fisio": "var(--s-fisio)", "Quiro": "var(--s-quiro)", "AF": "var(--s-af)", "Enfermagem/Med": "var(--s-enf)" };
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MESES_L = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const FREQ = { "Mensal": 1, "Bimestral": 2, "Trimestral": 3, "Semestral": 6, "Anual": 12, "Sem visita": 0 };
const KEYS = ["obj", "rel", "vis", "ctt"];
const CRIT_NOME = { obj: "Objetivos", rel: "Relatório", vis: "Visita", ctt: "Contato gestor" };
const CRITERIOS = {
  obj: [[100, "Objetivo alinhado com KPIs do OBJ e do SRV"], [75, "Objetivo alinhado sem KPI do OBJ, com KPI do SRV"], [50, "Sem objetivo alinhado, com KPI do SRV"], [0, "Sem objetivo alinhado e sem KPI do SRV"]],
  rel: [[100, "Entregue no prazo (até o dia 10 do mês)"], [50, "Entregue dentro do mês"], [0, "Não entregue"]],
  vis: [[100, "Realizada com contato com o gestor"], [75, "Realizada sem contato com o gestor"], [0, "Prevista e não realizada"], ["N/A", "Sem visita prevista no mês (sai da conta)"]],
  ctt: [[100, "Realizado em reunião (presencial ou remota)"], [50, "Realizado por WhatsApp/Teams (informal)"], [0, "Não realizado"]],
};
const HOJE = new Date();

/* ---------- estado ---------- */
const S = {
  eu: null, admin: false, conta: null, erro: null, carregadoEm: 0,
  unidades: {}, lideres: {}, config: { diaFechamento: 10, faixaOk: 85, faixaAtencao: 70, reabertos: [], admins: [] },
  aval: {}, pronto: { u: false, l: false },
  view: "geral", ano: HOJE.getFullYear(), mes: HOJE.getMonth() + 1,
  f: { linha: "", lider: "", classe: "", busca: "" },
  gaveta: null, cadAba: "unidades", serieOff: {},
};

/* ---------- utilidades ---------- */
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const fmt = (n) => (n == null ? "—" : Math.round(n).toString());
const clone = (o) => JSON.parse(JSON.stringify(o || {}));
function slug(partes) {
  let s = partes.join("|").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 180) || "registro";
}
function h(tag, p, ...kids) {
  const e = document.createElement(tag);
  let valor;
  if (p) for (const [k, v] of Object.entries(p)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k === "value") valor = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "checked" || k === "disabled" || k === "selected") e[k] = !!v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) { if (c == null || c === false) continue; e.append(c instanceof Node ? c : String(c)); }
  if (valor !== undefined) e.value = valor;
  return e;
}
const NS = "http://www.w3.org/2000/svg";
function sv(tag, a, ...kids) {
  const e = document.createElementNS(NS, tag);
  if (a) for (const [k, v] of Object.entries(a)) if (v != null) e.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 3200);
}
function dataBR(iso) { if (!iso) return ""; const [y, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}/${y}`; }
function quando(iso) {
  if (!iso) return ""; const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/* ---------- regras de pontuação ---------- */
function prevista(u, mes) {
  const p = FREQ[u.freqVisita] || 0; if (!p) return false;
  const ref = u.refVisita || 1; return (((mes - ref) % p) + p) % p === 0;
}
function futuro(ano, mes) { return ano * 12 + mes > HOJE.getFullYear() * 12 + HOJE.getMonth() + 1; }
function fechado(ano, mes) {
  if ((S.config.reabertos || []).includes(`${ano}-${pad(mes)}`)) return false;
  return HOJE > new Date(ano, mes, Number(S.config.diaFechamento) || 10, 23, 59, 59);
}
function prazoFechamento(ano, mes) { const d = new Date(ano, mes, Number(S.config.diaFechamento) || 10); return d.toLocaleDateString("pt-BR"); }
function antesInicio(u, ano, mes) { return !!u.inicio && `${ano}-${pad(mes)}` < u.inicio; }
function relNivel(data, ano, mes) {
  const [y, m, d] = data.split("-").map(Number);
  if (y * 12 + m < ano * 12 + mes) return 100;
  if (y === ano && m === mes) return d <= 10 ? 100 : 50;
  return 0;
}
function avalDe(uid) { return { doc: S.aval[uid] }; }
function calc(u, ano, mes, mOver) {
  if (futuro(ano, mes) || antesInicio(u, ano, mes)) return { vazio: true };
  const { doc } = avalDe(u.id, ano);
  const m = mOver || (doc && doc.meses && doc.meses[pad(mes)]) || {};
  const imp = m.importado || {};
  const fech = fechado(ano, mes), prev = prevista(u, mes);
  const v = {}, origem = {};
  const doImp = (k) => { if (imp[k] != null) { v[k] = imp[k]; origem[k] = "plan"; return true; } return false; };
  if (m.objetivo && m.objetivo.nivel != null) { v.obj = m.objetivo.nivel; origem.obj = "reg"; } else if (!doImp("obj")) v.obj = null;
  if (m.relatorio && m.relatorio.naoEntregue) { v.rel = 0; origem.rel = "reg"; }
  else if (m.relatorio && m.relatorio.data) { v.rel = relNivel(m.relatorio.data, ano, mes); origem.rel = "reg"; }
  else if (!doImp("rel")) v.rel = null;
  const vs = m.visitas || [];
  if (vs.length) { v.vis = vs.some((x) => x.comGestor) ? 100 : 75; origem.vis = "reg"; }
  else if (!doImp("vis")) v.vis = prev ? null : "NA";
  const cs = m.contatos || [];
  if (cs.length) { v.ctt = Math.max(...cs.map((c) => (c.canal === "informal" ? 50 : 100))); origem.ctt = "reg"; }
  else if (!doImp("ctt")) v.ctt = null;
  let pend = 0;
  for (const k of KEYS) if (v[k] === null) { if (fech) v[k] = 0; else pend++; }
  const nums = KEYS.map((k) => v[k]).filter((x) => typeof x === "number");
  const nota = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  return { v, origem, pend, nota, fech, prev, m };
}
function faixa(n) {
  if (n == null) return null;
  if (n >= (Number(S.config.faixaOk) || 85)) return "ok";
  if (n >= (Number(S.config.faixaAtencao) || 70)) return "warn";
  return "crit";
}
function status(c) {
  if (!c || c.vazio) return null;
  if (!c.fech && c.pend > 0) return "pend";
  if (c.nota == null) return "na";
  return faixa(c.nota);
}
const STATUS_TXT = { ok: "Saudável", warn: "Atenção", crit: "Risco", pend: "Em lançamento", na: "Sem avaliação" };
const STATUS_CLS = { ok: "p-ok", warn: "p-warn", crit: "p-crit", pend: "p-pend", na: "p-neutro" };
function pill(st) { return st ? h("span", { class: "pill " + STATUS_CLS[st], text: STATUS_TXT[st] }) : h("span", { class: "pill p-neutro", text: "—" }); }
function media(arr) { const a = arr.filter((x) => x != null); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }

/* ---------- escopo e filtros ---------- */
const PERFIL_TXT = { coordenador: "Coordenador", supervisor: "Supervisor" };
function perfilDe(l) { return l && l.perfil === "coordenador" ? "coordenador" : "supervisor"; }
function veEquipe() { return S.admin || (S.eu && S.eu.perfil === "coordenador"); }
function meuLider() { if (!S.eu || !S.eu.liderId || !S.lideres[S.eu.liderId]) return null; return { id: S.eu.liderId, ...S.lideres[S.eu.liderId] }; }
function unidadesEscopo() {
  let us = Object.entries(S.unidades).map(([id, u]) => ({ id, ...u })).filter((u) => u.ativo !== false);
  if (!S.admin && !meuLider()) us = [];
  return us;
}
function unidadesFiltradas() {
  const q = S.f.busca.trim().toLowerCase();
  return unidadesEscopo().filter((u) =>
    (!S.f.linha || u.linha === S.f.linha) && (!S.f.lider || (u.liderId || "") === S.f.lider) &&
    (!S.f.classe || u.classFinan === S.f.classe) &&
    (!q || `${u.cliente} ${u.unidade} ${u.gestorCliente || ""}`.toLowerCase().includes(q)))
    .sort((a, b) => a.cliente.localeCompare(b.cliente) || a.unidade.localeCompare(b.unidade) || LINHAS.indexOf(a.linha) - LINHAS.indexOf(b.linha));
}

/* ---------- pessoas ---------- */
function nomeLider(l) { if (!l) return "Sem responsável"; return l.rotulo || "Responsável"; }
function avatar(_uid, rotulo) {
  const ini = (rotulo || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return h("div", { class: "av av-ini", text: ini });
}

/* ---------- API ---------- */
const CFG = window.PAINEL_CONFIG || {};
const ESCOPO = [`api://${CFG.clientId}/access_as_user`];
let MSAL = null;
async function token() {
  try { return (await MSAL.acquireTokenSilent({ scopes: ESCOPO, account: S.conta })).accessToken; }
  catch (e) { await MSAL.acquireTokenRedirect({ scopes: ESCOPO, account: S.conta }); throw e; }
}
async function api(caminho, metodo, corpo) {
  const r = await fetch(CFG.apiBase.replace(/\/$/, "") + "/api/" + caminho, {
    method: metodo || "GET",
    headers: { Authorization: "Bearer " + (await token()), "Content-Type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  let dados = null; try { dados = await r.json(); } catch (e) { /* sem corpo */ }
  if (!r.ok) { const err = new Error((dados && dados.erro) || `Erro ${r.status}`); err.status = r.status; throw err; }
  return dados;
}
async function carregar() {
  try {
    const d = await api(`estado?ano=${S.ano}`);
    S.eu = d.eu; S.admin = !!d.eu.admin; S.erro = null;
    S.unidades = d.unidades || {}; S.lideres = d.lideres || {}; S.config = { ...S.config, ...(d.config || {}) }; S.aval = d.aval || {};
    S.pronto = { u: true, l: true }; S.carregadoEm = Date.now();
  } catch (e) { S.erro = e.message || "Não foi possível carregar os dados."; }
  tudo();
}

/* ---------- render agendado ---------- */
let _raf = 0;
function agendar() { if (_raf) return; _raf = requestAnimationFrame(() => { _raf = 0; renderMain(); renderTopo(); }); }
function tudo() { renderTopo(); renderFiltros(); renderMain(); }

/* ---------- topo e abas ---------- */
function abas() {
  if (S.admin) return [["geral", "Visão geral"], ["historico", "Histórico"], ["cadastro", "Cadastro"], ["criterios", "Critérios"]];
  return [["geral", veEquipe() ? "Minha área" : "Minha carteira"], ["historico", "Histórico"], ["criterios", "Critérios"]];
}
function renderTopo() {
  const nav = $("abas"); nav.replaceChildren(...abas().map(([k, t]) => h("button", { class: "aba", "aria-current": S.view === k ? "page" : null, onclick: () => { S.view = k; tudo(); window.scrollTo(0, 0); }, text: t })));
  const eu = $("eu"); eu.replaceChildren();
  if (!S.conta) return;
  const ml = meuLider();
  const papel = S.admin ? "Diretoria" : ml ? (perfilDe(ml) === "coordenador" ? "Coordenador · " + ((S.eu.coordenaLinhas || []).join(", ") || "sem linha") : "Supervisor") : "Sem carteira";
  eu.append(h("span", {}, h("b", { style: "color:var(--topo-fg)", text: (S.conta.name || S.conta.username || "").split(" ")[0] }), " · " + papel),
    h("button", { class: "aba", onclick: carregar, title: "Buscar os dados mais recentes", text: "Atualizar" }),
    h("button", { class: "aba", onclick: () => MSAL.logoutRedirect({ account: S.conta }), text: "Sair" }));
}
function opcoesMes() {
  const out = []; const ultimo = HOJE.getFullYear() === S.ano ? HOJE.getMonth() + 1 : 12;
  for (let m = 1; m <= ultimo; m++) out.push(h("option", { value: String(m), text: `${MESES_L[m - 1]} ${S.ano}` }));
  return out;
}
function renderFiltros() {
  const f = $("filtros"); f.replaceChildren();
  if (!["geral", "historico"].includes(S.view) || !S.pronto.u) return;
  const sel = (rot, id, val, opts, on) => h("label", { class: "campo" }, h("span", { text: rot }),
    h("select", { id, value: val, onchange: (e) => on(e.target.value) }, opts));
  if (S.view === "geral") f.append(sel("Competência", "f-mes", String(S.mes), opcoesMes(), (v) => { S.mes = Number(v); renderMain(); }));
  f.append(sel("Linha", "f-linha", S.f.linha, [h("option", { value: "", text: "Todas" }), ...LINHAS.map((l) => h("option", { value: l, text: l }))], (v) => { S.f.linha = v; renderMain(); }));
  if (veEquipe()) f.append(sel("Responsável", "f-lider", S.f.lider, [h("option", { value: "", text: "Todos" }), ...Object.entries(S.lideres).map(([id, l]) => h("option", { value: id, text: nomeLider(l) }))], (v) => { S.f.lider = v; renderMain(); }));
  f.append(sel("Classe financeira", "f-classe", S.f.classe, [h("option", { value: "", text: "Todas" }), ..."ABCD".split("").map((c) => h("option", { value: c, text: c }))], (v) => { S.f.classe = v; renderMain(); }));
  f.append(h("label", { class: "campo busca" }, h("span", { text: "Buscar" }), h("input", { id: "f-busca", type: "search", placeholder: "Cliente, unidade ou gestor do cliente", value: S.f.busca, oninput: (e) => { S.f.busca = e.target.value; renderMain(); } })));
}

/* ---------- visão geral ---------- */
function renderMain() {
  const app = $("app");
  if (!CFG.clientId) { app.replaceChildren(h("div", { class: "vazio" }, h("h3", { text: "Painel ainda não configurado" }), "Falta o arquivo config.js com os dados do aplicativo no Microsoft Entra ID.")); return; }
  if (!S.conta) {
    app.replaceChildren(h("div", { class: "vazio", style: "padding:48px 20px" }, h("h3", { text: "Entre com sua conta Microsoft da Elevalife" }),
      h("p", { style: "margin:6px 0 18px", text: "Use o mesmo e-mail do Outlook e do Teams. Cada pessoa vê apenas a carteira ou a área dela." }),
      h("button", { class: "btn btn-pri", onclick: () => MSAL.loginRedirect({ scopes: ESCOPO }), text: "Entrar com Microsoft" })));
    return;
  }
  if (S.erro) { app.replaceChildren(h("div", { class: "vazio" }, h("h3", { text: "Não foi possível carregar o painel" }), h("p", { text: S.erro }), h("button", { class: "btn", onclick: carregar, text: "Tentar de novo" }))); return; }
  if (!S.pronto.u || !S.pronto.l) return;
  if (!S.admin && !meuLider() && S.view !== "criterios") {
    app.replaceChildren(h("div", { class: "vazio" }, h("h3", { text: "Seu e-mail ainda não está ligado a uma carteira" }), `Você entrou como ${S.conta.username}. Peça à diretoria para cadastrar esse e-mail em Cadastro → Equipe.`));
    return;
  }
  const views = { geral: viewGeral, historico: viewHistorico, cadastro: viewCadastro, criterios: viewCriterios };
  app.replaceChildren(...[].concat((views[S.view] || viewGeral)()));
}

function viewGeral() {
  const us = unidadesFiltradas();
  if (!unidadesEscopo().length) return [h("div", { class: "vazio" }, h("h3", { text: "Nenhuma unidade na carteira" }), S.admin ? "Cadastre a primeira unidade em Cadastro → Unidades." : "Nenhuma unidade está atribuída a você ou à sua área ainda.")];
  const ano = S.ano, mes = S.mes;
  const cs = us.map((u) => ({ u, c: calc(u, ano, mes), cp: mes > 1 ? calc(u, ano, mes - 1) : null }));
  const validas = cs.filter((x) => !x.c.vazio);
  const nm = media(validas.map((x) => x.c.nota));
  const npAnt = mes > 1 ? media(validas.map((x) => x.cp && !x.cp.vazio ? x.cp.nota : null)) : null;
  const delta = nm != null && npAnt != null ? nm - npAnt : null;
  const risco = validas.filter((x) => x.c.nota != null && faixa(x.c.nota) === "crit" && (x.c.fech || x.c.pend === 0)).length;
  const pendU = validas.filter((x) => !x.c.fech && x.c.pend > 0);
  const fechMes = fechado(ano, mes);
  const out = [];

  // KPIs
  out.push(h("section", { class: "kpis", "aria-label": "Indicadores do mês" },
    h("div", { class: "kpi" }, h("span", { class: "rot", text: `Nota média · ${MESES[mes - 1]}` }), h("span", { class: "val num", text: fmt(nm) }),
      h("span", { class: "sub" }, !fechMes && pendU.length ? h("span", { style: "color:var(--teal);font-weight:600", text: "Parcial · " }) : null, delta == null ? "Sem mês anterior" : h("span", { class: delta >= 0 ? "delta-up" : "delta-down", text: `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)} pts` }), delta == null ? "" : ` vs ${MESES[mes - 2]}`)),
    h("div", { class: "kpi" }, h("span", { class: "rot", text: "Unidades avaliadas" }), h("span", { class: "val num", text: `${validas.filter((x) => x.c.nota != null).length}/${validas.length}` }), h("span", { class: "sub", text: "por linha de serviço" })),
    h("div", { class: "kpi" }, h("span", { class: "rot", text: "Em risco" }), h("span", { class: "val num", style: risco ? "color:var(--crit)" : null, text: String(risco) }), h("span", { class: "sub", text: `nota abaixo de ${S.config.faixaAtencao}` })),
    h("div", { class: "kpi" }, h("span", { class: "rot", text: fechMes ? "Mês fechado" : "Lançamentos pendentes" }), h("span", { class: "val num", text: fechMes ? "✓" : String(pendU.length) }),
      h("span", { class: "sub", text: fechMes ? `Fechou em ${prazoFechamento(ano, mes)}` : `Fecha em ${prazoFechamento(ano, mes)}` }))));

  // evolução + alertas
  out.push(h("section", { class: "grade2" }, painelEvolucao(us), painelAlertas(cs)));

  // equipe (diretoria e coordenadores)
  if (veEquipe()) out.push(painelLideres(cs));

  // tabela
  out.push(tabelaCarteira(cs));
  return out;
}

function serieMensal(us, filtro) {
  const ult = HOJE.getFullYear() === S.ano ? HOJE.getMonth() + 1 : 12; const vals = [];
  for (let m = 1; m <= ult; m++) vals.push(media(us.filter(filtro).map((u) => { const c = calc(u, S.ano, m); return c.vazio ? null : c.nota; })));
  return vals;
}
function painelEvolucao(us) {
  const linhasPresentes = LINHAS.filter((l) => us.some((u) => u.linha === l));
  const series = [{ nome: "Geral", cor: "var(--texto)", vals: serieMensal(us, () => true), forte: true },
    ...linhasPresentes.map((l) => ({ nome: l, cor: COR_LINHA[l], vals: serieMensal(us, (u) => u.linha === l) }))];
  const box = h("div", { class: "painel" },
    h("h2", { text: "Evolução da nota mensal" }),
    h("p", { class: "desc", text: `Média simples das unidades em ${S.ano}, por linha de serviço. Linha pontilhada: meta de ${S.config.faixaOk}. Trecho tracejado: mês ainda em lançamento.` }));
  box.append(graficoLinhas(series));
  box.append(h("div", { class: "legenda" }, series.map((s) => h("button", { "aria-pressed": S.serieOff[s.nome] ? "false" : "true", onclick: () => { S.serieOff[s.nome] = !S.serieOff[s.nome]; renderMain(); } }, h("i", { style: `background:${s.cor};height:${s.forte ? 4 : 3}px` }), s.nome))));
  return box;
}
function graficoLinhas(series) {
  const W = 640, H = 230, L = 30, R = 78, T = 10, B = 26;
  const n = Math.max(...series.map((s) => s.vals.length), 1);
  const x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (1 - v / 100) * (H - T - B);
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, class: "grafico", role: "img", "aria-label": "Evolução da nota mensal por linha" });
  [0, 25, 50, 75, 100].forEach((v) => { svg.append(sv("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" }), sv("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, String(v))); });
  svg.append(sv("line", { x1: L, x2: W - R, y1: y(Number(S.config.faixaOk) || 85), y2: y(Number(S.config.faixaOk) || 85), class: "alvo" }));
  for (let i = 0; i < n; i++) svg.append(sv("text", { x: x(i), y: H - 8, "text-anchor": "middle" }, MESES[i]));
  const vis = series.filter((s) => !S.serieOff[s.nome]);
  const rotulos = [];
  vis.slice().reverse().forEach((s) => {
    let d = "", pen = false;
    const abertoIdx = fechado(S.ano, s.vals.length) ? -1 : s.vals.length - 1;
    s.vals.forEach((v, i) => { if (i === abertoIdx) return; if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); pen = true; });
    if (d) svg.append(sv("path", { d, fill: "none", style: `stroke:${s.cor}`, "stroke-width": s.forte ? 3 : 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    if (abertoIdx > 0 && s.vals[abertoIdx] != null && s.vals[abertoIdx - 1] != null) svg.append(sv("path", { d: `M${x(abertoIdx - 1).toFixed(1)} ${y(s.vals[abertoIdx - 1]).toFixed(1)}L${x(abertoIdx).toFixed(1)} ${y(s.vals[abertoIdx]).toFixed(1)}`, fill: "none", style: `stroke:${s.cor}`, "stroke-width": s.forte ? 3 : 2, "stroke-dasharray": "4 4", "stroke-linecap": "round" }));
    s.vals.forEach((v, i) => { if (v != null && (s.forte || i === s.vals.length - 1)) svg.append(sv("circle", { cx: x(i), cy: y(v), r: s.forte ? 4 : 3.5, style: `fill:${s.cor};stroke:var(--card)`, "stroke-width": 2 })); });
    let li = -1; s.vals.forEach((v, i) => { if (v != null) li = i; });
    if (li >= 0) rotulos.push({ y: y(s.vals[li]), x: x(li), t: `${s.nome} ${fmt(s.vals[li])}`, cor: s.cor });
  });
  rotulos.sort((a, b) => a.y - b.y);
  for (let i = 1; i < rotulos.length; i++) if (rotulos[i].y - rotulos[i - 1].y < 13) rotulos[i].y = rotulos[i - 1].y + 13;
  rotulos.forEach((r) => svg.append(sv("text", { x: W - R + 8, y: r.y + 4, style: "fill:var(--texto-2);font-weight:600" }, r.t)));
  // camada de hover
  const guia = sv("line", { y1: T, y2: H - B, style: "stroke:var(--linha-forte)", "stroke-width": 1, visibility: "hidden" });
  svg.append(guia);
  const passo = n > 1 ? (W - L - R) / (n - 1) : W - L - R;
  for (let i = 0; i < n; i++) {
    const r = sv("rect", { x: x(i) - passo / 2, y: T, width: passo, height: H - T - B, fill: "transparent" });
    r.addEventListener("mousemove", (ev) => {
      guia.setAttribute("x1", x(i)); guia.setAttribute("x2", x(i)); guia.setAttribute("visibility", "visible");
      mostrarTip(ev, MESES_L[i] + (fechado(S.ano, i + 1) ? "" : " (parcial)"), vis.map((s) => [s.nome, fmt(s.vals[i])]));
    });
    r.addEventListener("mouseleave", () => { guia.setAttribute("visibility", "hidden"); $("tip").hidden = true; });
    svg.append(r);
  }
  return svg;
}
function mostrarTip(ev, titulo, linhas) {
  const t = $("tip"); t.replaceChildren(h("b", { text: titulo }), ...linhas.map(([a, b]) => h("div", { class: "l" }, h("span", { text: a }), h("span", { class: "num", text: b }))));
  t.hidden = false; const w = t.offsetWidth;
  t.style.left = Math.min(ev.clientX + 14, window.innerWidth - w - 12) + "px"; t.style.top = ev.clientY + 14 + "px";
}
function painelAlertas(cs) {
  const itens = [];
  const lim = Number(S.config.faixaAtencao) || 70;
  cs.forEach(({ u, c, cp }) => {
    if (c.vazio || c.nota == null) return;
    const completo = c.fech || c.pend === 0;
    if (completo && u.classFinan === "A" && c.nota < lim) itens.push({ u, cor: "crit", ico: "A", t: `${u.cliente} · ${u.unidade} (${u.linha})`, s: `Cliente classe A com nota ${fmt(c.nota)}` });
    if (completo && cp && !cp.vazio && cp.nota != null && c.nota - cp.nota <= -15) itens.push({ u, cor: "warn", ico: "▼", t: `${u.cliente} · ${u.unidade} (${u.linha})`, s: `Caiu ${Math.round(cp.nota - c.nota)} pts em relação a ${MESES[S.mes - 2]}` });
    if (!c.fech && c.prev && c.v.vis === null && HOJE.getDate() >= 20 && S.mes === HOJE.getMonth() + 1) itens.push({ u, cor: "pend", ico: "!", t: `${u.cliente} · ${u.unidade} (${u.linha})`, s: "Visita prevista ainda sem registro" });
  });
  const box = h("div", { class: "painel" }, h("h2", { text: "Pontos de atenção" }), h("p", { class: "desc", text: `Classe A abaixo de ${lim}, quedas de 15 pts ou mais e visitas previstas sem registro.` }));
  if (!itens.length) { box.append(h("div", { class: "vazio", style: "padding:18px" }, "Nenhum ponto de atenção neste mês.")); return box; }
  const ordem = { crit: 0, warn: 1, pend: 2 }; itens.sort((a, b) => ordem[a.cor] - ordem[b.cor]);
  const visitas = itens.filter((a) => a.cor === "pend");
  const outros = itens.filter((a) => a.cor !== "pend");
  itens.length = 0; itens.push(...outros, ...visitas.slice(0, Math.max(0, 8 - outros.length)));
  const resto = visitas.length - (itens.length - outros.length);
  const bg = { crit: "background:var(--crit-bg);color:var(--crit)", warn: "background:var(--warn-bg);color:var(--warn)", pend: "background:var(--teal-suave);color:var(--teal)" };
  box.append(h("div", { class: "alertas" }, itens.map((a) => h("button", { class: "alerta", onclick: () => abrirUnidade(a.u.id, S.mes) },
    h("span", { class: "ico", style: bg[a.cor], text: a.ico }), h("span", {}, h("div", { class: "t", text: a.t }), h("div", { class: "s", text: a.s }))))),
    resto > 0 ? h("p", { class: "desc", style: "margin:8px 0 0", text: `Mais ${resto} visitas previstas sem registro. Veja a coluna Status na carteira.` }) : "");
  return box;
}
function painelLideres(cs) {
  const grupos = {};
  cs.forEach((x) => { const k = x.u.liderId || ""; (grupos[k] = grupos[k] || []).push(x); });
  const cards = Object.entries(grupos).sort((a, b) => nomeLider(S.lideres[a[0]]).localeCompare(nomeLider(S.lideres[b[0]]))).map(([lid, xs]) => {
    const l = S.lideres[lid];
    const val = xs.filter((x) => !x.c.vazio);
    const nm = media(val.map((x) => x.c.nota));
    const completos = val.filter((x) => x.c.fech || x.c.pend === 0).length;
    const pct = val.length ? Math.round((completos / val.length) * 100) : 0;
    let ult = null;
    xs.forEach(({ u }) => { const { doc } = avalDe(u.id); Object.values((doc && doc.meses) || {}).forEach((m) => { if (m.atualizadoEm && (!ult || m.atualizadoEm > ult)) ult = m.atualizadoEm; }); });
    const st = faixa(nm);
    return h("div", { class: "lider" },
      h("div", { class: "lider-top" }, avatar(l && l.uid, nomeLider(l)), h("div", { style: "min-width:0" }, h("div", { class: "lider-nome", text: nomeLider(l) }),
        h("div", { class: "lider-sub", text: l ? PERFIL_TXT[perfilDe(l)] + " · " + ((l.linhas || []).join(", ") || "sem linha") + (l.email ? "" : " · sem e-mail") : "Unidades sem responsável" }))),
      h("div", { class: "lider-nums" },
        h("div", {}, h("b", { class: "num", style: st ? `color:var(--${st})` : null, text: fmt(nm) }), h("span", { text: "Nota" })),
        h("div", {}, h("b", { class: "num", text: String(val.length) }), h("span", { text: "Unidades" })),
        h("div", {}, h("b", { class: "num", text: pct + "%" }), h("span", { text: "Lançado" }))),
      h("div", { class: "barra", title: `${completos} de ${val.length} unidades com o mês completo` }, h("i", { style: `width:${pct}%` })),
      h("div", { class: "lider-sub", text: ult ? `Última atualização ${quando(ult)}` : "Sem atualizações no sistema ainda" }));
  });
  return h("section", { class: "painel" }, h("h2", { text: S.admin ? "Carteiras por responsável" : "Carteiras da sua área" }), h("p", { class: "desc", text: `Situação de ${MESES_L[S.mes - 1]}: nota média, unidades e quanto do mês já foi lançado.` }), h("div", { class: "lideres" }, cards));
}
function chips(c) {
  if (!c || c.vazio) return h("span", { class: "crit" });
  return h("span", { class: "crit" }, KEYS.map((k) => {
    const v = c.v[k]; const cls = v === "NA" ? "" : v === null ? "cpend" : "c" + v;
    return h("span", { class: cls, title: CRIT_NOME[k] + (c.origem[k] === "plan" ? " (planilha)" : ""), text: v === "NA" ? "N/A" : v === null ? "…" : String(v) });
  }));
}
function spark(u) {
  const vals = []; for (let m = Math.max(1, S.mes - 5); m <= S.mes; m++) { const c = calc(u, S.ano, m); vals.push(c.vazio ? null : c.nota); }
  const W = 78, H = 22; const x = (i) => 3 + (i * (W - 6)) / Math.max(1, vals.length - 1); const y = (v) => 3 + (1 - v / 100) * (H - 6);
  let d = "", pen = false; vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); pen = true; });
  const svg = sv("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "spark", "aria-hidden": "true" });
  if (d) svg.append(sv("path", { d, fill: "none", style: "stroke:var(--texto-3)", "stroke-width": 1.5 }));
  const li = vals.length - 1; if (vals[li] != null) svg.append(sv("circle", { cx: x(li), cy: y(vals[li]), r: 2.5, style: `fill:var(--${faixa(vals[li]) || "neutro"})` }));
  return svg;
}
function tabelaCarteira(cs) {
  const porCli = new Map();
  cs.forEach((x) => { if (!porCli.has(x.u.cliente)) porCli.set(x.u.cliente, []); porCli.get(x.u.cliente).push(x); });
  const corpo = [];
  for (const [cli, xs] of porCli) {
    const nm = media(xs.map((x) => (x.c.vazio ? null : x.c.nota)));
    corpo.push(h("tr", { class: "cli" }, h("td", { colspan: 6 }, cli, h("span", { style: "font-weight:500;color:var(--texto-3);font-family:var(--f-body);font-size:12px", text: `  ${xs.length} ${xs.length > 1 ? "linhas" : "linha"}` })),
      h("td", { colspan: 2 }), h("td", { class: "nota num", text: fmt(nm) }), h("td", {}, pill(faixa(nm)))));
    xs.forEach(({ u, c }) => {
      const l = S.lideres[u.liderId];
      corpo.push(h("tr", { class: "un", tabindex: "0", onclick: () => abrirUnidade(u.id, S.mes), onkeydown: (e) => { if (e.key === "Enter") abrirUnidade(u.id, S.mes); } },
        h("td", {}, h("div", { style: "font-weight:600", text: u.unidade }), u.gestorCliente ? h("div", { style: "font-size:11.5px;color:var(--texto-3)", text: "Gestor: " + u.gestorCliente }) : null),
        h("td", {}, h("span", { class: "tag-linha" }, h("i", { style: `background:${COR_LINHA[u.linha] || "var(--neutro)"}` }), u.linha)),
        h("td", { text: nomeLider(l) }),
        h("td", {}, u.classFinan ? h("span", { class: "classe", text: u.classFinan }) : "—"),
        h("td", { style: "font-size:12px;color:var(--texto-2)", text: u.freqVisita + (c.prev ? " · prevista" : "") }),
        h("td", {}, chips(c)),
        h("td", {}, spark(u)),
        h("td", { class: "num", style: "font-size:12px;color:var(--texto-3)", text: c.vazio ? "" : c.pend && !c.fech ? `${c.pend} pend.` : "" }),
        h("td", { class: "nota num", text: c.vazio ? "—" : fmt(c.nota) }),
        h("td", {}, pill(status(c)))));
    });
  }
  const box = h("section", { class: "painel", style: "padding:0;border:0;background:none" },
    h("div", { class: "cab-painel", style: "margin-bottom:10px" }, h("div", {}, h("h2", { text: `Carteira · ${MESES_L[S.mes - 1]}` }), h("p", { class: "desc", style: "margin:0", text: "Clique numa unidade para ver o histórico e lançar as atividades do mês. Critérios: Objetivos · Relatório · Visita · Contato com gestor." }))));
  if (!cs.length) { box.append(h("div", { class: "vazio", text: "Nenhuma unidade com esses filtros." })); return box; }
  box.append(h("div", { class: "tabela-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, ["Cliente / unidade", "Linha", "Responsável", "Classe", "Visita", "Critérios", "6 meses", "", "Nota", "Status"].map((t) => h("th", { text: t })))),
    h("tbody", {}, corpo))));
  return box;
}

/* ---------- histórico ---------- */
function viewHistorico() {
  const us = unidadesFiltradas();
  if (!us.length) return [h("div", { class: "vazio", text: "Nenhuma unidade com esses filtros." })];
  const linhas = [];
  let cliAnt = null;
  us.forEach((u) => {
    if (u.cliente !== cliAnt) { cliAnt = u.cliente; linhas.push(h("tr", { class: "cli" }, h("td", { colspan: 14, text: u.cliente }))); }
    const cels = []; const notas = [];
    for (let m = 1; m <= 12; m++) {
      const c = calc(u, S.ano, m);
      if (c.vazio) { cels.push(h("td", {}, h("span", { class: "cel h-nada", text: "" }))); continue; }
      const st = status(c); if (c.nota != null && (c.fech || !c.pend)) notas.push(c.nota);
      const cls = st === "pend" ? "h-pend" : st === "na" ? "h-na" : "h-" + st;
      cels.push(h("td", {}, h("button", { class: "cel " + cls, title: `${MESES_L[m - 1]}: ${STATUS_TXT[st]}`, onclick: () => abrirUnidade(u.id, m), text: c.nota == null ? (st === "pend" ? "…" : "N/A") : fmt(c.nota) })));
    }
    const ma = media(notas);
    linhas.push(h("tr", {}, h("td", {}, h("div", { style: "font-weight:600", text: u.unidade }), h("span", { class: "tag-linha" }, h("i", { style: `background:${COR_LINHA[u.linha]}` }), u.linha)), cels,
      h("td", { class: "nota num", style: ma != null ? `color:var(--${faixa(ma)})` : null, text: fmt(ma) })));
  });
  return [h("section", {},
    h("div", { style: "margin-bottom:10px" }, h("h2", { style: "font-family:var(--f-display);font-size:15px;margin:0", text: `Notas mensais · ${S.ano}` }),
      h("p", { class: "desc", style: "font-size:12px;color:var(--texto-2);margin:2px 0 0", text: `Verde a partir de ${S.config.faixaOk}, amarelo a partir de ${S.config.faixaAtencao}, vermelho abaixo disso. Azul: mês em lançamento. A média anual considera só meses completos.` })),
    h("div", { class: "tabela-wrap" }, h("table", { class: "heat" },
      h("thead", {}, h("tr", {}, h("th", { text: "Unidade" }), MESES.map((m) => h("th", { text: m })), h("th", { style: "text-align:right", text: "Média" }))),
      h("tbody", {}, linhas))))];
}

/* ---------- critérios ---------- */
function viewCriterios() {
  return [h("section", { class: "painel" }, h("h2", { text: "Como a nota é calculada" }),
    h("div", { class: "ajuda" }, h("ol", {},
      h("li", { text: "Cada linha de serviço do cliente (Ergo, Fisio, Quiro, AF, Enfermagem/Med) é avaliada separadamente todo mês." }),
      h("li", { text: "A nota do mês é a média simples dos quatro critérios. Critérios marcados como N/A saem da conta." }),
      h("li", { text: "A visita só entra na conta nos meses previstos pela frequência da unidade (mensal, bimestral, trimestral, semestral). Se houver visita registrada fora do ciclo, ela conta." }),
      h("li", { text: "Relatório, visita e contato são calculados a partir dos registros (data, canal, contato com o gestor). Objetivos é escolhido pelo responsável da unidade." }),
      h("li", { text: `O mês fecha no dia ${S.config.diaFechamento} do mês seguinte. Depois disso só a diretoria edita ou reabre. Critério sem registro em mês fechado vale 0.` }),
      h("li", { text: "A nota do cliente é a média das suas linhas. Os meses até outubro/2026 vieram das planilhas PAINEL_CS_ERGO e PAINEL_CS_GERAL." })))),
    h("section", { class: "criterios-tab" }, KEYS.map((k) => h("div", { class: "tabela-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", { text: "Nível" }), h("th", { text: CRIT_NOME[k] }))),
      h("tbody", {}, CRITERIOS[k].map(([n, t]) => h("tr", {}, h("td", { text: String(n) }), h("td", { text: t })))))))) ];
}

/* ---------- gaveta: unidade ---------- */
function fecharGaveta() { S.gaveta = null; $("gaveta-raiz").replaceChildren(); document.removeEventListener("keydown", escFecha); }
function escFecha(e) { if (e.key === "Escape") fecharGaveta(); }
function montarGaveta(cab, corpo, rod) {
  $("gaveta-raiz").replaceChildren(h("div", { class: "overlay", onclick: fecharGaveta }),
    h("aside", { class: "gaveta", role: "dialog", "aria-modal": "true" }, h("div", { class: "g-cab" }, cab), h("div", { class: "g-corpo" }, corpo), rod ? h("div", { class: "g-rod" }, rod) : null));
  document.addEventListener("keydown", escFecha);
}
function podeEditar(u, ano, mes) {
  if (futuro(ano, mes) || antesInicio(u, ano, mes)) return false;
  if (S.admin) return true;
  return !!meuLider() && !!S.unidades[u.id] && !fechado(ano, mes);
}
function abrirUnidade(uid, mes) {
  const u = { id: uid, ...S.unidades[uid] }; if (!S.unidades[uid]) return;
  const { doc } = avalDe(uid);
  const m = clone(doc && doc.meses && doc.meses[pad(mes)]);
  m.visitas = m.visitas || []; m.contatos = m.contatos || [];
  m.objetivo = m.objetivo || { nivel: null, obs: "" }; m.relatorio = m.relatorio || { data: null, naoEntregue: false, obs: "" };
  if (m.objetivo.nivel == null && !(m.importado && m.importado.obj != null) && mes > 1 && doc && doc.meses && doc.meses[pad(mes - 1)]) {
    const ant = calc(u, S.ano, mes - 1); if (typeof ant.v?.obj === "number") m._sugObj = ant.v.obj;
  }
  S.gaveta = { tipo: "unidade", uid, mes, rasc: m, sujo: false };
  renderGavetaUnidade();
}
function renderGavetaUnidade() {
  const g = S.gaveta; const u = { id: g.uid, ...S.unidades[g.uid] }; const ano = S.ano, mes = g.mes;
  const l = S.lideres[u.liderId];
  const editavel = podeEditar(u, ano, mes);
  const c = calc(u, ano, mes, g.rasc);
  const prevMeses = MESES.filter((_, i) => prevista(u, i + 1));

  const cab = [
    h("div", { style: "display:flex;justify-content:space-between;gap:10px;align-items:start" },
      h("div", {}, h("div", { style: "font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--texto-3)", text: u.cliente }), h("h2", { text: `${u.unidade} · ${u.linha}` })),
      h("button", { class: "btn btn-sm", onclick: fecharGaveta, "aria-label": "Fechar", text: "Fechar" })),
    h("div", { class: "g-meta" },
      h("span", {}, "Responsável ", h("b", { text: nomeLider(l) })),
      h("span", {}, "Gestor do cliente ", h("b", { text: u.gestorCliente || "—" })),
      h("span", {}, "Classe ", h("b", { text: u.classFinan || "—" })),
      h("span", {}, "Visitas ", h("b", { text: u.freqVisita + (prevMeses.length && prevMeses.length < 12 ? ` (${prevMeses.join(", ")})` : "") })),
      u.servico ? h("span", {}, "Serviço ", h("b", { text: u.servico })) : null),
    h("div", { class: "meses", role: "group", "aria-label": "Mês" }, MESES.map((nomeM, i) => {
      const mm = i + 1; const cc = calc(u, ano, mm); const st = status(cc);
      return h("button", { class: "mes", "aria-pressed": mm === mes ? "true" : "false", disabled: cc.vazio, onclick: () => { if (g.sujo && !confirmarDescarte()) return; abrirUnidade(u.id, mm); } },
        nomeM, h("b", { class: "num", style: st && !["na", "pend"].includes(st) ? `color:var(--${st})` : st === "pend" ? "color:var(--teal)" : null, text: cc.vazio ? "·" : cc.nota == null ? (st === "pend" ? "…" : "N/A") : fmt(cc.nota) }));
    })),
  ];

  const corpo = [];
  corpo.push(h("div", { class: "resumo", id: "resumo" }, KEYS.map((k) => h("div", {}, h("span", { text: CRIT_NOME[k] }), h("b", { class: "num", text: c.v[k] === "NA" ? "N/A" : c.v[k] === null ? "…" : String(c.v[k]) }))),
    h("div", { class: "total" }, h("span", { text: "Nota" }), h("b", { class: "num", text: fmt(c.nota) }))));
  if (!editavel) {
    const motivo = fechado(ano, mes) ? `Mês fechado em ${prazoFechamento(ano, mes)}. Só a diretoria pode editar ou reabrir.` : S.admin ? "" : "Esta unidade não está na sua carteira nem na sua área.";
    if (motivo) corpo.push(h("div", { class: "trava", text: "🔒 " + motivo }));
  } else if (!c.fech) {
    corpo.push(h("div", { class: "selo-orig", text: `Mês aberto até ${prazoFechamento(ano, mes)}. ${c.pend ? `${c.pend} critério(s) ainda sem registro.` : "Todos os critérios registrados."}` }));
  }
  const origemTxt = (k) => c.origem[k] === "plan" ? h("span", { class: "selo-orig", text: "Valor vindo da planilha · um registro novo substitui" }) : null;

  // Objetivos
  const sugObj = g.rasc._sugObj;
  corpo.push(h("div", { class: "bloco" },
    h("div", { class: "bloco-cab" }, h("h3", { text: "Objetivos" }), h("span", { class: "valor-crit num", text: c.v.obj === "NA" ? "N/A" : c.v.obj == null ? "…" : String(c.v.obj) })),
    h("div", { class: "regra", text: "Alinhamento dos objetivos do cliente com os KPIs do serviço." }), origemTxt("obj"),
    sugObj != null && g.rasc.objetivo.nivel == null && editavel ? h("button", { class: "btn-link", onclick: () => { g.rasc.objetivo.nivel = sugObj; g.sujo = true; renderGavetaUnidade(); }, text: `Repetir o nível do mês anterior (${sugObj})` }) : null,
    h("div", { class: "niveis" }, CRITERIOS.obj.map(([n, t]) => h("label", { class: "nivel" },
      h("input", { type: "radio", name: "obj", value: String(n), checked: g.rasc.objetivo.nivel === n, disabled: !editavel, onchange: () => { g.rasc.objetivo.nivel = n; g.sujo = true; renderGavetaUnidade(); } }),
      h("b", { class: "num", text: String(n) }), h("span", { text: t })))),
    campoObs("obj-obs", g.rasc.objetivo, editavel)));

  // Relatório
  const rel = g.rasc.relatorio;
  corpo.push(h("div", { class: "bloco" },
    h("div", { class: "bloco-cab" }, h("h3", { text: "Relatório mensal" }), h("span", { class: "valor-crit num", text: c.v.rel === "NA" ? "N/A" : c.v.rel == null ? "…" : String(c.v.rel) })),
    h("div", { class: "regra", text: "Até o dia 10 = 100 · depois do dia 10, dentro do mês = 50 · não entregue = 0." }), origemTxt("rel"),
    h("div", { class: "form-linha" },
      h("label", { class: "campo" }, h("span", { text: "Data de entrega" }), h("input", { id: "rel-data", type: "date", value: rel.data || "", disabled: !editavel || rel.naoEntregue, onchange: (e) => { rel.data = e.target.value || null; g.sujo = true; renderGavetaUnidade(); } })),
      h("label", { class: "check" }, h("input", { id: "rel-nao", type: "checkbox", checked: !!rel.naoEntregue, disabled: !editavel, onchange: (e) => { rel.naoEntregue = e.target.checked; if (rel.naoEntregue) rel.data = null; g.sujo = true; renderGavetaUnidade(); } }), "Não entregue")),
    campoObs("rel-obs", rel, editavel)));

  // Visitas
  corpo.push(blocoRegistros({
    titulo: "Visitas", k: "vis", lista: g.rasc.visitas, editavel, c, origemTxt,
    regra: c.prev ? "Visita prevista neste mês. Com contato com o gestor = 100 · sem contato = 75 · não realizada = 0." : "Sem visita prevista neste mês: o critério fica N/A, a menos que uma visita seja registrada.",
    linha: (r) => [h("span", { class: "d", text: dataBR(r.data) }), h("span", { class: "o", text: (r.comGestor ? "Com contato com o gestor" : "Sem contato com o gestor") + (r.obs ? " · " + r.obs : "") })],
    form: () => {
      const d = h("input", { id: "vis-data", type: "date", min: `${ano}-${pad(mes)}-01`, max: `${ano}-${pad(mes)}-${pad(new Date(ano, mes, 0).getDate())}` });
      const cg = h("input", { id: "vis-gestor", type: "checkbox", checked: true });
      const o = h("input", { id: "vis-obs", type: "text", placeholder: "Pauta, com quem falou, encaminhamentos" });
      return h("div", { class: "form-linha" }, h("label", { class: "campo" }, h("span", { text: "Data" }), d), h("label", { class: "check" }, cg, "Teve contato com o gestor"),
        h("label", { class: "campo larga" }, h("span", { text: "Observação" }), o),
        h("button", { class: "btn btn-sm", onclick: () => { if (!d.value) return toast("Informe a data da visita."); g.rasc.visitas.push({ data: d.value, comGestor: cg.checked, obs: o.value.trim() }); g.sujo = true; renderGavetaUnidade(); }, text: "Adicionar visita" }));
    },
  }));

  // Contatos
  corpo.push(blocoRegistros({
    titulo: "Contato com o gestor", k: "ctt", lista: g.rasc.contatos, editavel, c, origemTxt,
    regra: "Reunião presencial ou remota = 100 · WhatsApp/Teams informal = 50 · sem contato = 0. Vale o melhor contato do mês.",
    linha: (r) => [h("span", { class: "d", text: dataBR(r.data) }), h("span", { class: "o", text: (r.canal === "informal" ? "WhatsApp/Teams (informal)" : "Reunião presencial ou remota") + (r.obs ? " · " + r.obs : "") })],
    form: () => {
      const d = h("input", { id: "ctt-data", type: "date", min: `${ano}-${pad(mes)}-01`, max: `${ano}-${pad(mes)}-${pad(new Date(ano, mes, 0).getDate())}` });
      const cn = h("select", { id: "ctt-canal" }, h("option", { value: "reuniao", text: "Reunião presencial ou remota" }), h("option", { value: "informal", text: "WhatsApp/Teams (informal)" }));
      const o = h("input", { id: "ctt-obs", type: "text", placeholder: "Assunto e combinados" });
      return h("div", { class: "form-linha" }, h("label", { class: "campo" }, h("span", { text: "Data" }), d), h("label", { class: "campo" }, h("span", { text: "Canal" }), cn),
        h("label", { class: "campo larga" }, h("span", { text: "Observação" }), o),
        h("button", { class: "btn btn-sm", onclick: () => { if (!d.value) return toast("Informe a data do contato."); g.rasc.contatos.push({ data: d.value, canal: cn.value, obs: o.value.trim() }); g.sujo = true; renderGavetaUnidade(); }, text: "Adicionar contato" }));
    },
  }));

  const quem = g.rasc.atualizadoPor ? (g.rasc.atualizadoPorNome || g.rasc.atualizadoPor) : null;
  const rod = [
    h("span", { class: "selo-orig", text: quem ? `Atualizado por ${quem} em ${quando(g.rasc.atualizadoEm)}` : g.rasc.importado ? "Dados importados da planilha" : "Nenhum lançamento neste mês" }),
    editavel ? h("div", { style: "display:flex;gap:8px" }, h("button", { class: "btn", onclick: fecharGaveta, text: "Cancelar" }), h("button", { class: "btn btn-pri", id: "btn-salvar", disabled: !g.sujo, onclick: salvarMes, text: "Salvar mês" })) : null,
  ];
  const scrollAnt = document.querySelector(".g-corpo") ? document.querySelector(".g-corpo").scrollTop : 0;
  montarGaveta(cab, corpo, rod);
  const gc = document.querySelector(".g-corpo"); if (gc) gc.scrollTop = scrollAnt;
}
function confirmarDescarte() { toast("Salve ou cancele as alterações deste mês antes de trocar."); return false; }
function campoObs(id, alvo, editavel) {
  return h("label", { class: "campo" }, h("span", { text: "Observação" }), h("textarea", { id, rows: "2", value: alvo.obs || "", disabled: !editavel, placeholder: "Opcional",
    oninput: (e) => { alvo.obs = e.target.value; if (!S.gaveta.sujo) { S.gaveta.sujo = true; const b = $("btn-salvar"); if (b) b.disabled = false; } } }));
}
function blocoRegistros(o) {
  const v = o.c.v[o.k];
  return h("div", { class: "bloco" },
    h("div", { class: "bloco-cab" }, h("h3", { text: o.titulo }), h("span", { class: "valor-crit num", text: v === "NA" ? "N/A" : v == null ? "…" : String(v) })),
    h("div", { class: "regra", text: o.regra }), o.lista.length ? null : o.origemTxt(o.k),
    o.lista.length ? h("div", { class: "reg-lista" }, o.lista.map((r, i) => h("div", { class: "reg" }, o.linha(r),
      o.editavel ? h("button", { class: "btn-link", onclick: () => { o.lista.splice(i, 1); S.gaveta.sujo = true; renderGavetaUnidade(); }, text: "Remover" }) : null))) : h("div", { class: "selo-orig", text: "Nenhum registro neste mês." }),
    o.editavel ? o.form() : null);
}
async function salvarMes() {
  const g = S.gaveta; const u = { id: g.uid, ...S.unidades[g.uid] };
  const mesObj = clone(g.rasc); delete mesObj._sugObj;
  const c = calc(u, S.ano, g.mes, mesObj); mesObj.notas = c.v; mesObj.nota = c.nota == null ? null : Math.round(c.nota * 100) / 100;
  const btn = $("btn-salvar"); if (btn) { btn.disabled = true; btn.textContent = "Salvando…"; }
  try {
    const r = await api("avaliacao", "PUT", { unidadeId: u.id, ano: S.ano, mes: g.mes, dados: mesObj });
    S.aval[u.id] = S.aval[u.id] || { meses: {} }; S.aval[u.id].meses = S.aval[u.id].meses || {};
    S.aval[u.id].meses[pad(g.mes)] = r.mes;
    toast(`${MESES_L[g.mes - 1]} salvo · nota ${fmt(c.nota)}`);
    g.sujo = false; g.rasc = clone(r.mes); renderGavetaUnidade(); agendar();
  } catch (e) {
    toast(e.message || "Não foi possível salvar.");
    if (btn) { btn.disabled = false; btn.textContent = "Salvar mês"; }
  }
}

/* ---------- cadastro (diretoria) ---------- */
function viewCadastro() {
  if (!S.admin) return [h("div", { class: "vazio", text: "Área restrita à diretoria." })];
  const sub = h("div", { class: "subabas" }, [["unidades", "Unidades"], ["lideres", "Equipe"], ["config", "Configurações"]].map(([k, t]) =>
    h("button", { class: "btn", "aria-pressed": S.cadAba === k ? "true" : "false", onclick: () => { S.cadAba = k; renderMain(); }, text: t })));
  const conteudo = { unidades: cadUnidades, lideres: cadLideres, config: cadConfig }[S.cadAba]();
  return [sub, ...[].concat(conteudo)];
}
function cadUnidades() {
  const todas = Object.entries(S.unidades).map(([id, u]) => ({ id, ...u })).sort((a, b) => a.cliente.localeCompare(b.cliente) || a.unidade.localeCompare(b.unidade));
  return h("section", {},
    h("div", { class: "cab-painel", style: "margin-bottom:10px" }, h("div", {}, h("h2", { style: "font-family:var(--f-display);font-size:15px;margin:0", text: `Unidades (${todas.length})` }),
      h("p", { class: "desc", style: "font-size:12px;color:var(--texto-2);margin:2px 0 0", text: "Cada linha de serviço de um cliente é uma unidade avaliada. A carteira de cada supervisor ou coordenador é definida aqui." })),
      h("button", { class: "btn btn-pri", onclick: () => editarUnidade(null), text: "Nova unidade" })),
    h("div", { class: "tabela-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Cliente", "Unidade", "Linha", "Responsável", "Gestor do cliente", "Classe", "Visita", "Situação", ""].map((t) => h("th", { text: t })))),
      h("tbody", {}, todas.map((u) => h("tr", {},
        h("td", { style: "font-weight:600", text: u.cliente }), h("td", { text: u.unidade }),
        h("td", {}, h("span", { class: "tag-linha" }, h("i", { style: `background:${COR_LINHA[u.linha]}` }), u.linha)),
        h("td", { text: nomeLider(S.lideres[u.liderId]) }), h("td", { text: u.gestorCliente || "—" }),
        h("td", {}, u.classFinan ? h("span", { class: "classe", text: u.classFinan }) : "—"), h("td", { text: u.freqVisita }),
        h("td", {}, u.ativo === false ? h("span", { class: "pill p-neutro", text: "Inativa" }) : h("span", { class: "pill p-ok", text: "Ativa" })),
        h("td", {}, h("button", { class: "btn btn-sm", onclick: () => editarUnidade(u.id), text: "Editar" }))))))));
}
function editarUnidade(uid) {
  const u = uid ? clone(S.unidades[uid]) : { cliente: "", unidade: "", linha: "Ergo", servico: "", gestorCliente: "", classFinan: "A", freqVisita: "Mensal", refVisita: 1, liderId: "", ativo: true, inicio: `${HOJE.getFullYear()}-${pad(HOJE.getMonth() + 1)}` };
  S.gaveta = { tipo: "cad" };
  const campo = (rot, el) => h("label", { class: "campo" }, h("span", { text: rot }), el);
  const els = {
    cliente: h("input", { id: "u-cliente", type: "text", value: u.cliente, placeholder: "Ex.: GERDAU" }),
    unidade: h("input", { id: "u-unidade", type: "text", value: u.unidade, placeholder: "Ex.: Araçariguama" }),
    linha: h("select", { id: "u-linha", value: u.linha }, LINHAS.map((l) => h("option", { value: l, text: l }))),
    servico: h("input", { id: "u-servico", type: "text", value: u.servico || "", placeholder: "Ex.: Ginástica laboral" }),
    gestorCliente: h("input", { id: "u-gestor", type: "text", value: u.gestorCliente || "", placeholder: "Nome do gestor no cliente" }),
    classFinan: h("select", { id: "u-classe", value: u.classFinan || "" }, h("option", { value: "", text: "—" }), "ABCD".split("").map((c) => h("option", { value: c, text: c }))),
    freqVisita: h("select", { id: "u-freq", value: u.freqVisita }, Object.keys(FREQ).map((f) => h("option", { value: f, text: f }))),
    refVisita: h("select", { id: "u-ref", value: String(u.refVisita || 1) }, MESES_L.map((m, i) => h("option", { value: String(i + 1), text: m }))),
    liderId: h("select", { id: "u-lider", value: u.liderId || "" }, h("option", { value: "", text: "Sem responsável (diretoria)" }), Object.entries(S.lideres).map(([id, l]) => h("option", { value: id, text: nomeLider(l) }))),
    inicio: h("input", { id: "u-inicio", type: "month", value: u.inicio || "" }),
    ativo: h("input", { id: "u-ativo", type: "checkbox", checked: u.ativo !== false }),
  };
  const salvar = async () => {
    const novo = { ...u };
    for (const k of ["cliente", "unidade", "servico", "gestorCliente"]) novo[k] = els[k].value.trim();
    novo.cliente = novo.cliente.toUpperCase();
    novo.linha = els.linha.value; novo.classFinan = els.classFinan.value || null; novo.freqVisita = els.freqVisita.value;
    novo.refVisita = Number(els.refVisita.value); novo.liderId = els.liderId.value || null; novo.inicio = els.inicio.value || null; novo.ativo = els.ativo.checked;
    if (!novo.cliente || !novo.unidade) return toast("Preencha cliente e unidade.");
    novo.biUnidadeId = slug([novo.cliente, novo.unidade]);
    const id = uid || slug([novo.cliente, novo.unidade, novo.linha]);
    if (!uid && S.unidades[id]) return toast("Já existe essa unidade nessa linha de serviço.");
    try {
      await api("unidade", "PUT", { id, novo: !uid, dados: novo });
      S.unidades[id] = novo; toast(uid ? "Unidade atualizada." : "Unidade cadastrada."); fecharGaveta(); renderMain();
    } catch (e) { toast(e.message || "Não foi possível salvar a unidade."); }
  };
  montarGaveta([h("div", { style: "display:flex;justify-content:space-between;gap:10px" }, h("h2", { text: uid ? "Editar unidade" : "Nova unidade" }), h("button", { class: "btn btn-sm", onclick: fecharGaveta, text: "Fechar" })),
    h("div", { class: "selo-orig", text: "Ao trocar o responsável, a unidade e todo o seu histórico passam para a carteira dele." })],
  [h("div", { class: "bloco" }, h("div", { class: "form-grade" },
    campo("Cliente", els.cliente), campo("Unidade", els.unidade), campo("Linha de serviço", els.linha), campo("Serviço", els.servico),
    campo("Gestor do cliente", els.gestorCliente), campo("Classe financeira (faturamento)", els.classFinan),
    campo("Frequência de visita", els.freqVisita), campo("Primeiro mês do ciclo de visita", els.refVisita),
    campo("Responsável (carteira)", els.liderId), campo("Avaliada a partir de", els.inicio)),
    h("label", { class: "check" }, els.ativo, "Unidade ativa (aparece nas carteiras e na nota)"))],
  [h("span"), h("div", { style: "display:flex;gap:8px" }, h("button", { class: "btn", onclick: fecharGaveta, text: "Cancelar" }), h("button", { class: "btn btn-pri", onclick: salvar, text: "Salvar unidade" }))]);
}
function cadLideres() {
  const cont = (lid) => Object.values(S.unidades).filter((u) => u.liderId === lid && u.ativo !== false).length;
  const contArea = (l) => Object.values(S.unidades).filter((u) => u.ativo !== false && (l.coordenaLinhas || []).includes(u.linha)).length;
  const ordem = (a, b) => (perfilDe(a[1]) === perfilDe(b[1]) ? nomeLider(a[1]).localeCompare(nomeLider(b[1])) : perfilDe(a[1]) === "coordenador" ? -1 : 1);
  return h("section", { style: "display:flex;flex-direction:column;gap:14px" },
    h("div", { class: "painel ajuda" }, h("h2", { text: "Perfis de acesso" }), h("ol", {},
      h("li", { text: "Diretoria (e-mails em Configurações): vê e edita tudo, inclusive cadastro e reabertura de mês." }),
      h("li", { text: "Coordenador: vê todas as unidades das linhas que coordena, de qualquer supervisor, além da própria carteira. Lança nas unidades da área enquanto o mês está aberto." }),
      h("li", { text: "Supervisor: vê e lança só nas unidades da própria carteira." }),
      h("li", { text: `Para liberar alguém: cadastre o e-mail Microsoft, escolha o perfil, atribua as unidades em Cadastro → Unidades e envie o endereço ${location.origin + location.pathname}. Mudanças valem na próxima vez que a pessoa abrir o painel.` }))),
    h("div", { class: "cab-painel" }, h("h2", { style: "font-family:var(--f-display);font-size:15px;margin:0", text: "Equipe" }), h("button", { class: "btn btn-pri", onclick: () => editarLider(null), text: "Nova pessoa" })),
    h("div", { class: "lideres" }, Object.entries(S.lideres).sort(ordem).map(([id, l]) => {
      const coord = perfilDe(l) === "coordenador";
      return h("div", { class: "lider" },
        h("div", { class: "lider-top" }, avatar(null, nomeLider(l)), h("div", { style: "min-width:0" }, h("div", { class: "lider-nome", text: nomeLider(l) }),
          h("div", { class: "lider-sub", text: PERFIL_TXT[perfilDe(l)] + (coord ? " de " + ((l.coordenaLinhas || []).join(", ") || "nenhuma linha") : "") }))),
        h("div", { class: "lider-sub" }, l.email ? h("span", { class: "pill p-ok", text: "Acesso liberado" }) : h("span", { class: "pill p-warn", text: "Sem e-mail" }),
          l.email ? h("div", { style: "margin-top:6px;overflow-wrap:anywhere", text: l.email }) : null),
        h("div", { class: "lider-sub", text: `${cont(id)} unidades na carteira` + (coord ? ` · ${contArea(l)} na área` : "") + (l.ativo === false ? " · inativo" : "") }),
        h("div", {}, h("button", { class: "btn btn-sm", onclick: () => editarLider(id), text: "Editar" })));
    })));
}
function editarLider(id) {
  const l = id ? clone(S.lideres[id]) : { rotulo: "", linhas: [], email: "", ativo: true, perfil: "supervisor", coordenaLinhas: [] };
  S.gaveta = { tipo: "cad" };
  const nome = h("input", { id: "l-nome", type: "text", value: l.rotulo, placeholder: "Como a pessoa aparece no painel" });
  const email = h("input", { id: "l-email", type: "email", value: l.email || "", placeholder: "nome@elevalife.com.br", style: "width:100%" });
  const perfil = h("select", { id: "l-perfil", value: perfilDe(l) }, h("option", { value: "supervisor", text: "Supervisor: vê só a própria carteira" }), h("option", { value: "coordenador", text: "Coordenador: vê as linhas que coordena" }));
  const checks = LINHAS.map((ln) => ({ ln, el: h("input", { type: "checkbox", id: "l-" + slug([ln]), checked: (l.linhas || []).includes(ln) }) }));
  const coordChecks = LINHAS.map((ln) => ({ ln, el: h("input", { type: "checkbox", id: "lc-" + slug([ln]), checked: (l.coordenaLinhas || []).includes(ln) }) }));
  const blocoCoord = h("div", { class: "campo" }, h("span", { text: "Coordena as linhas" }), h("div", { style: "display:flex;gap:12px;flex-wrap:wrap" }, coordChecks.map((c) => h("label", { class: "check" }, c.el, c.ln))),
    h("small", { style: "color:var(--texto-3);font-size:11px", text: "Vê todas as unidades dessas linhas, de qualquer supervisor." }));
  blocoCoord.hidden = perfilDe(l) !== "coordenador";
  perfil.addEventListener("change", () => { blocoCoord.hidden = perfil.value !== "coordenador"; });
  const ativo = h("input", { id: "l-ativo", type: "checkbox", checked: l.ativo !== false });
  const salvar = async () => {
    const rot = nome.value.trim(); if (!rot) return toast("Informe o nome.");
    const em = email.value.trim().toLowerCase();
    if (em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return toast("Confira o e-mail.");
    const novoId = id || slug([rot]); if (!id && S.lideres[novoId]) return toast("Já existe alguém com esse nome na equipe.");
    const outro = em && Object.entries(S.lideres).find(([k, x]) => k !== novoId && (x.email || "").toLowerCase() === em);
    if (outro) return toast(`Esse e-mail já está com ${nomeLider(outro[1])}.`);
    const coordLinhas = coordChecks.filter((c) => c.el.checked).map((c) => c.ln);
    if (perfil.value === "coordenador" && !coordLinhas.length) return toast("Marque ao menos uma linha que essa pessoa coordena.");
    const corpo = { rotulo: rot, email: em || null, perfil: perfil.value, linhas: checks.filter((c) => c.el.checked).map((c) => c.ln),
      coordenaLinhas: perfil.value === "coordenador" ? coordLinhas : [], ativo: ativo.checked };
    try { await api("lider", "PUT", { id: novoId, dados: corpo }); S.lideres[novoId] = corpo; toast("Pessoa salva."); fecharGaveta(); renderMain(); renderFiltros(); }
    catch (e) { toast(e.message || "Não foi possível salvar."); }
  };
  montarGaveta([h("div", { style: "display:flex;justify-content:space-between;gap:10px" }, h("h2", { text: id ? "Editar pessoa da equipe" : "Nova pessoa na equipe" }), h("button", { class: "btn btn-sm", onclick: fecharGaveta, text: "Fechar" }))],
    [h("div", { class: "bloco" }, h("label", { class: "campo" }, h("span", { text: "Nome" }), nome),
      h("label", { class: "campo" }, h("span", { text: "E-mail Microsoft" }), email),
      h("label", { class: "campo" }, h("span", { text: "Perfil" }), perfil),
      blocoCoord,
      h("div", { class: "campo" }, h("span", { text: "Linhas em que atua" }), h("div", { style: "display:flex;gap:12px;flex-wrap:wrap" }, checks.map((c) => h("label", { class: "check" }, c.el, c.ln)))),
      h("label", { class: "check" }, ativo, "Ativo (sem isso, a pessoa perde o acesso)"))],
    [h("span"), h("div", { style: "display:flex;gap:8px" }, h("button", { class: "btn", onclick: fecharGaveta, text: "Cancelar" }), h("button", { class: "btn btn-pri", onclick: salvar, text: "Salvar" }))]);
}
function cadConfig() {
  const salvarCfg = async (patch) => {
    try { const r = await api("config", "PUT", { dados: patch }); S.config = { ...S.config, ...r.config }; toast("Configuração salva."); renderMain(); }
    catch (e) { toast(e.message || "Não foi possível salvar a configuração."); }
  };
  const num = (id, rot, k, min, max, ajuda) => h("label", { class: "campo" }, h("span", { text: rot }),
    h("input", { id, type: "number", min: String(min), max: String(max), value: String(S.config[k]), onchange: (e) => { const v = Math.max(min, Math.min(max, Number(e.target.value) || min)); salvarCfg({ [k]: v }); } }),
    h("small", { style: "color:var(--texto-3);font-size:11px", text: ajuda }));
  const ult = HOJE.getMonth() + 1;
  const mesesF = []; for (let m = 1; m < ult; m++) mesesF.push(m);
  const reab = S.config.reabertos || [];
  return h("section", { style: "display:flex;flex-direction:column;gap:14px" },
    h("div", { class: "painel" }, h("h2", { text: "Regras do mês" }), h("p", { class: "desc", text: "Valem para toda a equipe e para o cálculo das faixas." }),
      h("div", { class: "form-grade" },
        num("c-dia", "Dia de fechamento", "diaFechamento", 1, 28, "O mês fecha nesse dia do mês seguinte."),
        num("c-ok", "Saudável a partir de", "faixaOk", 50, 100, "Nota mínima da faixa verde."),
        num("c-at", "Atenção a partir de", "faixaAtencao", 0, 99, "Abaixo disso a unidade fica em risco."))),
    h("div", { class: "painel" }, h("h2", { text: `Reabrir meses de ${S.ano}` }), h("p", { class: "desc", text: "Um mês reaberto volta a aceitar lançamentos da equipe até você fechar de novo." }),
      h("div", { class: "meses-cfg" }, mesesF.map((m) => { const k = `${S.ano}-${pad(m)}`; const aberto = reab.includes(k);
        return h("label", { class: "check" }, h("input", { type: "checkbox", id: "r-" + m, checked: aberto, onchange: (e) => salvarCfg({ reabertos: e.target.checked ? [...reab, k] : reab.filter((x) => x !== k) }) }), MESES_L[m - 1]); }))),
    h("div", { class: "painel" }, h("h2", { text: "Diretoria" }), h("p", { class: "desc", text: "E-mails que veem e editam todas as carteiras, o cadastro e as configurações. Um por linha." }),
      h("textarea", { id: "c-admins", rows: "4", value: (S.config.admins || []).join("\n") }),
      h("div", { style: "margin-top:8px" }, h("button", { class: "btn", onclick: () => { const v = $("c-admins").value.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean); salvarCfg({ admins: v }); }, text: "Salvar diretoria" }))),
    h("div", { class: "painel" }, h("h2", { text: "Exportar" }), h("p", { class: "desc", text: "Planilha com a nota de cada unidade por mês e critério, para análises fora do painel." }),
      h("button", { class: "btn", onclick: exportarCsv, text: "Baixar CSV do ano" })));
}
async function exportarCsv() {
  const linhas = [["Cliente", "Unidade", "Linha", "Serviço", "Responsável", "Gestor do cliente", "Classe", "Frequência", "Competência", "Objetivos", "Relatório", "Visita", "Contato gestor", "Nota", "Status"]];
  const ult = HOJE.getFullYear() === S.ano ? HOJE.getMonth() + 1 : 12;
  Object.entries(S.unidades).forEach(([id, u0]) => { const u = { id, ...u0 };
    for (let m = 1; m <= ult; m++) { const c = calc(u, S.ano, m); if (c.vazio) continue;
      linhas.push([u.cliente, u.unidade, u.linha, u.servico || "", nomeLider(S.lideres[u.liderId]), u.gestorCliente || "", u.classFinan || "", u.freqVisita, `${pad(m)}/${S.ano}`,
        ...KEYS.map((k) => (c.v[k] === "NA" ? "N/A" : c.v[k] == null ? "" : c.v[k])), c.nota == null ? "" : c.nota.toFixed(1).replace(".", ","), STATUS_TXT[status(c)] || ""]); } });
  const csv = "﻿" + linhas.map((r) => r.map((x) => { const s = String(x); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = h("a", { href: url, download: `painel-cs-${S.ano}.csv` }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- inicialização ---------- */
async function iniciar() {
  tudo();
  if (!CFG.clientId || !window.msal) { tudo(); return; }
  MSAL = new msal.PublicClientApplication({
    auth: { clientId: CFG.clientId, authority: `https://login.microsoftonline.com/${CFG.tenantId}`, redirectUri: location.origin + location.pathname },
    cache: { cacheLocation: "localStorage" },
  });
  await MSAL.initialize();
  try { const r = await MSAL.handleRedirectPromise(); if (r && r.account) MSAL.setActiveAccount(r.account); }
  catch (e) { S.erro = "O login não foi concluído: " + (e.errorMessage || e.message); }
  S.conta = MSAL.getActiveAccount() || MSAL.getAllAccounts()[0] || null;
  if (S.conta) { MSAL.setActiveAccount(S.conta); $("app").replaceChildren(h("div", { class: "vazio" }, h("h3", { text: "Carregando carteiras…" }), "Buscando unidades, notas e registros.")); await carregar(); }
  else tudo();
  window.addEventListener("focus", () => { if (S.conta && !S.gaveta && Date.now() - S.carregadoEm > 60000) carregar(); });
}
iniciar();
})();
