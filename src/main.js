import "./style.css";

const app = document.querySelector("#app");
const DATA_ROOT = "/data";

const state = {
  index: [],
  generatedAt: null,
  useAdjusted: localStorage.getItem("wake_use_adjusted") !== "0",
  todayOnly: localStorage.getItem("wake_today_only") === "1",
  todayMeta: null,
  todayByRegno: new Map(),
};

const KIMARITE = [
  ["逃げ", "nige"],
  ["差し", "sashi"],
  ["まくり", "makuri"],
  ["まくり差し", "makurizashi"],
  ["抜き", "nuki"],
  ["恵まれ", "megumare"],
];

const RANKING_DESCRIPTIONS = {
  "ranking_b_attackers.json":
    "B1・B2の中から、3〜6コースの1着率がその級別の基準を上回る選手を抽出。人気薄でも外・中コースから舟券に絡む可能性がある『伏兵』を探すランキングです。",
  "ranking_makuri_B1.json":
    "B1選手のうち、「まくり」で1着になる率が高い選手を比較します。",
  "ranking_sashi_B1.json":
    "B1選手のうち、「差し」で1着になる率が高い選手を比較します。",
  "ranking_in_unstable_A1.json":
    "A1選手の1コース逃げ率を低い順に表示。少母数の偶然を避けるため、このランキングは既定50走以上です。イン戦で相手側を検討したい時の参考用です。",
  "ranking_dash_B1.json":
    "B1選手の4〜6コースにおける3連対率を比較。ダッシュ域から舟券に絡む力を見るランキングです。",
  "ranking_start_no_f_A1.json":
    "F回数0のA1選手を対象に平均STを比較。数字が小さいほど平均スタートが速いことを表します。",
  "ranking_start_no_f_B1.json":
    "F回数0のB1選手を対象に平均STを比較。数字が小さいほど平均スタートが速いことを表します。",
};

const GUIDE_ITEMS = [
  ["実測", "実際のレース結果だけから計算した値。補正を一切かけていない生のデータです。"],
  ["補正値", "母数が少ない選手を過大評価しないよう、全国平均や級別平均を加味した調整後の値です。母数が多いほど実測値に近づきます。ランキングは補正ON時、この値を基準に並べます。"],
  ["補正ON / OFF", "ONは母数を考慮した補正値を使います。OFFは実測値だけで並べ替え・表示し、補正値を使わない純粋なデータ表示になります。設定はこの端末に保存されます。"],
  ["基準値", "比較対象となる平均値。級別指定時は主に「その級別×そのコース」の平均、全国指定時は全国×コースの平均を使います。"],
  ["基準差", "補正ON時は「補正値−基準値」。プラスなら基準より高く、マイナスなら低いことを表します。補正OFF時は「実測値−基準値」を表示します。"],
  ["母数（n）", "その率や平均を計算するのに使った対象レース数。一般に母数が大きいほど、一時的な偶然の影響を受けにくくなります。"],
  ["最低走数", "母数が少なすぎる選手を一覧から除外するための条件です。既定は30走以上です。"],
  ["逆引き検索", "選手名から探すのではなく、「4コース×まくり×B1」のような条件から該当選手を探す機能です。"],
  ["B級の伏兵", "B1・B2の中で、3〜6コースの1着率がその級別の基準を上回る選手を探すランキング。人気薄でも外・中コースから舟券に絡む可能性がある選手を見つける目的です。"],
  ["まくり職人", "指定級別の中で、まくりで1着になる率が高い選手を比較します。"],
  ["差し名人", "指定級別の中で、差しで1着になる率が高い選手を比較します。"],
  ["イン最強", "1コースから逃げで1着になる率が高い選手を比較します。"],
  ["イン不安定", "1コース逃げ率が低めの選手を比較します。相手側を狙う時の参考用です。"],
  ["ダッシュ巧者", "4〜6コースからの3連対率が高い選手を比較します。"],
  ["スタート巧者", "平均STが速い選手を比較します。STは小さいほど速い数値です。"],
  ["Fなし", "集計期間内のF回数が0の選手だけに絞ったランキングです。"],
  ["決まり手", "1着になったレースの勝ち方。逃げ・差し・まくり・まくり差し・抜き・恵まれの6種類を扱います。"],
  ["意外な一面", "選手の成績から、母数を考慮した補正後でも目立つ偏りを最大3件まで自動抽出します。低母数の偶然を特徴として出さないため、この判定だけは補正OFF時でも補正値を使用します。"],
  ["まくられ耐性", "自分より外の選手が「まくり」で1着になった時に、自分が何着まで残したかを見る直近1年の実測データです。"],
  ["差され耐性", "自分より外の選手が「差し」で1着になった時に、自分が何着まで残したかを見る直近1年の実測データです。8件未満はデータ不足扱いにします。"],
  ["本日出走のみ", "本日レースに出走予定の選手だけに絞る機能です。選手検索・逆引き検索・ランキングで利用できます。出走予定は毎日の自動更新時にBOATCASTの当日出走表から取得します。"],
];

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const fmt = (v, d = 1) => Number.isFinite(Number(v)) ? Number(v).toFixed(d) : "—";
function normalizeSearchText(value) {
  return [...String(value ?? "").normalize("NFKC")]
    .map((ch) => {
      const cp = ch.codePointAt(0);
      if (cp >= 0x30A1 && cp <= 0x30F6) {
        return String.fromCodePoint(cp - 0x60);
      }
      return ch;
    })
    .join("")
    .replace(/[・･\s　]+/g, "")
    .toLowerCase();
}

const esc = (s) => String(s ?? "").replace(
  /[&<>"']/g,
  (m) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m])
);

const placeNames = {
  1:"桐生",2:"戸田",3:"江戸川",4:"平和島",5:"多摩川",6:"浜名湖",7:"蒲郡",8:"常滑",
  9:"津",10:"三国",11:"びわこ",12:"住之江",13:"尼崎",14:"鳴門",15:"丸亀",16:"児島",
  17:"宮島",18:"徳山",19:"下関",20:"若松",21:"芦屋",22:"福岡",23:"唐津",24:"大村"
};


