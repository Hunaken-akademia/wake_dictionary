
import "./style.css";

const app = document.querySelector("#app");
const DATA_ROOT = "/data";
const state = {
  index: [],
  reverseCatalog: null,
  rankingCatalog: null,
  generatedAt: null,
};

const KIMARITE = [
  ["逃げ", "nige"],
  ["差し", "sashi"],
  ["まくり", "makuri"],
  ["まくり差し", "makurizashi"],
  ["抜き", "nuki"],
  ["恵まれ", "megumare"],
];

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const fmt = (v, d = 1) => Number.isFinite(Number(v)) ? Number(v).toFixed(d) : "—";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const placeNames = {
  1:"桐生",2:"戸田",3:"江戸川",4:"平和島",5:"多摩川",6:"浜名湖",7:"蒲郡",8:"常滑",
  9:"津",10:"三国",11:"びわこ",12:"住之江",13:"尼崎",14:"鳴門",15:"丸亀",16:"児島",
  17:"宮島",18:"徳山",19:"下関",20:"若松",21:"芦屋",22:"福岡",23:"唐津",24:"大村"
};

async function getJson(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

function shell(content) {
  app.innerHTML = `
    <header class="header">
      <div class="shell header-inner">
        <a class="brand" href="#/">
          <span class="brand-mark">W</span>
          <span>WAKE辞典<small>RACER DATA DICTIONARY</small></span>
        </a>
        <nav class="nav">
          <button data-nav="home">トップ</button>
          <button data-nav="reverse">逆引き検索</button>
          <button data-nav="ranking">ランキング</button>
        </nav>
      </div>
    </header>
    <main>${content}</main>
    <footer class="footer shell">WAKE辞典 / Official K-ticket derived statistics</footer>
  `;
  $$("[data-nav]").forEach(b => b.addEventListener("click", () => {
    const v = b.dataset.nav;
    location.hash = v === "home" ? "#/" : `#/${v}`;
  }));
}

function hero() {
  return `
    <section class="hero shell">
      <div class="kicker">DATA, NOT IMPRESSION</div>
      <h1>WAKE辞典</h1>
      <p>選手ごとのコース別成績・場別成績・勝ち方の傾向を、母数と補正値まで含めて確認できる競艇データ辞典。</p>
      <div class="search-wrap">
        <input id="racerSearch" class="search" placeholder="選手名・登録番号で検索" autocomplete="off" />
        <div id="suggestions" class="suggestions"></div>
      </div>
      <div class="status-row">
        <span class="badge">${state.index.length.toLocaleString()}選手</span>
        <span class="badge">毎晩更新</span>
        <span class="badge">補正値＋実測値</span>
        ${state.generatedAt ? `<span class="badge">更新 ${esc(state.generatedAt)}</span>` : ""}
      </div>
    </section>`;
}

function featureCards() {
  return `
    <section class="shell grid">
      <article class="card"><div class="icon">⌕</div><h3>逆引き検索</h3><p>コース・決まり手・級別・最低走数から、条件に合う選手を補正値順で探す。</p><button data-go="reverse">条件から探す →</button></article>
      <article class="card"><div class="icon">↗</div><h3>ランキング</h3><p>B級の刺客、まくり職人、イン不安定、ダッシュ巧者などを事前集計。</p><button data-go="ranking">ランキングを見る →</button></article>
      <article class="card"><div class="icon">◎</div><h3>選手詳細</h3><p>1〜6コース別の1着率・2連対率・3連対率・平均ST、場別成績、決まり手を確認。</p><button data-focus-search>選手を検索 →</button></article>
    </section>`;
}

function bindSearch() {
  const input = $("#racerSearch");
  const box = $("#suggestions");
  if (!input || !box) return;

  const render = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { box.classList.remove("show"); return; }
    const rows = state.index.filter(r =>
      String(r.regno).includes(q) ||
      String(r.name || "").toLowerCase().includes(q)
    ).slice(0, 8);
    if (!rows.length) {
      box.innerHTML = `<div class="empty">該当する選手が見つかりません</div>`;
    } else {
      box.innerHTML = rows.map(r => `
        <button class="suggestion" data-regno="${r.regno}">
          <span><strong>${esc(r.name)}</strong> <span class="meta">#${r.regno}</span></span>
          <span class="meta">${esc(r.grade || "—")}・${esc(r.branch || "—")}</span>
        </button>`).join("");
    }
    box.classList.add("show");
    $$("[data-regno]", box).forEach(b => b.addEventListener("click", () => {
      location.hash = `#/racer/${b.dataset.regno}`;
    }));
  };
  input.addEventListener("input", render);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      const first = $("[data-regno]", box);
      if (first) location.hash = `#/racer/${first.dataset.regno}`;
    }
  });
  document.addEventListener("click", e => {
    if (!e.target.closest(".search-wrap")) box.classList.remove("show");
  }, { once: true });
}

