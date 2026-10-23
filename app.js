import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ---------- utilidades ---------- */
const $ = s => document.querySelector(s);
const STATUS = { pendente: "Pendente", aprovado: "Aprovado", recusado: "Recusado", concluido: "Concluído" };
const MAX_ARQ = 8 * 1024 * 1024;   // 8 MB por arquivo
const PARTE = 900000;              // caracteres base64 por documento (limite do Firestore é 1 MB)

const brl = n => (typeof n === "number" && isFinite(n)) ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
function parseBRL(s) {
  if (!s) return null;
  s = String(s).replace(/[^\d,.-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}
const fdata = iso => { if (!iso) return "—"; const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso); return isNaN(d) ? "—" : d.toLocaleDateString("pt-BR"); };
const fdh = iso => { const d = new Date(iso); return isNaN(d) ? "—" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); };
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else e.setAttribute(k, v);
  }
  kids.flat().forEach(k => k != null && e.append(k));
  return e;
}
function setMsg(node, texto, tipo = "") { node.className = "msg " + tipo; node.textContent = texto; }

/* ---------- configuração ---------- */
const configOk = firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes("COLE_AQUI");
$("#carregando").hidden = true;
if (!configOk) {
  $("#sem-config").hidden = false;
  throw new Error("firebase-config.js não preenchido");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
// App secundário: cria logins sem desconectar o administrador.
const appCadastro = initializeApp(firebaseConfig, "cadastro");
const authCadastro = getAuth(appCadastro);

let eu = null;        // usuário do Firebase
let perfil = null;    // documento em /usuarios
let ehAdmin = false;
let minhas = [], todas = [], pastores = [];
let filtro = "pendente", filtroPredio = "";
let desligar = [];

/* ---------- telas ---------- */
function tela(nome) {
  for (const id of ["view-login", "view-bloqueado", "view-app"]) $("#" + id).hidden = id !== nome;
}
function aba(view) {
  document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected", t.dataset.view === view));
  document.querySelectorAll(".view").forEach(v => v.hidden = v.id !== "view-" + view);
}
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => aba(t.dataset.view)));

/* ---------- login ---------- */
const msgLogin = $("#login-msg");
$("#form-login").addEventListener("submit", async ev => {
  ev.preventDefault();
  const email = $("#login-email").value.trim(), senha = $("#login-senha").value;
  if (!email || !senha) { setMsg(msgLogin, "Informe e-mail e senha.", "err"); return; }
  $("#btn-entrar").disabled = true; setMsg(msgLogin, "Entrando…");
  try {
    await signInWithEmailAndPassword(auth, email, senha);
    setMsg(msgLogin, "");
  } catch (e) {
    const c = e.code || "";
    setMsg(msgLogin,
      c.includes("too-many-requests") ? "Muitas tentativas. Aguarde alguns minutos e tente de novo."
      : c.includes("network") ? "Sem conexão. Verifique a internet."
      : "E-mail ou senha incorretos.", "err");
  } finally { $("#btn-entrar").disabled = false; }
});
$("#esqueci").addEventListener("click", async () => {
  const email = $("#login-email").value.trim();
  if (!email) { setMsg(msgLogin, "Digite seu e-mail no campo acima e clique de novo em Esqueci minha senha.", "err"); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    setMsg(msgLogin, "Se o e-mail estiver cadastrado, você vai receber um link para criar uma nova senha. Confira também o spam.", "ok");
  } catch { setMsg(msgLogin, "Não foi possível enviar o e-mail agora. Tente de novo.", "err"); }
});
$("#sair").addEventListener("click", () => { try { limparSelfie(); } catch {} signOut(auth); });