function todayEntry(regno) {
  return state.todayByRegno.get(Number(regno)) || null;
}

function todayRaceLabel(regno) {
  const row = todayEntry(regno);
  if (!row?.entries?.length) return "";
  const byPlace = new Map();
  for (const e of row.entries) {
    const p = Number(e.place_no);
    if (!byPlace.has(p)) byPlace.set(p, []);
    byPlace.get(p).push(Number(e.race_no));
  }
  return [...byPlace.entries()].map(([p, races]) => {
    const uniq = [...new Set(races)].sort((a,b) => a-b);
    return `${placeNames[p] || `${p}場`} ${uniq.map((r)=>`${r}R`).join("・")}`;
  }).join(" / ");
}

function todayInline(regno) {
  const label = todayRaceLabel(regno);
  return label ? `<div class="today-inline">本日 ${esc(label)}</div>` : "";
}

function todayFilterControl() {
  const available = Number(state.todayMeta?.racer_count || 0) > 0;
  return `
    <label class="today-filter ${available ? "" : "disabled"}">
      <input type="checkbox" data-today-toggle ${state.todayOnly && available ? "checked" : ""} ${available ? "" : "disabled"}>
      <span class="today-check"></span>
      <span>本日出走のみ</span>
      ${available
        ? `<small>${Number(state.todayMeta.racer_count).toLocaleString()}人</small>`
        : `<small>出走情報未取得</small>`}
    </label>`;
}

function bindTodayToggle(onChange) {
  $$("[data-today-toggle]").forEach((input) => {
    input.addEventListener("change", (e) => {
      state.todayOnly = Boolean(e.target.checked);
      localStorage.setItem("wake_today_only", state.todayOnly ? "1" : "0");
      if (typeof onChange === "function") onChange();
      else route();
    });
  });
}

function keepToday(rows) {
  if (!state.todayOnly) return rows;
  return rows.filter((r) => state.todayByRegno.has(Number(r.regno)));
}

async function getJson(path) {
  const isDataPath = path.startsWith(`${DATA_ROOT}/`);
  const target = isDataPath
    ? `/api/data?path=${encodeURIComponent(path.slice(DATA_ROOT.length + 1))}`
    : path;
  const r = await fetch(target, { cache: "no-store", credentials: "same-origin" });
  if (r.status === 401) {
    renderLogin("認証の有効期限が切れました。もう一度パスワードを入力してください。");
    throw new Error("authentication required");
  }
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}


function loginMarkup(message = "") {
  return `
    <main class="login-page">
      <section class="login-card">
        <div class="brand login-brand">
          <span class="brand-mark">W</span>
          <span>WAKE辞典<small>RACER DATA DICTIONARY</small></span>
        </div>
        <div class="kicker">MEMBERS ONLY</div>
        <h1>WAKE辞典へアクセス</h1>
        <p>購入者向けパスワードを入力してください。この端末では認証状態を30日間保持します。</p>
        ${message ? `<div class="login-message">${esc(message)}</div>` : ""}
        <form id="loginForm" class="login-form">
          <input id="loginPassword" type="password" autocomplete="current-password" placeholder="パスワード" required>
          <button class="primary" type="submit">辞典を開く</button>
        </form>
        <div class="login-foot">※ パスワードの第三者共有・転載は禁止転載は禁止です。</div>
      </section>
    </main>`;
}

function renderLogin(message = "") {
  app.innerHTML = loginMarkup(message);
  const form = $("#loginForm");
  const input = $("#loginPassword");
  input?.focus();
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = input?.value || "";
    const button = form.querySelector("button");
    button.disabled = true;
    button.textContent = "確認中…";
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
        credentials: "same-origin",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        renderLogin(data?.error === "invalid_password" ? "パスワードが違います。" : "認証できませんでした。");
        return;
      }
      await boot(true);
    } catch {
      renderLogin("通信エラーが発生しました。時間をおいてもう一度お試しください。");
    }
  });
}

async function hasSession() {
  try {
    const r = await fetch("/api/session", { cache: "no-store", credentials: "same-origin" });
    return r.ok;
  } catch {
    return false;
  }
}

function guideModal() {
  return `
    <div class="modal-backdrop" id="guideModal" aria-hidden="true">
      <div class="guide-modal" role="dialog" aria-modal="true" aria-labelledby="guideTitle">
        <div class="guide-head">
          <div>
            <div class="kicker">HOW TO READ</div>
            <h2 id="guideTitle">WAKE辞典 用語ガイド</h2>
          </div>
          <button class="icon-button" data-guide-close aria-label="閉じる">×</button>
        </div>
        <div class="guide-list">
          ${GUIDE_ITEMS.map(([term, desc]) => `
            <article class="guide-item">
              <h3>${esc(term)}</h3>
              <p>${esc(desc)}</p>
            </article>
          `).join("")}
          <div class="guide-logout"><button class="back" data-logout>この端末の認証を解除</button></div>
        </div>
      </div>
    </div>`;
}

function adjustedSwitch(compact = false) {
  return `
    <label class="adjust-switch ${compact ? "compact" : ""}" title="補正値の使用を切り替えます">
      <span class="adjust-label">補正</span>
      <input type="checkbox" data-adjust-toggle ${state.useAdjusted ? "checked" : ""}>
      <span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span>
      <span class="adjust-state">${state.useAdjusted ? "ON" : "OFF"}</span>
    </label>`;
}

function shell(content) {
  app.innerHTML = `
    <header class="header">
      <div class="shell header-inner">
        <a class="brand" href="#/">
          <span class="brand-mark">W</span>
          <span>WAKE辞典<small>RACER DATA DICTIONARY</small></span>
        </a>
        <div class="header-actions">
          <nav class="nav">
            <button data-nav="home">トップ</button>
            <button data-nav="reverse">逆引き検索</button>
            <button data-nav="ranking">ランキング</button>
          </nav>
          <button class="guide-button" data-guide-open>？ 用語</button>
          ${adjustedSwitch(true)}
        </div>
      </div>
    </header>
    <main>${content}</main>
    <footer class="footer shell">WAKE辞典 / Official K-ticket derived statistics</footer>
    ${guideModal()}
  `;

  $$("[data-nav]").forEach((b) => b.addEventListener("click", () => {
    const v = b.dataset.nav;
    location.hash = v === "home" ? "#/" : `#/${v}`;
  }));

  bindGlobalControls();
}