function bindHome() {
  $$("[data-go]").forEach(b => b.addEventListener("click", () => location.hash = `#/${b.dataset.go}`));
  $("[data-focus-search]")?.addEventListener("click", () => $("#racerSearch")?.focus());
  bindSearch();
}

async function renderHome() {
  shell(hero() + featureCards());
  bindHome();
}

function reverseFilters() {
  return `
    <section class="section shell">
      <div class="section-title"><div><div class="kicker">REVERSE LOOKUP</div><h2>条件から選手を探す</h2></div><p>既定：30走以上 / 補正値順</p></div>
      <div class="filters">
        <div class="field"><label>コース</label><select id="course">${[1,2,3,4,5,6].map(v=>`<option value="${v}">${v}コース</option>`).join("")}</select></div>
        <div class="field"><label>決まり手</label><select id="kimarite">${KIMARITE.map(([n,s])=>`<option value="${s}" data-name="${n}">${n}</option>`).join("")}</select></div>
        <div class="field"><label>級別</label><select id="grade"><option value="ALL">全国</option><option>A1</option><option>A2</option><option>B1</option><option>B2</option></select></div>
        <div class="field"><label>最低走数</label><input id="minN" type="number" min="1" value="30" /></div>
      </div>
      <div id="reverseResult" class="table-wrap"><div class="empty">条件を読み込み中…</div></div>
      <div class="notice">順位は補正値で並べています。実測値だけでなく母数(n)と基準値を併記します。</div>
    </section>`;
}

async function loadReverse() {
  const c = Number($("#course").value);
  const slug = $("#kimarite").value;
  const name = $("#kimarite").selectedOptions[0].dataset.name;
  const grade = $("#grade").value;
  const minN = Math.max(1, Number($("#minN").value || 30));
  const box = $("#reverseResult");
  box.innerHTML = `<div class="empty">読み込み中…</div>`;
  try {
    const data = await getJson(`${DATA_ROOT}/index/reverse_course${c}_${slug}_${grade}.json`);
    const rows = (data.rows || []).filter(r => Number(r.n) >= minN);
    box.innerHTML = rows.length ? `
      <table><thead><tr><th>#</th><th>選手</th><th>級別</th><th>支部</th><th>母数</th><th>${esc(name)}1着</th><th>実測</th><th>補正</th><th>基準差</th></tr></thead>
      <tbody>${rows.slice(0,200).map((r,i)=>`
        <tr data-open="${r.regno}"><td class="rank">${i+1}</td><td><strong>${esc(r.name)}</strong><div class="meta">#${r.regno}</div></td><td>${esc(r.grade||"—")}</td><td>${esc(r.branch||"—")}</td><td>${r.n}</td><td>${r.count}</td><td>${fmt(r.rawRate)}%</td><td class="rate">${fmt(r.adjRate)}%</td><td class="${Number(r.diffPtAdjusted)>=0?"pos":"neg"}">${Number(r.diffPtAdjusted)>=0?"+":""}${fmt(r.diffPtAdjusted)}pt</td></tr>`).join("")}</tbody></table>`
      : `<div class="empty">条件に該当する選手はいません</div>`;
    $$("[data-open]", box).forEach(tr => tr.addEventListener("click", () => location.hash = `#/racer/${tr.dataset.open}`));
  } catch (e) {
    box.innerHTML = `<div class="empty error">データを読み込めませんでした：${esc(e.message)}</div>`;
  }
}

async function renderReverse() {
  shell(reverseFilters());
  ["course","kimarite","grade","minN"].forEach(id => $(`#${id}`).addEventListener("change", loadReverse));
  $("#minN").addEventListener("input", () => clearTimeout(window.__rn) || (window.__rn=setTimeout(loadReverse,200)));
  loadReverse();
}

const rankingDefs = [
  ["ranking_b_attackers.json","B級の刺客"],
  ["ranking_makuri_B1.json","B1 まくり職人"],
  ["ranking_sashi_B1.json","B1 差し名人"],
  ["ranking_in_unstable_A1.json","A1 イン不安定"],
  ["ranking_dash_B1.json","B1 ダッシュ巧者"],
  ["ranking_start_no_f_A1.json","A1 スタート巧者（Fなし）"],
  ["ranking_start_no_f_B1.json","B1 スタート巧者（Fなし）"],
];