onAuthStateChanged(auth, async user => {
  desligar.forEach(f => f()); desligar = [];
  minhas = []; todas = []; pastores = [];
  eu = user; perfil = null; ehAdmin = false;
  $("#who").hidden = !user;
  if (!user) { tela("view-login"); return; }
  $("#who-name").textContent = user.email;
  try {
    const snap = await getDoc(doc(db, "usuarios", user.uid));
    perfil = snap.exists() ? snap.data() : null;
  } catch { perfil = null; }
  if (!perfil || perfil.ativo !== true) {
    $("#bloqueado-msg").textContent = perfil
      ? "Seu acesso está bloqueado. Fale com o Departamento Financeiro."
      : "Seu login ainda não foi liberado pelo Departamento Financeiro. Fale com o financeiro para ativar seu acesso.";
    tela("view-bloqueado"); return;
  }
  ehAdmin = perfil.papel === "admin";
  $("#who-name").textContent = perfil.nome || user.email;
  document.querySelectorAll(".admin-only").forEach(e => e.hidden = !ehAdmin);
  if (perfil.nome) $("#solicitante").value = perfil.nome;
  if (perfil.predio) $("#predio").value = perfil.predio;
  tela("view-app");
  mostrarAviso();
  iniciarDados();
  aba(ehAdmin ? "painel" : "nova");
});

/* ---------- aviso de boas-vindas (a cada acesso) ---------- */
function mostrarAviso() {
  const a = $("#aviso");
  a.hidden = false;
  document.body.style.overflow = "hidden";
  $("#aviso-ok").focus();
}
$("#aviso-ok").addEventListener("click", () => {
  $("#aviso").hidden = true;
  document.body.style.overflow = "";
});

/* ---------- dados ao vivo ---------- */
function iniciarDados() {
  const erro = () => {};
  renderMinhas();
  desligar.push(onSnapshot(query(collection(db, "solicitacoes"), where("uid", "==", eu.uid)), q => {
    minhas = q.docs.map(d => ({ ...d.data(), id: d.id })); renderMinhas();
  }, erro));
  if (ehAdmin) {
    renderPainel(); renderPastores();
    desligar.push(onSnapshot(collection(db, "solicitacoes"), q => {
      todas = q.docs.map(d => ({ ...d.data(), id: d.id })); renderPainel();
    }, erro));
    desligar.push(onSnapshot(collection(db, "usuarios"), q => {
      pastores = q.docs.map(d => ({ ...d.data(), uid: d.id })); renderPastores();
    }, erro));
  }
}

/* ---------- arquivos (guardados em partes no Firestore) ---------- */
function paraBase64(blob) {
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] || "");
    r.onerror = falha;
    r.readAsDataURL(blob);
  });
}
async function comprimirImagem(file) {
  const img = await createImageBitmap(file);
  const max = 2000, k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return await new Promise(ok => c.toBlob(ok, "image/jpeg", 0.8));
}
async function salvarArquivo(file) {
  let blob = file, tipo = file.type || "application/octet-stream";
  if (tipo.startsWith("image/") && file.size > 1.5 * 1024 * 1024) {
    try { blob = await comprimirImagem(file); tipo = "image/jpeg"; } catch { blob = file; }
  }
  if (blob.size > MAX_ARQ) throw { code: "arquivo-grande", nome: file.name };
  const b64 = await paraBase64(blob);
  const partes = [];
  for (let i = 0; i < b64.length; i += PARTE) partes.push(b64.slice(i, i + PARTE));
  const ref = doc(collection(db, "arquivos"));
  await setDoc(ref, { uid: eu.uid, nome: file.name, tipo, tamanho: blob.size, partes: partes.length, criadoEm: new Date().toISOString() });
  for (let i = 0; i < partes.length; i++) {
    await setDoc(doc(db, "arquivos", ref.id, "partes", String(i)), { uid: eu.uid, dados: partes[i] });
  }
  return { id: ref.id, nome: file.name };
}
async function abrirArquivo(info, botao) {
  const janela = window.open("", "_blank");
  const txt = botao.textContent; botao.textContent = "Abrindo…"; botao.disabled = true;
  try {
    const meta = (await getDoc(doc(db, "arquivos", info.id))).data();
    let b64 = "";
    for (let i = 0; i < meta.partes; i++) {
      b64 += (await getDoc(doc(db, "arquivos", info.id, "partes", String(i)))).data().dados;
    }
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: meta.tipo }));
    if (janela) janela.location = url;
    else { const a = el("a", { href: url, download: meta.nome }); document.body.append(a); a.click(); a.remove(); }
  } catch {
    if (janela) janela.close();
    alert("Não foi possível abrir o arquivo.");
  } finally { botao.textContent = txt; botao.disabled = false; }
}
function linkArquivo(info, rotulo) {
  const b = el("button", { class: "link", type: "button", text: info.nome || rotulo });
  b.addEventListener("click", () => abrirArquivo(info, b));
  return b;
}