function bindGlobalControls() {
  $$("[data-adjust-toggle]").forEach((input) => {
    input.addEventListener("change", (e) => {
      state.useAdjusted = Boolean(e.target.checked);
      localStorage.setItem("wake_use_adjusted", state.useAdjusted ? "1" : "0");
      route();
    });
  });

  $$("[data-guide-open]").forEach((b) => b.addEventListener("click", openGuide));
  $$("[data-guide-close]").forEach((b) => b.addEventListener("click", closeGuide));
  $$("[data-logout]").forEach((b) => b.addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    localStorage.removeItem("wake_today_only");
    renderLogin("この端末の認証を解除しました。");
  }));

  $("#guideModal")?.addEventListener("click", (e) => {
    if (e.target.id === "guideModal") closeGuide();
  });
}

function openGuide() {
  const modal = $("#guideModal");
  if (!modal) return;
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeGuide() {
  const modal = $("#guideModal");
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function modeText() {
  return state.useAdjusted ? "補正ON：母数を考慮" : "補正OFF：実測データのみ";
}

function hero() {
  return `
    <section class="hero shell">
      <div class="kicker">DATA, NOT IMPRESSION</div>
      <h1>WAKE辞典</h1>
      <p>選手ごとのコース別成績・場別成績・勝ち方の傾向を、母数まで含めて確認できる競艇データ辞典。補正はいつでもON/OFFできます。</p>
      <div class="search-wrap">
        <input id="racerSearch" class="search" placeholder="選手名・登録番号で検索" autocomplete="off" />
        <div class="search-tools">
          ${todayFilterControl()}
          <span class="search-hint">かな検索は公式読みデータ取得後に対応</span>
        </div>
        <div id="suggestions" class="suggestions"></div>
      </div>
      <div class="status-row">
        <span class="badge">${state.index.length.toLocaleString()}選手</span>
        <span class="badge">毎晩更新</span>
        <span class="badge mode-badge">${modeText()}</span>
        ${state.generatedAt ? `<span class="badge">更新 ${esc(state.generatedAt)}</span>` : ""}
        <button class="badge badge-button" data-guide-open>用語の意味を見る</button>
      </div>
    </section>`;
}

function featureCards() {
  return `
    <section class="shell grid">
      <article class="card">
        <div class="icon">⌕</div>
        <h3>逆引き検索</h3>
        <p>コース・決まり手・級別・最低走数から、条件に合う選手を探す。補正ONなら補正値順、OFFなら実測値順。</p>
        <button data-go="reverse">条件から探す →</button>
      </article>
      <article class="card">
        <div class="icon">↗</div>
        <h3>B級の伏兵などのランキング</h3>
        <p>B級の伏兵、まくり職人、イン不安定、ダッシュ巧者などを事前集計。名前の意味は用語ガイドで確認できます。</p>
        <button data-go="ranking">ランキングを見る →</button>
      </article>
      <article class="card">
        <div class="icon">◎</div>
        <h3>選手詳細</h3>
        <p>1〜6コース別の1着率・2連対率・3連対率・平均ST、場別成績、決まり手を確認。</p>
        <button data-focus-search>選手を検索 →</button>
      </article>
    </section>`;
}

function bindSearch() {
  const input = $("#racerSearch");
  const box = $("#suggestions");
  if (!input || !box) return;

  const render = () => {
    const q = normalizeSearchText(input.value);

    if (!q) {
      box.classList.remove("show");
      box.innerHTML = "";
      return;
    }

    const rows = keepToday(state.index).filter((r) =>
      normalizeSearchText(r.regno).includes(q) ||
      normalizeSearchText(r.name).includes(q) ||
      normalizeSearchText(r.kana || r.kana_katakana || r.reading).includes(q)
    ).slice(0, 8);

    box.innerHTML = rows.length
      ? rows.map((r) => `
          <button class="suggestion" data-regno="${r.regno}">
            <span class="suggestion-main">
              <strong>${esc(r.name)}</strong>
              <span class="meta">#${r.regno}</span>
              ${r.kana ? `<span class="kana-inline">${esc(r.kana)}</span>` : ""}
              ${todayInline(r.regno)}
            </span>
            <span class="meta">${esc(r.grade || "—")}・${esc(r.branch || "—")}</span>
          </button>
        `).join("")
      : `<div class="empty">${state.todayOnly ? "本日出走予定の選手に該当なし" : "該当する選手が見つかりません"}</div>`;

    box.classList.add("show");

    $$("[data-regno]", box).forEach((b) => b.addEventListener("click", () => {
      location.hash = `#/racer/${b.dataset.regno}`;
    }));
  };

  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = $("[data-regno]", box);
      if (first) location.hash = `#/racer/${first.dataset.regno}`;
    }
  });

  bindTodayToggle(render);
}