function rankingView() {
  return `
    <section class="section shell">
      <div class="section-title"><div><div class="kicker">RANKINGS</div><h2>WAKEランキング</h2></div><p>補正値順 / 母数を必ず表示</p></div>
      <div class="filters" style="grid-template-columns:2fr 1fr 1fr 1fr">
        <div class="field"><label>ランキング</label><select id="rankingFile">${rankingDefs.map(([f,n])=>`<option value="${f}">${n}</option>`).join("")}</select></div>
        <div class="field"><label>最低走数</label><input id="rankMinN" type="number" min="1" value="30"></div>
        <div class="field"><label>&nbsp;</label><button class="primary" id="rankReload">表示</button></div>
      </div>
      <div id="rankingResult" class="table-wrap"><div class="empty">読み込み中…</div></div>
    </section>`;
}

async function loadRanking() {
  const file = $("#rankingFile").value;
  const minN = Math.max(1, Number($("#rankMinN").value || 30));
  const box = $("#rankingResult");
  try {
    const data = await getJson(`${DATA_ROOT}/index/${file}`);
    const rows = (data.rows || []).filter(r => Number(r.n) >= minN);
    const isST = data.metric === "avg_st";
    box.innerHTML = rows.length ? `
      <table><thead><tr><th>#</th><th>選手</th><th>級別</th><th>支部</th><th>母数</th>${isST?`<th>実測ST</th><th>補正ST</th><th>F</th>`:`<th>実測</th><th>補正</th><th>基準差</th>`}</tr></thead>
      <tbody>${rows.slice(0,200).map((r,i)=>`
        <tr data-open="${r.regno}"><td class="rank">${i+1}</td><td><strong>${esc(r.name)}</strong><div class="meta">#${r.regno}</div></td><td>${esc(r.grade||"—")}</td><td>${esc(r.branch||"—")}</td><td>${r.n}</td>${isST?`<td>${fmt(r.avgSt,3)}</td><td class="rate">${fmt(r.adjustedSt,3)}</td><td>${r.f_count ?? 0}</td>`:`<td>${fmt(r.rawRate)}%</td><td class="rate">${fmt(r.adjRate)}%</td><td class="${Number(r.diffPtAdjusted)>=0?"pos":"neg"}">${Number(r.diffPtAdjusted)>=0?"+":""}${fmt(r.diffPtAdjusted)}pt</td>`}</tr>`).join("")}</tbody></table>`
      : `<div class="empty">該当データなし</div>`;
    $$("[data-open]", box).forEach(tr => tr.addEventListener("click", () => location.hash = `#/racer/${tr.dataset.open}`));
  } catch(e) {
    box.innerHTML = `<div class="empty error">${esc(e.message)}</div>`;
  }
}

async function renderRanking() {
  shell(rankingView());
  $("#rankingFile").addEventListener("change", loadRanking);
  $("#rankReload").addEventListener("click", loadRanking);
  loadRanking();
}

function courseCards(rows) {
  const map = new Map((rows||[]).map(r => [Number(r.course),r]));
  return `<div class="stat-grid">${[1,2,3,4,5,6].map(c=>{
    const r=map.get(c);
    if(!r) return `<div class="stat-card"><strong>${c}コース</strong><div class="meta">データなし</div></div>`;
    const d=r.rates?.diff_pt_adjusted?.win;
    return `<div class="stat-card"><strong>${c}コース <span class="meta">n=${r.n}</span></strong>
      <dl>
        <div><dt>1着率</dt><dd>${fmt(r.rates?.raw?.win)}%</dd></div>
        <div><dt>補正1着率</dt><dd>${fmt(r.rates?.adjusted?.win)}%</dd></div>
        <div><dt>全国差</dt><dd class="${Number(d)>=0?"pos":"neg"}">${Number(d)>=0?"+":""}${fmt(d)}pt</dd></div>
        <div><dt>2連対</dt><dd>${fmt(r.rates?.raw?.ren2)}%</dd></div>
        <div><dt>3連対</dt><dd>${fmt(r.rates?.raw?.ren3)}%</dd></div>
        <div><dt>平均ST</dt><dd>${fmt(r.start?.avg_st,3)}</dd></div>
      </dl></div>`;
  }).join("")}</div>`;
}