const cacheImg = new Map();
async function urlArquivo(info) {
  if (cacheImg.has(info.id)) return cacheImg.get(info.id);
  const p = (async () => {
    const meta = (await getDoc(doc(db, "arquivos", info.id))).data();
    let b64 = "";
    for (let i = 0; i < meta.partes; i++) b64 += (await getDoc(doc(db, "arquivos", info.id, "partes", String(i)))).data().dados;
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: meta.tipo }));
  })();
  cacheImg.set(info.id, p);
  p.catch(() => cacheImg.delete(info.id));
  return p;
}
function ampliar(src) {
  const z = el("div", { class: "zoom", role: "dialog", "aria-label": "Selfie ampliada" }, el("img", { src, alt: "Selfie ampliada" }));
  z.addEventListener("click", () => z.remove());
  document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { z.remove(); document.removeEventListener("keydown", esc); } });
  document.body.append(z);
}
function blocoSelfie(r) {
  const s = r.selfie;
  if (!s?.id) return el("div", { class: "proto", text: "Sem selfie (pedido enviado antes da exigência)" });
  const img = el("img", { alt: "Selfie de " + (r.solicitante || "solicitante") });
  urlArquivo(s).then(u => { img.src = u; img.addEventListener("click", () => ampliar(u)); }).catch(() => { img.alt = "Não foi possível carregar a selfie"; });
  const modo = s.modo === "camera" ? "Tirada pela câmera do site" : "Tirada pela câmera do celular";
  return el("div", { class: "req-selfie" }, img, el("div", { class: "proto", text: `Selfie · ${fdh(s.tiradaEm)} · ${modo}` }));
}

/* ---------- cartão de solicitação ---------- */
function cartao(r, { admin = false, minha = false } = {}) {
  const st = r.status || "pendente";
  const pag = r.tipo === "pagamento";
  const linhas = [];
  const add = (k, v) => { if (v != null && v !== "") linhas.push(el("dt", { text: k }), el("dd", { text: v })); };
  add("Prédio", r.predio); add("Solicitante", r.solicitante); add("Contato", r.contato);
  if (pag) {
    add("Favorecido", r.favorecido); add("CPF/CNPJ", r.doc); add("Vencimento", fdata(r.vencimento));
    add("Forma", r.forma); add("Categoria", r.categoria); add("Dados", r.dadosPag); add("Finalidade", r.finalidade);
  } else {
    add("Nome do cartão", r.nomeCartao || r.titular); add("Categoria", r.categoria);
    // campos de pedidos antigos, se existirem
    add("Final do cartão", r.final); if (r.limAtual != null) add("Limite atual", brl(r.limAtual)); add("Justificativa", r.justificativa);
  }
  add("Enviado em", fdh(r.criadoEm));
  const dl = el("dl", {}, linhas);
  if (pag) dl.append(el("dt", { text: "Nota fiscal" }), r.notaFiscal?.id ? el("dd", {}, linkArquivo(r.notaFiscal, "Abrir nota fiscal")) : el("dd", { text: "Ainda não enviada" }));
  if (r.anexo?.id) dl.append(el("dt", { text: "Boleto / orçamento" }), el("dd", {}, linkArquivo(r.anexo, "Abrir anexo")));

  const c = el("article", { class: "req s-" + st },
    el("div", { class: "req-top" },
      el("div", {}, el("h3", { text: pag ? "Pagamento" : "Limite de cartão" }), el("div", { class: "proto", text: r.protocolo || "" })),
      el("span", { class: "amount", text: brl(pag ? r.valor : r.limNovo) }),
      el("span", { class: "pill", text: STATUS[st] })),
    dl);
  if (admin) c.append(blocoSelfie(r));
  if (r.obsFinanceiro) c.append(el("div", { class: "obs" }, el("b", { text: "Financeiro: " }), document.createTextNode(r.obsFinanceiro)));
  if (r.decididoEm && st !== "pendente") c.append(el("div", { class: "proto", text: "Atualizado em " + fdh(r.decididoEm) }));
  if (admin) c.append(caixaDecisao(r));
  if (minha && pag && !r.notaFiscal?.id && st !== "recusado") c.append(caixaNota(r));
  return c;
}