function bindHome() {
  $$("[data-go]").forEach((b) => b.addEventListener("click", () => {
    location.hash = `#/${b.dataset.go}`;
  }));
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
      <div class="section-title">
        <div>
          <div class="kicker">REVERSE LOOKUP</div>
          <h2>条件から選手を探す</h2>
        </div>
        <p>${state.useAdjusted ? "既定30走以上 / 補正値順" : "既定30走以上 / 実測値順"}</p>
      </div>

      <div class="mode-panel">
        <div>
          <strong>${modeText()}</strong>
          <p>${state.useAdjusted
            ? "母数が少ない選手を過大評価しにくい補正値で比較します。"
            : "補正を一切使わず、実際に起きた率だけで比較します。"}</p>
        </div>
        ${adjustedSwitch()}
      </div>

      <div class="filters">
        <div class="field">
          <label>コース</label>
          <select id="course">${[1,2,3,4,5,6].map((v)=>`<option value="${v}">${v}コース</option>`).join("")}</select>
        </div>
        <div class="field">
          <label>決まり手</label>
          <select id="kimarite">${KIMARITE.map(([n,s])=>`<option value="${s}" data-name="${n}">${n}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label>級別</label>
          <select id="grade"><option value="ALL">全国</option><option>A1</option><option>A2</option><option>B1</option><option>B2</option></select>
        </div>
        <div class="field">
          <label>最低走数 <button class="mini-help" data-guide-open type="button">?</button></label>
          <input id="minN" type="number" min="1" value="30" />
        </div>
      </div>

      <div class="sub-filter-row">
        ${todayFilterControl()}
        ${state.todayOnly ? `<span class="sub-filter-note">本日の出走予定選手だけに絞り込み中</span>` : ""}
      </div>

      <div id="reverseResult" class="table-wrap"><div class="empty">条件を読み込み中…</div></div>

      <div class="notice">
        <strong>実測</strong>＝生の結果、<strong>母数(n)</strong>＝対象レース数。
        ${state.useAdjusted
          ? "<strong>補正</strong>＝母数を考慮した調整値、<strong>基準差</strong>＝補正値と基準値の差。"
          : "<strong>補正OFF</strong>では補正値を使わず、実測値と実測ベースの基準差だけを表示します。"}
        <button class="text-link" data-guide-open>詳しい説明</button>
      </div>
    </section>`;
}

function sortReverseRows(rows) {
  const out = [...rows];
  if (state.useAdjusted) {
    out.sort((a, b) =>
      Number(b.adjRate ?? -Infinity) - Number(a.adjRate ?? -Infinity) ||
      Number(b.rawRate ?? -Infinity) - Number(a.rawRate ?? -Infinity) ||
      Number(b.n ?? 0) - Number(a.n ?? 0)
    );
  } else {
    out.sort((a, b) =>
      Number(b.rawRate ?? -Infinity) - Number(a.rawRate ?? -Infinity) ||
      Number(b.n ?? 0) - Number(a.n ?? 0)
    );
  }
  return out;
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
    const rows = sortReverseRows(
      keepToday((data.rows || []).filter((r) => Number(r.n) >= minN))
    );

    if (!rows.length) {
      box.innerHTML = `<div class="empty">条件に該当する選手はいません</div>`;
      return;
    }

    if (state.useAdjusted) {
      box.innerHTML = `
        <table>
          <thead><tr>
            <th>#</th><th>選手</th><th>級別</th><th>支部</th><th>母数(n)</th>
            <th>${esc(name)}1着</th><th>実測</th><th>補正</th><th>基準差</th>
          </tr></thead>
          <tbody>${rows.slice(0,200).map((r,i)=>`
            <tr data-open="${r.regno}">
              <td class="rank">${i+1}</td>
              <td><strong>${esc(r.name)}</strong><div class="meta">#${r.regno}</div>${todayInline(r.regno)}</td>
              <td>${esc(r.grade||"—")}</td>
              <td>${esc(r.branch||"—")}</td>
              <td>${r.n}</td>
              <td>${r.count}</td>
              <td>${fmt(r.rawRate)}%</td>
              <td class="rate">${fmt(r.adjRate)}%</td>
              <td class="${Number(r.diffPtAdjusted)>=0?"pos":"neg"}">${Number(r.diffPtAdjusted)>=0?"+":""}${fmt(r.diffPtAdjusted)}pt</td>
            </tr>`).join("")}
          </tbody>
        </table>`;
    } else {
      box.innerHTML = `
        <table>
          <thead><tr>
            <th>#</th><th>選手</th><th>級別</th><th>支部</th><th>母数(n)</th>
            <th>${esc(name)}1着</th><th>実測</th><th>基準値</th><th>実測基準差</th>
          </tr></thead>
          <tbody>${rows.slice(0,200).map((r,i)=>{
            const rawDiff = Number(r.rawRate) - Number(r.baselineRate);
            return `
              <tr data-open="${r.regno}">
                <td class="rank">${i+1}</td>
                <td><strong>${esc(r.name)}</strong><div class="meta">#${r.regno}</div>${todayInline(r.regno)}</td>
                <td>${esc(r.grade||"—")}</td>
                <td>${esc(r.branch||"—")}</td>
                <td>${r.n}</td>
                <td>${r.count}</td>
                <td class="rate">${fmt(r.rawRate)}%</td>
                <td>${fmt(r.baselineRate)}%</td>
                <td class="${rawDiff>=0?"pos":"neg"}">${rawDiff>=0?"+":""}${fmt(rawDiff)}pt</td>
              </tr>`;
          }).join("")}
          </tbody>
        </table>`;
    }

    $$("[data-open]", box).forEach((tr) => tr.addEventListener("click", () => {
      location.hash = `#/racer/${tr.dataset.open}`;
    }));
  } catch (e) {
    box.innerHTML = `<div class="empty error">データを読み込めませんでした：${esc(e.message)}</div>`;
  }
}

async function renderReverse() {
  shell(reverseFilters());
  bindGlobalControls();

  ["course","kimarite","grade","minN"].forEach((id) => {
    $(`#${id}`)?.addEventListener("change", loadReverse);
  });

  let timer = null;
  $("#minN")?.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(loadReverse, 180);
  });

  bindTodayToggle(() => renderReverse());
  loadReverse();
}

function rankingDefaultMinN(file) {
  return String(file || "").includes("ranking_in_unstable_") ? 50 : 30;
}