function kimariteTable(rows) {
  const flat=[];
  for(const c of rows||[]) {
    for(const x of c.items||[]) flat.push({course:c.course,win_n:c.win_n,sufficient:c.sufficient,...x});
  }
  return flat.length ? `<div class="table-wrap"><table><thead><tr><th>コース</th><th>勝利数</th><th>決まり手</th><th>回数</th><th>実測構成比</th><th>補正構成比</th><th>全国差</th></tr></thead><tbody>${flat.map(r=>`<tr><td>${r.course}</td><td>${r.win_n}</td><td>${esc(r.kimarite)}</td><td>${r.count}</td>${r.sufficient?`<td>${fmt(r.raw_rate)}%</td><td>${fmt(r.adjusted_rate)}%</td><td class="${Number(r.diff_pt_adjusted)>=0?"pos":"neg"}">${Number(r.diff_pt_adjusted)>=0?"+":""}${fmt(r.diff_pt_adjusted)}pt</td>`:`<td colspan="3" class="meta">勝利数5未満のため率は非表示</td>`}</tr>`).join("")}</tbody></table></div>` : `<div class="empty">決まり手データなし</div>`;
}

function venueTable(rows) {
  const sorted=[...(rows||[])].sort((a,b)=>Number(b.n)-Number(a.n));
  return sorted.length ? `<div class="table-wrap"><table><thead><tr><th>場</th><th>母数</th><th>1着率</th><th>補正1着率</th><th>本人平均との差</th><th>3連対率</th><th>平均ST</th></tr></thead><tbody>${sorted.map(r=>{const d=r.rates?.diff_pt_adjusted?.win; return `<tr><td>${esc(placeNames[r.place_no]||String(r.place_no))}</td><td>${r.n}</td><td>${fmt(r.rates?.raw?.win)}%</td><td>${fmt(r.rates?.adjusted?.win)}%</td><td class="${Number(d)>=0?"pos":"neg"}">${Number(d)>=0?"+":""}${fmt(d)}pt</td><td>${fmt(r.rates?.raw?.ren3)}%</td><td>${fmt(r.start?.avg_st,3)}</td></tr>`}).join("")}</tbody></table></div>` : `<div class="empty">場別データなし</div>`;
}

async function renderRacer(regno) {
  shell(`<section class="section shell"><div class="empty">選手データを読み込み中…</div></section>`);
  try {
    const d=await getJson(`${DATA_ROOT}/racers/${regno}.json`);
    const r=d.racer||{};
    shell(`
      <section class="section shell">
        <button class="back" onclick="history.back()">← 戻る</button>
        <div class="detail-head" style="margin-top:12px">
          <div><div class="kicker">RACER PROFILE</div><h2>${esc(r.name)}</h2><div class="detail-meta">登録 ${r.regno} / ${esc(r.grade||"—")} / ${esc(r.branch||"—")} / ${d.totals?.n ?? 0}走</div></div>
          <div class="meta">集計期間 ${esc(d.data_period?.actual_start||"—")} 〜 ${esc(d.data_period?.actual_end||"—")}</div>
        </div>
        <div class="section-title" style="margin-top:28px"><h2>コース別成績</h2><p>実測値＋補正値</p></div>
        ${courseCards(d.course_stats)}
        <div class="section-title" style="margin-top:32px"><h2>勝った時の決まり手</h2><p>勝利数5未満は率非表示</p></div>
        ${kimariteTable(d.win_kimarite_breakdown)}
        <div class="section-title" style="margin-top:32px"><h2>場別成績</h2><p>本人全場平均との差</p></div>
        ${venueTable(d.venue_stats)}
      </section>`);
  } catch(e) {
    shell(`<section class="section shell"><div class="empty error">選手データを読み込めませんでした：${esc(e.message)}</div></section>`);
  }
}

async function boot() {
  try {
    const [index, baselines] = await Promise.all([
      getJson(`${DATA_ROOT}/index.json`),
      getJson(`${DATA_ROOT}/meta/baselines.json`).catch(()=>null)
    ]);
    state.index = Array.isArray(index) ? index : [];
    state.generatedAt = baselines?.generated_at ? new Date(baselines.generated_at).toLocaleString("ja-JP") : null;
  } catch (e) {
    shell(`<section class="section shell"><div class="empty error"><strong>データファイルが見つかりません。</strong><br>${esc(e.message)}<br><br>Vercelのビルドに public/data が含まれているか確認してください。</div></section>`);
    return;
  }
  route();
}

async function route() {
  const h=location.hash.replace(/^#\/?/,"");
  if (h.startsWith("racer/")) return renderRacer(h.split("/")[1]);
  if (h==="reverse") return renderReverse();
  if (h==="ranking") return renderRanking();
  return renderHome();
}

window.addEventListener("hashchange", route);
boot();