function caixaDecisao(r) {
  const st = r.status || "pendente", id = "obs-" + r.id;
  const ta = el("textarea", { id, class: "short", placeholder: "Observação para o pastor (opcional)" });
  ta.value = r.obsFinanceiro || "";
  const msg = el("span", { class: "msg", role: "status" });
  const botao = (rotulo, status, cls = "") => {
    const b = el("button", { class: "btn sm " + cls, type: "button", text: rotulo });
    b.addEventListener("click", async () => {
      b.disabled = true; setMsg(msg, "Salvando…");
      try {
        await updateDoc(doc(db, "solicitacoes", r.id), { status, obsFinanceiro: ta.value.trim(), decididoEm: new Date().toISOString(), decididoPor: eu.uid });
        setMsg(msg, "Salvo", "ok");
      } catch { setMsg(msg, "Não foi possível salvar. Tente de novo.", "err"); b.disabled = false; }
    });
    return b;
  };
  const bs = [];
  if (st === "pendente") bs.push(botao("Aprovar", "aprovado"), botao("Recusar", "recusado", "danger"));
  else if (st === "aprovado") bs.push(botao(r.tipo === "pagamento" ? "Marcar como pago" : "Marcar limite ajustado", "concluido"), botao("Voltar para pendente", "pendente", "ghost"));
  else bs.push(botao("Voltar para pendente", "pendente", "ghost"));
  return el("div", { class: "decide" }, el("label", { for: id, class: "proto", text: "Resposta do financeiro" }), ta, el("div", { class: "actions" }, bs, msg));
}

function caixaNota(r) {
  const id = "nf-" + r.id;
  const inp = el("input", { type: "file", id, accept: "image/*,application/pdf,.xml" });
  const msg = el("span", { class: "msg", role: "status" });
  const b = el("button", { class: "btn sm", type: "button", text: "Enviar nota fiscal" });
  b.addEventListener("click", async () => {
    const f = inp.files[0];
    if (!f) { setMsg(msg, "Escolha o arquivo da nota fiscal.", "err"); return; }
    b.disabled = true; setMsg(msg, "Enviando…");
    try {
      const info = await salvarArquivo(f);
      await updateDoc(doc(db, "solicitacoes", r.id), { notaFiscal: info, nfEnviadaEm: new Date().toISOString() });
    } catch (e) {
      setMsg(msg, e.code === "arquivo-grande" ? "Arquivo maior que 8 MB. Envie um PDF menor ou uma foto." : "Não foi possível enviar a nota. Tente de novo.", "err");
      b.disabled = false;
    }
  });
  return el("div", { class: "decide" }, el("label", { for: id, class: "proto", text: "Anexar nota fiscal" }), inp, el("div", { class: "actions" }, b, msg));
}

/* ---------- listas ---------- */
const ordenar = arr => arr.sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));

function renderMinhas() {
  const arr = ordenar([...minhas]);
  $("#minhas-list").replaceChildren(...(arr.length
    ? arr.map(r => cartao(r, { minha: true }))
    : [el("div", { class: "empty", text: "Você ainda não enviou nenhuma solicitação. Use a aba Nova solicitação para começar." })]));
}