const rankingDefs = [
  ["ranking_b_attackers.json","B級の伏兵"],
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
      <div class="section-title">
        <div><div class="kicker">RANKINGS</div><h2>WAKEランキング</h2></div>
        <p>${state.useAdjusted ? "補正値で順位付け" : "実測値で順位付け"}</p>
      </div>

      <div class="mode-panel">
        <div>
          <strong>${modeText()}</strong>
          <p>${state.useAdjusted
            ? "少ない母数の偶然を上位にしにくい比較モードです。"
            : "補正を外し、実際に記録された数字だけで順位付けします。"}</p>
        </div>
        ${adjustedSwitch()}
      </div>

      <div class="filters ranking-filters">
        <div class="field">
          <label>ランキング <button class="mini-help" data-guide-open type="button">?</button></label>
          <select id="rankingFile">${rankingDefs.map(([f,n])=>`<option value="${f}">${n}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label>最低走数</label>
          <input id="rankMinN" type="number" min="1" value="30">
        </div>
        <div class="field action-field">
          <label>&nbsp;</label>
          <button class="primary" id="rankReload">表示</button>
        </div>
      </div>

      <div class="sub-filter-row">
        ${todayFilterControl()}
        ${state.todayOnly ? `<span class="sub-filter-note">本日の出走予定選手だけに絞り込み中</span>` : ""}
      </div>

      <div id="rankingDescription" class="ranking-description"></div>
      <div id="rankingResult" class="table-wrap"><div class="empty">読み込み中…</div></div>

      <div class="notice">
        母数(n)は必ず併記します。
        ${state.useAdjusted
          ? "補正ONでは補正値を順位に使用します。"
          : "補正OFFでは補正値を使わず、実測値で順位を作り直します。"}
        <button class="text-link" data-guide-open>用語の意味</button>
      </div>
    </section>`;
}

function updateRankingDescription() {
  const file = $("#rankingFile")?.value;
  const box = $("#rankingDescription");
  if (!box || !file) return;
  box.innerHTML = `
    <strong>${esc($("#rankingFile").selectedOptions[0]?.textContent || "")}</strong>
    <span>${esc(RANKING_DESCRIPTIONS[file] || "選手データを指定条件で比較するランキングです。")}</span>
  `;
}

function rankingMetricLabel(data) {
  if (data?.metric === "win_rate") return "1着率";
  if (data?.metric === "kimarite_win_rate_per_start") {
    return `${data?.kimarite || "決まり手"}1着率`;
  }
  if (data?.metric === "nige_win_rate_per_start") return "逃げ1着率";
  if (data?.metric === "ren3_rate") return "3連対率";
  return "率";
}

function sortRankingRows(rows, data) {
  const out = [...rows];
  const isST = data.metric === "avg_st";

  if (state.useAdjusted) {
    if (data.sort === "adjRate_asc") {
      out.sort((a,b) => Number(a.adjRate ?? Infinity) - Number(b.adjRate ?? Infinity));
    } else if (data.sort === "adjustedSt_asc" || isST) {
      out.sort((a,b) => Number(a.adjustedSt ?? Infinity) - Number(b.adjustedSt ?? Infinity));
    } else if (data.sort === "diffPtAdjusted_desc") {
      out.sort((a,b) => Number(b.diffPtAdjusted ?? -Infinity) - Number(a.diffPtAdjusted ?? -Infinity));
    } else {
      out.sort((a,b) => Number(b.adjRate ?? -Infinity) - Number(a.adjRate ?? -Infinity));
    }
  } else {
    if (isST) {
      out.sort((a,b) =>
        Number(a.avgSt ?? Infinity) - Number(b.avgSt ?? Infinity) ||
        Number(b.n ?? 0) - Number(a.n ?? 0)
      );
    } else if (data.sort === "adjRate_asc") {
      out.sort((a,b) =>
        Number(a.rawRate ?? Infinity) - Number(b.rawRate ?? Infinity) ||
        Number(b.n ?? 0) - Number(a.n ?? 0)
      );
    } else if (data.sort === "diffPtAdjusted_desc") {
      out.sort((a,b) => {
        const ad = Number(a.rawRate) - Number(a.baselineRate);
        const bd = Number(b.rawRate) - Number(b.baselineRate);
        return bd - ad || Number(b.n ?? 0) - Number(a.n ?? 0);
      });
    } else {
      out.sort((a,b) =>
        Number(b.rawRate ?? -Infinity) - Number(a.rawRate ?? -Infinity) ||
        Number(b.n ?? 0) - Number(a.n ?? 0)
      );
    }
  }

  return out;
}

async function loadRanking() {
  const file = $("#rankingFile").value;
  const minN = Math.max(1, Number($("#rankMinN").value || 30));
  const box = $("#rankingResult");

  updateRankingDescription();

  try {
    const data = await getJson(`${DATA_ROOT}/index/${file}`);
    const rows = sortRankingRows(
      keepToday((data.rows || []).filter((r) => Number(r.n) >= minN)),
      data
    );
    const isST = data.metric === "avg_st";

    if (!rows.length) {
      box.innerHTML = `<div class="empty">該当データなし</div>`;
      return;
    }

    if (isST) {
      box.innerHTML = state.useAdjusted ? `
        <table>
          <thead><tr><th>#</th><th>選手</th><th>級別</th><th>支部</th><th>母数(n)</th><th>実測ST</th><th>補正ST</th><th>F</th></tr></thead>
          <tbody>${rows.slice(0,200).map((r,i)=>`
            <tr data-open="${r.regno}">
              <td class="rank">${i+1}</td>
              <td><strong>${esc(r.name)}</strong><div class="meta">#${r.regno}</div>${todayInline(r.regno)}</td>
              <td>${esc(r.grade||"—")}</td><td>${esc(r.branch||"—")}</td><td>${r.n}</td>
              <td>${fmt(r.avgSt,3)}</td><td class="rate">${fmt(r.adjustedSt,3)}</td><td>${r.f_count ?? 0}</td>
            </tr>`).join("")}
          </tbody>
        </table>` : `
        <table>
          <thead><tr><th>#</th><th>選手</th><th>級別</th><th>支部</th><th>母数(n)</th><th>実測ST</th><th>F</th></tr></thead>
          <tbody>${rows.slice(0,200).map((r,i)=>`
            <tr data-open="${r.regno}">
              <td class="rank">${i+1}</td>
              <td><strong>${esc(r.name)}</strong><div class="meta">#${r.regno}</div>${todayInline(r.regno)}</td>
              <td>${esc(r.grade||"—")}</td><td>${esc(r.branch||"—")}</td><td>${r.n}</td>
              <td class="rate">${fmt(r.avgSt,3)}</td><td>${r.f_count ?? 0}</td>
            </tr>`).join("")}
          </tbody>
        </table>`;
    } else if (state.useAdjusted) {
      const metricLabel = rankingMetricLabel(data);
      box.innerHTML = `
        <table>
          <thead><tr><th>#</th><th>選手</th><th>級別</th><th>支部</th><th>母数(n)</th><th>${esc(metricLabel)}</th><th>基準差</th></tr></thead>
          <tbody>${rows.slice(0,200).map((r,i)=>`
            <tr data-open="${r.regno}">
              <td class="rank">${i+1}</td>
              <td><strong>${esc(r.name)}</strong><div class="meta">#${r.regno}</div>${todayInline(r.regno)}</td>
              <td>${esc(r.grade||"—")}</td><td>${esc(r.branch||"—")}</td><td>${r.n}</td>
              <td class="rate">${fmt(r.adjRate)}%<div class="meta">（実測 ${fmt(r.rawRate)}%）</div></td>
              <td class="${Number(r.diffPtAdjusted)>=0?"pos":"neg"}">${Number(r.diffPtAdjusted)>=0?"+":""}${fmt(r.diffPtAdjusted)}pt</td>
            </tr>`).join("")}
          </tbody>
        </table>`;
    } else {
      const metricLabel = rankingMetricLabel(data);
      box.innerHTML = `
        <table>
          <thead><tr><th>#</th><th>選手</th><th>級別</th><th>支部</th><th>母数(n)</th><th>${esc(metricLabel)}</th><th>基準値</th><th>実測基準差</th></tr></thead>
          <tbody>${rows.slice(0,200).map((r,i)=>{
            const rawDiff = Number(r.rawRate) - Number(r.baselineRate);
            return `
              <tr data-open="${r.regno}">
                <td class="rank">${i+1}</td>
                <td><strong>${esc(r.name)}</strong><div class="meta">#${r.regno}</div>${todayInline(r.regno)}</td>
                <td>${esc(r.grade||"—")}</td><td>${esc(r.branch||"—")}</td><td>${r.n}</td>
                <td class="rate">${fmt(r.rawRate)}%<div class="meta">（実測）</div></td>
                <td>${fmt(r.baselineRate)}%</td>
                <td class="${rawDiff>=0?"pos":"neg"}">${rawDiff>=0?"+":""}${fmt(rawDiff)}pt</td>
              </tr>`;
          }).join("")}
          </tbody>
        </table>`;
    }

    $$("[data-open]", box).forEach((tr) => tr.addEventListener("click", () => {
      location.hash = `#/racer/${tr.dataset.open}`;
    }));
  } catch (e) {
    box.innerHTML = `<div class="empty error">${esc(e.message)}</div>`;
  }
}

async function renderRanking() {
  shell(rankingView());
  bindGlobalControls();

  $("#rankingFile")?.addEventListener("change", () => {
    const input = $("#rankMinN");
    if (input) input.value = String(rankingDefaultMinN($("#rankingFile")?.value));
    loadRanking();
  });
  $("#rankReload")?.addEventListener("click", loadRanking);

  let timer = null;
  $("#rankMinN")?.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(loadRanking, 180);
  });

  bindTodayToggle(() => renderRanking());
  updateRankingDescription();
  loadRanking();
}