function renderPainel() {
  const base = todas.filter(r => !filtroPredio || r.predio === filtroPredio);
  const cnt = { pendente: 0, aprovado: 0, concluido: 0, recusado: 0 }; let totalPend = 0;
  base.forEach(r => { const s = r.status || "pendente"; cnt[s] = (cnt[s] || 0) + 1; if (s === "pendente" && r.tipo === "pagamento" && typeof r.valor === "number") totalPend += r.valor; });
  $("#summary").replaceChildren(
    el("div", {}, el("b", { text: String(cnt.pendente) }), el("span", { text: "Pendentes" })),
    el("div", {}, el("b", { text: brl(totalPend) }), el("span", { text: "Em pagamentos pendentes" })),
    el("div", {}, el("b", { text: String(cnt.aprovado) }), el("span", { text: "Aprovadas a executar" })),
    el("div", {}, el("b", { text: String(cnt.concluido) }), el("span", { text: "Concluídas" })));
  const arr = ordenar(base.filter(r => filtro === "todas" || (r.status || "pendente") === filtro));
  $("#painel-list").replaceChildren(...(arr.length
    ? arr.map(r => cartao(r, { admin: true }))
    : [el("div", { class: "empty", text: todas.length ? "Nenhuma solicitação neste filtro." : "Quando um pastor enviar uma solicitação, ela aparece aqui para você aprovar ou recusar." })]));
}
document.querySelectorAll("#filters .chip").forEach(c => c.addEventListener("click", () => {
  filtro = c.dataset.f;
  document.querySelectorAll("#filters .chip").forEach(x => x.setAttribute("aria-pressed", x === c));
  renderPainel();
}));
$("#filtro-predio").addEventListener("change", e => { filtroPredio = e.target.value; renderPainel(); });

/* ---------- nova solicitação ---------- */
const tipoAtual = () => document.querySelector('input[name="tipo"]:checked').value;
document.querySelectorAll('input[name="tipo"]').forEach(r => r.addEventListener("change", () => {
  $("#fs-pag").hidden = tipoAtual() !== "pagamento";
  $("#fs-lim").hidden = tipoAtual() !== "limite";
}));

/* ---------- selfie ---------- */
let selfieBlob = null, selfieModo = null, selfieEm = null, camera = null;
const sv = $("#selfie-video"), sf = $("#selfie-foto"), sm = $("#selfie-msg");
function pararCamera() { if (camera) { camera.getTracks().forEach(t => t.stop()); camera = null; } sv.srcObject = null; }
function estadoSelfie(estado) {
  sv.hidden = estado !== "camera"; sf.hidden = estado !== "foto"; $("#selfie-vazio").hidden = estado !== "vazio";
  $("#selfie-abrir").hidden = estado !== "vazio";
  $("#selfie-tirar").hidden = estado !== "camera";
  $("#selfie-refazer").hidden = estado !== "foto";
}
function limparSelfie() {
  pararCamera(); selfieBlob = null; selfieModo = null; selfieEm = null;
  if (sf.src) URL.revokeObjectURL(sf.src); sf.removeAttribute("src");
  $("#selfie-arquivo").value = ""; $("#selfie-alt").hidden = true; setMsg(sm, "");
  estadoSelfie("vazio");
}
async function reduzir(fonte, w, h) {
  const k = Math.min(1, 720 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext("2d").drawImage(fonte, 0, 0, c.width, c.height);
  return await new Promise(ok => c.toBlob(ok, "image/jpeg", 0.78));
}
function mostrarSelfie(blob, modo) {
  selfieBlob = blob; selfieModo = modo; selfieEm = new Date().toISOString();
  if (sf.src) URL.revokeObjectURL(sf.src);
  sf.src = URL.createObjectURL(blob);
  estadoSelfie("foto"); setMsg(sm, "Selfie pronta.", "ok");
}
$("#selfie-abrir").addEventListener("click", async () => {
  setMsg(sm, "Abrindo a câmera…");
  try {
    camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 960 } }, audio: false });
    sv.srcObject = camera; await sv.play();
    estadoSelfie("camera"); setMsg(sm, "Enquadre seu rosto e toque em Tirar selfie.");
  } catch (e) {
    pararCamera();
    $("#selfie-alt").hidden = false;
    setMsg(sm, e && e.name === "NotAllowedError"
      ? "A câmera foi bloqueada. Libere o acesso à câmera nas configurações do navegador, ou use o botão abaixo."
      : "Não foi possível abrir a câmera aqui. Use o botão abaixo para tirar a selfie.", "err");
  }
});
$("#selfie-tirar").addEventListener("click", async () => {
  if (!sv.videoWidth) { setMsg(sm, "A câmera ainda está carregando. Tente de novo.", "err"); return; }
  const c = document.createElement("canvas");
  c.width = sv.videoWidth; c.height = sv.videoHeight;
  const g = c.getContext("2d"); g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(sv, 0, 0);
  const blob = await reduzir(c, c.width, c.height);
  pararCamera(); mostrarSelfie(blob, "camera");
});
$("#selfie-refazer").addEventListener("click", () => { limparSelfie(); $("#selfie-abrir").click(); });
$("#selfie-arquivo").addEventListener("change", async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const bmp = await createImageBitmap(f);
    if (Date.now() - f.lastModified > 5 * 60 * 1000) {
      setMsg(sm, "Essa foto não é recente. Tire uma selfie agora.", "err"); e.target.value = ""; return;
    }
    mostrarSelfie(await reduzir(bmp, bmp.width, bmp.height), "arquivo");
  } catch { setMsg(sm, "Não foi possível ler a foto. Tente de novo.", "err"); }
});
estadoSelfie("vazio");