function courseCards(rows) {
  const map = new Map((rows || []).map((r) => [Number(r.course), r]));

  return `<div class="stat-grid">${[1,2,3,4,5,6].map((c) => {
    const r = map.get(c);
    if (!r) return `<div class="stat-card"><strong>${c}コース</strong><div class="meta">データなし</div></div>`;

    const d = r.rates?.diff_pt_adjusted?.win;

    return state.useAdjusted ? `
      <div class="stat-card">
        <strong>${c}コース <span class="meta">n=${r.n}</span></strong>
        <dl>
          <div><dt>1着率（実測）</dt><dd>${fmt(r.rates?.raw?.win)}%</dd></div>
          <div><dt>1着率（補正）</dt><dd>${fmt(r.rates?.adjusted?.win)}%</dd></div>
          <div><dt>基準差</dt><dd class="${Number(d)>=0?"pos":"neg"}">${Number(d)>=0?"+":""}${fmt(d)}pt</dd></div>
          <div><dt>2連対</dt><dd>${fmt(r.rates?.raw?.ren2)}%</dd></div>
          <div><dt>3連対</dt><dd>${fmt(r.rates?.raw?.ren3)}%</dd></div>
          <div><dt>平均ST</dt><dd>${fmt(r.start?.avg_st,3)}</dd></div>
        </dl>
      </div>` : `
      <div class="stat-card">
        <strong>${c}コース <span class="meta">n=${r.n}</span></strong>
        <dl>
          <div><dt>1着率</dt><dd>${fmt(r.rates?.raw?.win)}%</dd></div>
          <div><dt>2連対率</dt><dd>${fmt(r.rates?.raw?.ren2)}%</dd></div>
          <div><dt>3連対率</dt><dd>${fmt(r.rates?.raw?.ren3)}%</dd></div>
          <div><dt>平均ST</dt><dd>${fmt(r.start?.avg_st,3)}</dd></div>
          <div><dt>F回数</dt><dd>${r.start?.f_count ?? r.f_count ?? 0}</dd></div>
          <div><dt>L回数</dt><dd>${r.start?.l_count ?? r.l_count ?? 0}</dd></div>
        </dl>
      </div>`;
  }).join("")}</div>`;
}

function kimariteTable(rows) {
  const flat = [];
  for (const c of rows || []) {
    for (const x of c.items || []) {
      flat.push({ course:c.course, win_n:c.win_n, sufficient:c.sufficient, ...x });
    }
  }

  if (!flat.length) return `<div class="empty">決まり手データなし</div>`;

  if (state.useAdjusted) {
    return `
      <div class="table-wrap">
        <table>
          <thead><tr><th>コース</th><th>勝利数</th><th>決まり手</th><th>回数</th><th>実測構成比</th><th>補正構成比</th><th>基準差</th></tr></thead>
          <tbody>${flat.map((r)=>`
            <tr>
              <td>${r.course}</td><td>${r.win_n}</td><td>${esc(r.kimarite)}</td><td>${r.count}</td>
              ${r.sufficient ? `
                <td>${fmt(r.raw_rate)}%</td>
                <td class="rate">${fmt(r.adjusted_rate)}%</td>
                <td class="${Number(r.diff_pt_adjusted)>=0?"pos":"neg"}">${Number(r.diff_pt_adjusted)>=0?"+":""}${fmt(r.diff_pt_adjusted)}pt</td>
              ` : `<td colspan="3" class="meta">勝利数20未満のため率は非表示</td>`}
            </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  }

  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>コース</th><th>勝利数</th><th>決まり手</th><th>回数</th><th>実測構成比</th></tr></thead>
        <tbody>${flat.map((r)=>`
          <tr>
            <td>${r.course}</td><td>${r.win_n}</td><td>${esc(r.kimarite)}</td><td>${r.count}</td>
            ${r.sufficient
              ? `<td class="rate">${fmt(r.raw_rate)}%</td>`
              : `<td class="meta">勝利数20未満のため率は非表示</td>`}
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function venueTable(rows) {
  const sorted = [...(rows || [])].sort((a,b) => Number(b.n)-Number(a.n));
  if (!sorted.length) return `<div class="empty">場別データなし</div>`;

  if (state.useAdjusted) {
    return `
      <div class="table-wrap">
        <table>
          <thead><tr><th>場</th><th>母数(n)</th><th>1着率</th><th>補正1着率</th><th>本人平均との差</th><th>3連対率</th><th>平均ST</th></tr></thead>
          <tbody>${sorted.map((r)=>{
            const d = r.rates?.diff_pt_adjusted?.win;
            return `
              <tr>
                <td>${esc(placeNames[r.place_no]||String(r.place_no))}</td><td>${r.n}</td>
                <td>${fmt(r.rates?.raw?.win)}%</td><td class="rate">${fmt(r.rates?.adjusted?.win)}%</td>
                <td class="${Number(d)>=0?"pos":"neg"}">${Number(d)>=0?"+":""}${fmt(d)}pt</td>
                <td>${fmt(r.rates?.raw?.ren3)}%</td><td>${fmt(r.start?.avg_st,3)}</td>
              </tr>`;
          }).join("")}
          </tbody>
        </table>
      </div>`;
  }

  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>場</th><th>母数(n)</th><th>1着率</th><th>2連対率</th><th>3連対率</th><th>平均ST</th></tr></thead>
        <tbody>${sorted.map((r)=>`
          <tr>
            <td>${esc(placeNames[r.place_no]||String(r.place_no))}</td><td>${r.n}</td>
            <td class="rate">${fmt(r.rates?.raw?.win)}%</td>
            <td>${fmt(r.rates?.raw?.ren2)}%</td>
            <td>${fmt(r.rates?.raw?.ren3)}%</td>
            <td>${fmt(r.start?.avg_st,3)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}


function insightText(x) {
  if (!x) return "";
  if (x.type === "course_win") {
    const dir = x.direction === "strong" ? "高い" : "低い";
    const sign = Number(x.diff_pt) >= 0 ? "+" : "";
    return `${x.course}コースの補正1着率が${x.baseline_scope}基準より ${sign}${fmt(x.diff_pt)}pt ${dir}（${x.n}走）`;
  }
  if (x.type === "kimarite_bias") {
    return `${x.course}コース1着の ${fmt(x.adjusted_rate)}% が「${esc(x.kimarite)}」（${x.baseline_scope}基準 ${fmt(x.baseline_rate)}% / 1着${x.win_n}回）`;
  }
  if (x.type === "st_fast") {
    return `${x.course}コースの平均STが本人平均より ${fmt(Math.abs(Number(x.diff)),3)} 秒速い（${x.n}走）`;
  }
  if (x.type === "venue_ren3") {
    const dir = x.direction === "strong" ? "高い" : "低い";
    const sign = Number(x.diff_pt) >= 0 ? "+" : "";
    return `${placeNames[x.place_no] || `${x.place_no}場`}の補正3連対率が本人全場基準より ${sign}${fmt(x.diff_pt)}pt ${dir}（${x.n}走）`;
  }
  return "";
}

function insightsPanel(data) {
  const items = data?.insights?.items || [];
  if (!items.length) {
    return `
      <div class="insight-panel empty-insight">
        <div class="insight-icon">💡</div>
        <div><strong>特筆すべき偏りなし</strong><p>現在の母数と補正基準では、強く目立つ特徴は検出されていません。</p></div>
      </div>`;
  }

  return `
    <div class="insight-panel">
      ${items.map((x) => `
        <article class="insight-item">
          <span class="insight-dot"></span>
          <div>${esc(insightText(x))}</div>
        </article>`).join("")}
      <div class="insight-note">※ 低母数の偶然を避けるため、「意外な一面」の判定には常に補正値を使用します。</div>
    </div>`;
}

function defenseMetric(label, x) {
  if (!x) {
    return `
      <article class="defense-card">
        <div class="defense-title">${label}</div>
        <div class="meta">該当データなし</div>
      </article>`;
  }

  if (!x.sufficient) {
    return `
      <article class="defense-card">
        <div class="defense-title">${label}</div>
        <div class="defense-big">${x.n}回</div>
        <div class="meta">8件未満のためデータ不足</div>
      </article>`;
  }

  const finishDiff = Number(x.avg_finish_diff);
  const top3Diff = Number(x.top3_diff_pt);
  const finishText = finishDiff < 0
    ? `基準より ${fmt(Math.abs(finishDiff),2)}着 良い`
    : finishDiff > 0
      ? `基準より ${fmt(finishDiff,2)}着 悪い`
      : "基準と同じ";
  const top3Sign = top3Diff >= 0 ? "+" : "";

  return `
    <article class="defense-card">
      <div class="defense-title">${label}</div>
      <div class="defense-big">${x.n}回</div>
      <dl>
        <div><dt>平均着順</dt><dd>${fmt(x.avg_finish,2)}着</dd></div>
        <div><dt>全体基準</dt><dd>${fmt(x.baseline_avg_finish,2)}着</dd></div>
        <div><dt>比較</dt><dd class="${finishDiff <= 0 ? "pos" : "neg"}">${finishText}</dd></div>
        <div><dt>3着内率</dt><dd>${fmt(x.top3_rate)}%</dd></div>
        <div><dt>全体基準</dt><dd>${fmt(x.baseline_top3_rate)}%</dd></div>
        <div><dt>基準差</dt><dd class="${top3Diff >= 0 ? "pos" : "neg"}">${top3Sign}${fmt(top3Diff)}pt</dd></div>
      </dl>
    </article>`;
}

function defensePanel(data) {
  const d = data?.defense_1y;
  if (!d) return `<div class="empty">耐性データなし</div>`;

  return `
    <div class="defense-grid">
      ${defenseMetric("まくられ", d.makurare)}
      ${defenseMetric("差され", d.sasare)}
    </div>
    <div class="notice defense-note">
      「自分より外の艇」が該当決まり手で1着になったレースで、どこまで着を残したかを集計。
      基準値は、その選手が攻められた時の進入コース構成に合わせた全国平均です。
      対象期間：${esc(d.period?.start || "—")} 〜 ${esc(d.period?.end || "—")}
    </div>`;
}

async function renderRacer(regno) {
  shell(`<section class="section shell"><div class="empty">選手データを読み込み中…</div></section>`);

  try {
    const [d, featureData] = await Promise.all([
      getJson(`${DATA_ROOT}/racers/${regno}.json`),
      getJson(`${DATA_ROOT}/features/${regno}.json`).catch(() => null)
    ]);
    const r = d.racer || {};

    shell(`
      <section class="section shell">
        <button class="back" onclick="history.back()">← 戻る</button>

        <div class="detail-head" style="margin-top:12px">
          <div>
            <div class="kicker">RACER PROFILE</div>
            <h2>${esc(r.name)}</h2>
            ${r.kana ? `<div class="racer-kana">${esc(r.kana)}</div>` : ""}
            <div class="detail-meta">登録 ${r.regno} / ${esc(r.grade||"—")} / ${esc(r.branch||"—")} / ${d.totals?.n ?? 0}走</div>
            ${todayRaceLabel(r.regno) ? `<div class="today-detail">本日出走予定：${esc(todayRaceLabel(r.regno))}</div>` : ""}
          </div>
          <div class="meta">集計期間 ${esc(d.data_period?.actual_start||"—")} 〜 ${esc(d.data_period?.actual_end||"—")}</div>
        </div>

        <div class="mode-panel" style="margin-top:14px">
          <div>
            <strong>${modeText()}</strong>
            <p>${state.useAdjusted
              ? "選手詳細でも実測値と補正値を併記します。"
              : "選手詳細では補正項目を非表示にし、実測データだけを表示します。"}</p>
          </div>
          ${adjustedSwitch()}
        </div>

        <div class="section-title" style="margin-top:28px">
          <div>
            <div class="kicker">AUTO INSIGHT</div>
            <h2>この選手の意外な一面</h2>
          </div>
          <p>最大3件 / 母数補正済み</p>
        </div>
        ${insightsPanel(featureData)}

        <div class="section-title" style="margin-top:32px">
          <div>
            <div class="kicker">DEFENSE</div>
            <h2>攻められた時の粘り</h2>
          </div>
          <p>直近1年 / 実測値</p>
        </div>
        ${defensePanel(featureData)}

        <div class="section-title" style="margin-top:32px">
          <h2>コース別成績</h2>
          <p>${state.useAdjusted ? "実測値＋補正値" : "実測値のみ"}</p>
        </div>
        ${courseCards(d.course_stats)}

        <div class="section-title" style="margin-top:32px">
          <h2>勝った時の決まり手</h2>
          <p>勝利数20未満は率非表示</p>
        </div>
        ${kimariteTable(d.win_kimarite_breakdown)}

        <div class="section-title" style="margin-top:32px">
          <h2>場別成績</h2>
          <p>${state.useAdjusted ? "本人全場平均との差を表示" : "実測値のみ"}</p>
        </div>
        ${venueTable(d.venue_stats)}

        <div class="notice">
          数字の意味が分からない場合は <button class="text-link" data-guide-open>用語ガイド</button> を確認してください。
        </div>
      </section>
    `);

    bindGlobalControls();
  } catch (e) {
    shell(`<section class="section shell"><div class="empty error">選手データを読み込めませんでした：${esc(e.message)}</div></section>`);
  }
}

async function boot(skipSessionCheck = false) {
  if (!skipSessionCheck) {
    const ok = await hasSession();
    if (!ok) {
      renderLogin();
      return;
    }
  }

  try {
    const [index, baselines, todayMeta] = await Promise.all([
      getJson(`${DATA_ROOT}/index.json`),
      getJson(`${DATA_ROOT}/meta/baselines.json`).catch(() => null),
      getJson(`${DATA_ROOT}/today_entries.json`).catch(() => null)
    ]);

    state.index = Array.isArray(index) ? index : [];
    state.generatedAt = baselines?.generated_at
      ? new Date(baselines.generated_at).toLocaleString("ja-JP")
      : null;

    state.todayMeta = todayMeta && Array.isArray(todayMeta.racers) ? todayMeta : null;
    state.todayByRegno = new Map(
      (state.todayMeta?.racers || []).map((r) => [Number(r.regno), r])
    );
    if (!state.todayMeta?.racer_count) {
      state.todayOnly = false;
      localStorage.removeItem("wake_today_only");
    }
  } catch (e) {
    shell(`
      <section class="section shell">
        <div class="empty error">
          <strong>データファイルが見つかりません。</strong><br>
          ${esc(e.message)}
        </div>
      </section>
    `);
    return;
  }

  route();
}

async function route() {
  const h = location.hash.replace(/^#\/?/, "");
  if (h.startsWith("racer/")) return renderRacer(h.split("/")[1]);
  if (h === "reverse") return renderReverse();
  if (h === "ranking") return renderRanking();
  return renderHome();
}

window.addEventListener("hashchange", route);
boot();