$("#form").addEventListener("submit", async ev => {
  ev.preventDefault();
  const msg = $("#form-msg");
  const tipo = tipoAtual();
  const faltando = [...document.querySelectorAll(`#solicitante,#predio,[data-req='${tipo}']`)].filter(i => !i.value.trim());
  if (faltando.length) {
    setMsg(msg, "Preencha: " + faltando.map(i => document.querySelector(`label[for="${i.id}"]`).textContent).join(", ") + ".", "err");
    faltando[0].focus(); return;
  }
  if (!selfieBlob) {
    setMsg(msg, "Tire a selfie em Confirme que é você antes de enviar.", "err");
    $("#fs-selfie").scrollIntoView({ behavior: "smooth", block: "center" }); return;
  }
  const v = s => $(s).value.trim();
  const agora = new Date();
  const sufixo = Math.random().toString(36).slice(2, 6).toUpperCase();
  const r = {
    uid: eu.uid, tipo, status: "pendente", criadoEm: agora.toISOString(),
    protocolo: "SOL-" + agora.toISOString().slice(2, 10).replace(/-/g, "") + "-" + sufixo,
    solicitante: v("#solicitante"), predio: v("#predio"), contato: v("#contato")
  };
  if (tipo === "pagamento") {
    const valor = parseBRL(v("#valor"));
    if (valor == null || valor <= 0) { setMsg(msg, "Informe um valor válido, por exemplo 1.250,00.", "err"); $("#valor").focus(); return; }
    Object.assign(r, { valor, favorecido: v("#favorecido"), doc: v("#doc"), vencimento: v("#vencimento"), forma: v("#forma"), categoria: v("#categoria"), dadosPag: v("#dadosPag"), finalidade: v("#finalidade") });
  } else {
    const limNovo = parseBRL(v("#limNovo"));
    if (limNovo == null || limNovo <= 0) { setMsg(msg, "Informe o limite desejado, por exemplo 5.000,00.", "err"); $("#limNovo").focus(); return; }
    Object.assign(r, { limNovo, nomeCartao: v("#nomeCartao"), categoria: v("#limCategoria") });
  }
  const btn = $("#enviar"); btn.disabled = true; setMsg(msg, "Enviando…");
  try {
    const sInfo = await salvarArquivo(new File([selfieBlob], "selfie.jpg", { type: "image/jpeg" }));
    r.selfie = { ...sInfo, tiradaEm: selfieEm, modo: selfieModo };
    if (tipo === "pagamento") {
      const nf = $("#nf").files[0], an = $("#anexo").files[0];
      if (nf) r.notaFiscal = await salvarArquivo(nf);
      if (an) r.anexo = await salvarArquivo(an);
    }
    await setDoc(doc(collection(db, "solicitacoes")), r);
    ["#favorecido", "#doc", "#valor", "#vencimento", "#dadosPag", "#finalidade", "#nf", "#anexo", "#nomeCartao", "#limNovo"].forEach(s => $(s).value = "");
    limparSelfie();
    setMsg(msg, `Solicitação ${r.protocolo} enviada. Acompanhe em Minhas solicitações.`, "ok");
  } catch (e) {
    setMsg(msg, e.code === "arquivo-grande" ? `O arquivo ${e.nome} passa de 8 MB. Envie um PDF menor ou uma foto.` : "Não foi possível enviar. Verifique a internet e tente de novo.", "err");
  } finally { btn.disabled = false; }
});

/* ---------- pastores (somente administrador) ---------- */
$("#gerar-senha").addEventListener("click", () => {
  const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const a = new Uint32Array(10); crypto.getRandomValues(a);
  $("#p-senha").value = Array.from(a, n => letras[n % letras.length]).join("");
});

$("#form-pastor").addEventListener("submit", async ev => {
  ev.preventDefault();
  const msg = $("#pastor-msg");
  const nome = $("#p-nome").value.trim(), email = $("#p-email").value.trim().toLowerCase();
  const predio = $("#p-predio").value, papel = $("#p-papel").value, senha = $("#p-senha").value;
  if (!nome || !email) { setMsg(msg, "Informe nome e e-mail.", "err"); return; }
  if (senha.length < 6) { setMsg(msg, "A senha precisa ter pelo menos 6 caracteres.", "err"); return; }
  const btn = $("#criar-pastor"); btn.disabled = true; setMsg(msg, "Criando login…");
  try {
    const cred = await createUserWithEmailAndPassword(authCadastro, email, senha);
    await setDoc(doc(db, "usuarios", cred.user.uid), { nome, email, predio, papel, ativo: true, criadoEm: new Date().toISOString(), criadoPor: eu.uid });
    await signOut(authCadastro);
    setMsg(msg, `Login criado para ${nome}. Passe o e-mail e a senha provisória para ele.`, "ok");
    ["#p-nome", "#p-email", "#p-senha"].forEach(s => $(s).value = "");
  } catch (e) {
    const c = e.code || "";
    setMsg(msg,
      c.includes("email-already-in-use") ? "Esse e-mail já tem login. Procure-o na lista abaixo."
      : c.includes("invalid-email") ? "E-mail inválido."
      : c.includes("weak-password") ? "Senha fraca. Use pelo menos 6 caracteres."
      : "Não foi possível criar o login. Tente de novo.", "err");
  } finally { btn.disabled = false; }
});

function renderPastores() {
  const arr = [...pastores].sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR"));
  $("#pastores-list").replaceChildren(...(arr.length ? arr.map(p => {
    const msg = el("span", { class: "msg", role: "status" });
    const ativo = p.ativo === true;
    const souEu = p.uid === eu.uid;
    const bAtivo = el("button", { class: "btn sm " + (ativo ? "danger" : ""), type: "button", text: ativo ? "Bloquear acesso" : "Liberar acesso" });
    bAtivo.disabled = souEu;
    bAtivo.addEventListener("click", async () => {
      bAtivo.disabled = true;
      try { await updateDoc(doc(db, "usuarios", p.uid), { ativo: !ativo }); }
      catch { setMsg(msg, "Não foi possível alterar.", "err"); bAtivo.disabled = false; }
    });
    const bSenha = el("button", { class: "btn sm ghost", type: "button", text: "Enviar troca de senha" });
    bSenha.addEventListener("click", async () => {
      try { await sendPasswordResetEmail(auth, p.email); setMsg(msg, "E-mail de troca de senha enviado.", "ok"); }
      catch { setMsg(msg, "Não foi possível enviar.", "err"); }
    });
    const selPredio = el("select", { class: "sel-sm", "aria-label": "Prédio de " + (p.nome || p.email) },
      ["", "Videira das Américas", "Várzea Grande", "Pedra 90", "Araés", "Outro"].map(o => el("option", { value: o, text: o || "Sem prédio" })));
    selPredio.value = p.predio || "";
    selPredio.addEventListener("change", async () => {
      try { await updateDoc(doc(db, "usuarios", p.uid), { predio: selPredio.value }); setMsg(msg, "Prédio atualizado.", "ok"); }
      catch { setMsg(msg, "Não foi possível alterar.", "err"); }
    });
    return el("article", { class: "req " + (ativo ? "s-ativo" : "s-bloqueado") },
      el("div", { class: "req-top" },
        el("div", {}, el("h3", { text: p.nome || p.email }), el("div", { class: "proto", text: p.email || "" })),
        el("span", { class: "pill", text: (p.papel === "admin" ? "Financeiro" : "Pastor") + " · " + (ativo ? "Ativo" : "Bloqueado") })),
      el("div", { class: "actions" }, selPredio, bSenha, bAtivo, msg));
  }) : [el("div", { class: "empty", text: "Nenhum login cadastrado ainda. Use o formulário acima para criar o primeiro." })]));
}
