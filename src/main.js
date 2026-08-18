import "./style.css";

const app = document.querySelector("#app");
const DATA_ROOT = "/data";
const GOOGLE_SESSION_KEY = "wake_dictionary_google_session";

function googleSession() {
  try { return JSON.parse(localStorage.getItem(GOOGLE_SESSION_KEY) || "null"); } catch { return null; }
}

function googleAccessToken() {
  const session = googleSession();
  return session?.accessToken && (!session.expiresAt || session.expiresAt > Date.now()) ? session.accessToken : "";
}

function captureGoogleCallback() {
  if (!location.search.includes("dictionary_oauth=1")) return false;
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  const accessToken = params.get("access_token");
  if (accessToken) {
    const expiresIn = Number(params.get("expires_in") || 3600);
    localStorage.setItem(GOOGLE_SESSION_KEY, JSON.stringify({ accessToken, expiresAt: Date.now() + expiresIn * 1000 }));
  }
  history.replaceState(null, "", `${location.pathname}#/google-access`);
  return Boolean(accessToken);
}

const state = {
  index: [],
  generatedAt: null,
  useAdjusted: localStorage.getItem("wake_use_adjusted") !== "0",
  todayOnly: localStorage.getItem("wake_today_only") === "1",
  todayMeta: null,
  todayMetaStatus: "loading",
  todayByRegno: new Map(),
  reverseVenue: localStorage.getItem("wake_reverse_venue") || "ALL",
  rankingVenue: localStorage.getItem("wake_ranking_venue") || "ALL",
  // VENUE = 選択場での過去成績 / ALL = 全場での過去成績
  rankingBasis: localStorage.getItem("wake_ranking_basis") || "VENUE",
  rankingType: localStorage.getItem("wake_ranking_type") || "attack",
  rankingGrade: localStorage.getItem("wake_ranking_grade") || "B",
  rankingCourse: localStorage.getItem("wake_ranking_course") || "DEFAULT",
  rankingFemaleOnly: localStorage.getItem("wake_ranking_female") === "1",
  rankingRaceClass: localStorage.getItem("wake_ranking_race_class") || "ALL",
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
  ["差され耐性", "自分より外の選手が「差し」で1着になった時に、自分が何着まで残したかを見る直近1年の実測データです。1件から表示し、8件未満は参考値として明示します。"],
  ["本日出走のみ", "本日レースに出走予定の選手だけに絞る機能です。場フィルターと組み合わせると、その場に本日出走する選手だけに絞ります。"],
  ["場フィルター", "選択した場での過去成績だけを使って逆引き・ランキングを作り直します。本日出走のみON時は、本日開催している場だけを選べます。"],
  ["ランキング成績基準", "「選択場の成績」はその場での過去成績で順位付け。「全場の成績」は全国24場を通した過去成績で順位付けし、選んだ場に本日出走する選手だけを抽出できます。"],
  ["紐推し", "1着固定ではなく2・3着候補として見つけやすいよう、指定コースの3連対率が高い選手を比較します。"],
  ["女子選手", "公式女子レーサー名鑑の現役選手だけに絞ります。B級の伏兵など他の条件とも同時に使えます。"],
  ["過去レース区分", "過去2年の成績を、女子選手6名の女子戦と、女子選手が男子選手と走った男女混合戦に分けて再集計します。本日出走のみとは独立して併用できます。"],
];

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const fmt = (v, d = 1) => Number.isFinite(Number(v)) ? Number(v).toFixed(d) : "—";
function todayJstIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const o = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${o.year}-${o.month}-${o.day}`;
}

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

function todayRaceLabel(regno, placeNo = "ALL") {
  const row = todayEntry(regno);
  if (!row?.entries?.length) return "";

  const byPlace = new Map();
  for (const e of row.entries) {
    const p = Number(e.place_no);
    if (placeNo !== "ALL" && Number(placeNo) !== p) continue;
    if (!byPlace.has(p)) byPlace.set(p, []);
    byPlace.get(p).push(Number(e.race_no));
  }

  return [...byPlace.entries()].map(([p, races]) => {
    const uniq = [...new Set(races)].sort((a,b) => a-b);
    return `${placeNames[p] || `${p}場`} ${uniq.map((r)=>`${r}R`).join("・")}`;
  }).join(" / ");
}

function todayInline(regno, placeNo = "ALL") {
  const label = todayRaceLabel(regno, placeNo);
  return label ? `<div class="today-inline">本日 ${esc(label)}</div>` : "";
}

function earliestTodayRaceNo(regno, placeNo = "ALL") {
  const row = todayEntry(regno);
  if (!row?.entries?.length) return Infinity;

  const raceNos = row.entries
    .filter((e) =>
      placeNo === "ALL" || Number(e.place_no) === Number(placeNo)
    )
    .map((e) => Number(e.race_no))
    .filter(Number.isFinite);

  return raceNos.length ? Math.min(...raceNos) : Infinity;
}

function sortTodayRankingByRace(rows, placeNo, data) {
  const metricSorted = sortRankingRows(rows, data);

  // 本日出走 + 特定場の時は、その場の出走Rが早い順。
  // 同じRなら元のランキング順位を維持する。
  if (!state.todayOnly || placeNo === "ALL") return metricSorted;

  const metricOrder = new Map(
    metricSorted.map((r, i) => [Number(r.regno), i])
  );

  return [...metricSorted].sort((a,b) =>
    earliestTodayRaceNo(a.regno, placeNo)
      - earliestTodayRaceNo(b.regno, placeNo)
    || (metricOrder.get(Number(a.regno)) ?? Infinity)
      - (metricOrder.get(Number(b.regno)) ?? Infinity)
  );
}

function todayFilterControl() {
  const available = Number(state.todayMeta?.racer_count || 0) > 0
    && state.todayMeta?.date === todayJstIso();

  const unavailableLabel = state.todayMetaStatus === "stale"
    ? "本日分を更新待ち"
    : state.todayMetaStatus === "error"
      ? "出走情報取得失敗"
      : "出走情報未取得";

  return `
    <label class="today-filter ${available ? "" : "disabled"}">
      <input type="checkbox" data-today-toggle ${state.todayOnly && available ? "checked" : ""} ${available ? "" : "disabled"}>
      <span class="today-check"></span>
      <span>本日出走のみ</span>
      ${available
        ? `<small>${Number(state.todayMeta.racer_count).toLocaleString()}人</small>`
        : `<small>${unavailableLabel}</small>`}
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

function todayActivePlaces() {
  const metaPlaces = Array.isArray(state.todayMeta?.places)
    ? state.todayMeta.places.map(Number).filter((p) => p >= 1 && p <= 24)
    : [];
  if (metaPlaces.length) {
    return [...new Set(metaPlaces)].sort((a,b)=>a-b);
  }

  const set = new Set();
  for (const row of state.todayMeta?.racers || []) {
    for (const e of row.entries || []) {
      const p = Number(e.place_no);
      if (p >= 1 && p <= 24) set.add(p);
    }
  }
  return [...set].sort((a,b)=>a-b);
}

function todayAtPlace(regno, placeNo = "ALL") {
  if (placeNo === "ALL" || placeNo == null) {
    return state.todayByRegno.has(Number(regno));
  }
  const row = todayEntry(regno);
  return Boolean(
    row?.entries?.some((e) => Number(e.place_no) === Number(placeNo))
  );
}

function keepToday(rows, placeNo = "ALL") {
  if (!state.todayOnly) return rows;
  return rows.filter((r) => todayAtPlace(r.regno, placeNo));
}

function todayAtRaceClass(regno, raceClass, placeNo = "ALL") {
  if (!raceClass || raceClass === "ALL") return true;
  const row = todayEntry(regno);
  return Boolean(row?.entries?.some((e) =>
    (placeNo === "ALL" || Number(e.place_no) === Number(placeNo))
      && String(e.race_class || "UNKNOWN") === raceClass
  ));
}

function venueOptions({mode="reverse", selected="ALL"} = {}) {
  const active = todayActivePlaces();
  let places;

  if (mode === "ranking") {
    // ランキングの場指定は「本日開催場」だけ。
    places = active.length
      ? active
      : Array.from({length:24}, (_,i)=>i+1);
  } else {
    // 逆引きは通常24場。本日出走ON時だけ本日開催場へ限定。
    places = state.todayOnly && active.length
      ? active
      : Array.from({length:24}, (_,i)=>i+1);
  }

  const allowed = new Set(places.map(String));
  const safe = selected === "ALL" || allowed.has(String(selected))
    ? String(selected)
    : "ALL";

  const allLabel = state.todayOnly && active.length
    ? "本日開催 全場"
    : "全場";

  return {
    selected: safe,
    html: [
      `<option value="ALL" ${safe==="ALL"?"selected":""}>${allLabel}</option>`,
      ...places.map((p) =>
        `<option value="${p}" ${safe===String(p)?"selected":""}>${placeNames[p]}</option>`
      ),
    ].join(""),
  };
}

function venueDataPath(placeNo) {
  return `${DATA_ROOT}/index/venue_${String(Number(placeNo)).padStart(2,"0")}.json`;
}

function ratePctClient(count, total) {
  return Number(total) > 0
    ? 100 * Number(count || 0) / Number(total)
    : 0;
}

function shrinkRatePctClient(count, total, baselinePct, k=15) {
  const totalN = Number(total || 0);
  const b = Number(baselinePct);
  if (!Number.isFinite(b) || totalN < 0) return null;
  return 100 * (
    Number(count || 0) + Number(k) * (b / 100)
  ) / (totalN + Number(k));
}

function shrinkMeanClient(sum, total, baselineMean, k=15) {
  const totalN = Number(total || 0);
  const b = Number(baselineMean);
  if (!Number.isFinite(b) || totalN <= 0) return null;
  return (
    Number(sum || 0) + Number(k) * b
  ) / (totalN + Number(k));
}

async function getJson(path) {
  const isDataPath = path.startsWith(`${DATA_ROOT}/`);
  const target = isDataPath
    ? `/api/data?path=${encodeURIComponent(path.slice(DATA_ROOT.length + 1))}`
    : path;
  const token = googleAccessToken();
  const r = await fetch(target, {
    cache: "no-store",
    credentials: "same-origin",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (r.status === 401) {
    if (token) renderGoogleAccess("Google認証の有効期限が切れました。もう一度ログインしてください。");
    else renderLogin("認証の有効期限が切れました。もう一度パスワードを入力してください。");
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
        <div class="login-divider"><span>管理者テスト</span></div>
        <button id="googleLoginButton" class="google-login" type="button">Googleで申請・承認を試す</button>
        <p class="beta-note">現在は管理者本人だけが利用できます。従来の購入者は上のパスワードで引き続き利用できます。</p>
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
  $("#googleLoginButton")?.addEventListener("click", startGoogleLogin);
}

async function startGoogleLogin() {
  try {
    const response = await fetch("/api/google-config", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.authorizeUrl) throw new Error(data.error || "config_failed");
    location.href = data.authorizeUrl;
  } catch {
    renderLogin("Google認証の準備がまだ完了していません。");
  }
}

async function googleApi(path, method = "GET") {
  const token = googleAccessToken();
  if (!token) throw new Error("google_session_missing");
  const response = await fetch(path, { method, cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function renderGoogleAccess(message = "") {
  const token = googleAccessToken();
  if (!token) {
    renderLogin(message || "Googleでログインしてください。");
    return;
  }
  app.innerHTML = `<main class="login-page"><section class="login-card"><div class="kicker">GOOGLE ACCESS β</div><h1>申請状況を確認中…</h1></section></main>`;
  try {
    const status = await googleApi("/api/google-status");
    const approved = Boolean(status.entitlement);
    const pending = status.request?.status === "pending";
    const expires = approved ? new Date(status.entitlement.expires_at).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : "";
    app.innerHTML = `
      <main class="login-page"><section class="login-card">
        <div class="brand login-brand"><span class="brand-mark">W</span><span>WAKE辞典<small>GOOGLE ACCESS β</small></span></div>
        <div class="kicker">APPLICATION → APPROVAL → LOGIN</div>
        <h1>${approved ? "承認済みです" : pending ? "申請済みです" : "Google利用申請"}</h1>
        <p>${esc(status.user.email)}</p>
        ${message ? `<div class="login-message">${esc(message)}</div>` : ""}
        ${approved ? `<div class="access-success">利用期限：${esc(expires)}まで</div><button id="openDictionary" class="primary access-action">辞典を開く</button>` : ""}
        ${!approved && !pending ? `<button id="requestAccess" class="primary access-action">このアカウントで申請する</button>` : ""}
        ${pending && status.isAdmin ? `<div class="beta-note">管理者本人のβテストです。申請内容を確認して承認してください。</div><button id="approveAccess" class="primary access-action">自分の申請を承認する</button>` : ""}
        ${pending && !status.isAdmin ? `<div class="login-message">承認待ちです。</div>` : ""}
        <button id="googleLogout" class="google-login access-action" type="button">Google認証を終了</button>
        <button id="backToPassword" class="text-link access-action" type="button">パスワード入力へ戻る</button>
      </section></main>`;
    $("#requestAccess")?.addEventListener("click", async () => { await googleApi("/api/google-request", "POST"); await renderGoogleAccess("申請を受け付けました。"); });
    $("#approveAccess")?.addEventListener("click", async () => { await googleApi("/api/google-approve", "POST"); await renderGoogleAccess("承認しました。"); });
    $("#openDictionary")?.addEventListener("click", () => { location.hash = "#/"; boot(true); });
    $("#googleLogout")?.addEventListener("click", () => { localStorage.removeItem(GOOGLE_SESSION_KEY); renderLogin("Google認証を終了しました。"); });
    $("#backToPassword")?.addEventListener("click", () => renderLogin());
  } catch (error) {
    if (error.message === "unauthorized" || error.message === "google_session_missing") localStorage.removeItem(GOOGLE_SESSION_KEY);
    renderLogin(error.message === "database_request_failed" ? "申請用テーブルの準備が必要です。" : "Google認証を確認できませんでした。");
  }
}

async function hasSession() {
  try {
    const r = await fetch("/api/session", { cache: "no-store", credentials: "same-origin" });
    if (r.ok) return true;
    if (!googleAccessToken()) return false;
    const status = await googleApi("/api/google-status");
    return Boolean(status.entitlement);
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
          <label>場 <button class="mini-help" data-guide-open type="button">?</button></label>
          <select id="reverseVenue">${venueOptions({mode:"reverse",selected:state.reverseVenue}).html}</select>
        </div>
        <div class="field">
          <label>最低走数 <button class="mini-help" data-guide-open type="button">?</button></label>
          <input id="minN" type="number" min="1" value="30" />
        </div>
      </div>

      <div class="sub-filter-row">
        ${todayFilterControl()}
        ${state.todayOnly ? `<span class="sub-filter-note">本日出走時は、特定場を選ぶと出走Rの早い順に表示</span>` : ""}
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


function buildVenueReverseRows(data, course, kimariteName, gradeScope) {
  const baseline = data?.baselines?.[gradeScope]?.[String(course)];
  const baselineRate = Number(
    baseline?.kimarite_win_rate_per_start?.[kimariteName]
  );
  if (!Number.isFinite(baselineRate)) return [];

  const rows = [];
  for (const racer of data?.racers || []) {
    if (gradeScope !== "ALL" && racer.grade !== gradeScope) continue;
    const c = (racer.courses || [])
      .find((x) => Number(x.course) === Number(course));
    if (!c || Number(c.n || 0) < 1) continue;

    const n = Number(c.n || 0);
    const count = Number(c.kimarite?.[kimariteName] || 0);
    const rawRate = ratePctClient(count, n);
    const adjRate = shrinkRatePctClient(
      count, n, baselineRate, Number(data.shrinkage_k || 15)
    );

    rows.push({
      regno:Number(racer.regno),
      name:racer.name || "",
      grade:racer.grade || null,
      branch:racer.branch || null,
      course:Number(course),
      kimarite:kimariteName,
      n,
      count,
      rawRate,
      adjRate,
      baselineRate,
      diffPtAdjusted:Number(adjRate) - baselineRate,
    });
  }
  return rows;
}

async function loadReverse() {
  const c = Number($("#course").value);
  const slug = $("#kimarite").value;
  const name = $("#kimarite").selectedOptions[0].dataset.name;
  const grade = $("#grade").value;
  const minN = Math.max(1, Number($("#minN").value || 30));
  const placeValue = $("#reverseVenue")?.value || "ALL";
  const placeNo = placeValue === "ALL" ? "ALL" : Number(placeValue);
  const box = $("#reverseResult");

  state.reverseVenue = String(placeValue);
  localStorage.setItem("wake_reverse_venue", state.reverseVenue);

  box.innerHTML = `<div class="empty">読み込み中…</div>`;

  try {
    let data;
    let sourceRows;

    if (placeNo === "ALL") {
      data = await getJson(
        `${DATA_ROOT}/index/reverse_course${c}_${slug}_${grade}.json`
      );
      sourceRows = data.rows || [];
    } else {
      const venueData = await getJson(venueDataPath(placeNo));
      data = {
        ...venueData,
        course:c,
        kimarite:name,
        grade,
        sort:"adjRate_desc",
      };
      sourceRows = buildVenueReverseRows(
        venueData, c, name, grade
      );
    }

    const rows = sortReverseRows(
      keepToday(
        sourceRows.filter((r) => Number(r.n) >= minN),
        placeNo
      )
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

  $("#reverseVenue")?.addEventListener("change", () => {
    state.reverseVenue = $("#reverseVenue")?.value || "ALL";
    localStorage.setItem("wake_reverse_venue", state.reverseVenue);
    loadReverse();
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
          <label>出走場（本日開催）</label>
          <select id="rankingVenue">${venueOptions({mode:"ranking",selected:state.rankingVenue}).html}</select>
        </div>
        <div class="field">
          <label>ランキング成績基準 <button class="mini-help" data-guide-open type="button">?</button></label>
          <select id="rankingBasis">
            <option value="VENUE" ${state.rankingBasis === "VENUE" ? "selected" : ""}>選択場の成績</option>
            <option value="ALL" ${state.rankingBasis === "ALL" ? "selected" : ""}>全場の成績</option>
          </select>
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

  const venueValue = $("#rankingVenue")?.value || "ALL";
  const venueLabel =
    $("#rankingVenue")?.selectedOptions?.[0]?.textContent || "全場";
  const requestedBasis = $("#rankingBasis")?.value || state.rankingBasis || "VENUE";
  const effectiveBasis = venueValue === "ALL" ? "ALL" : requestedBasis;
  const basisLabel = effectiveBasis === "ALL"
    ? "全場成績"
    : `${venueLabel}成績`;

  box.innerHTML = `
    <strong>${esc($("#rankingFile").selectedOptions[0]?.textContent || "")}</strong>
    <span>${esc(RANKING_DESCRIPTIONS[file] || "選手データを指定条件で比較するランキングです。")}</span>
    <div class="ranking-context-row">
      <span class="ranking-venue-context">出走場：${esc(venueLabel)}</span>
      <span class="ranking-basis-context">順位基準：${esc(basisLabel)}</span>
      ${state.todayOnly && venueValue !== "ALL"
        ? `<span class="ranking-order-context">表示順：${esc(venueLabel)}の出走Rが早い順</span>`
        : ""}
    </div>
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


function venueCourseMap(racer) {
  return new Map(
    (racer?.courses || []).map((c) => [Number(c.course), c])
  );
}

function aggregateVenueRacer(racer, coursesWanted) {
  const map = venueCourseMap(racer);
  const acc = {
    starts:0, wins:0, ren2:0, ren3:0,
    validStN:0, stSum:0, fCount:0, lCount:0,
    kimarite:Object.fromEntries(KIMARITE.map(([name]) => [name,0])),
  };

  for (const course of coursesWanted) {
    const row = map.get(Number(course));
    if (!row) continue;

    const starts = Number(row.n || 0);
    const f = Number(row.f_count || 0);
    const l = Number(row.l_count || 0);
    const missing = Number(row.st_missing_count || 0);
    const valid = Math.max(0, starts - f - l - missing);
    const avg = Number(row.avg_st);

    acc.starts += starts;
    acc.wins += Number(row.win_n || 0);
    acc.ren2 += Number(row.ren2_n || 0);
    acc.ren3 += Number(row.ren3_n || 0);
    acc.validStN += valid;
    if (valid && Number.isFinite(avg)) acc.stSum += avg * valid;
    acc.fCount += f;
    acc.lCount += l;

    for (const [name] of KIMARITE) {
      acc.kimarite[name] += Number(row.kimarite?.[name] || 0);
    }
  }
  return acc;
}

function weightedVenueBaseline(data, scope, racer, courses, key) {
  const map = venueCourseMap(racer);
  let weighted = 0;
  let total = 0;

  for (const course of courses) {
    const row = map.get(Number(course));
    const n = Number(row?.n || 0);
    const b = data?.baselines?.[scope]?.[String(course)]?.[key];
    if (!n || b == null || !Number.isFinite(Number(b))) continue;
    weighted += n * Number(b);
    total += n;
  }
  return total ? weighted / total : null;
}

function weightedVenueKimariteBaseline(data, scope, racer, courses, kimarite) {
  const map = venueCourseMap(racer);
  let weighted = 0;
  let total = 0;

  for (const course of courses) {
    const row = map.get(Number(course));
    const n = Number(row?.n || 0);
    const b = data?.baselines?.[scope]?.[String(course)]
      ?.kimarite_win_rate_per_start?.[kimarite];
    if (!n || b == null || !Number.isFinite(Number(b))) continue;
    weighted += n * Number(b);
    total += n;
  }
  return total ? weighted / total : null;
}

function weightedVenueStBaseline(data, scope, racer, courses) {
  const map = venueCourseMap(racer);
  let weighted = 0;
  let total = 0;

  for (const course of courses) {
    const row = map.get(Number(course));
    if (!row) continue;
    const starts = Number(row.n || 0);
    const valid = Math.max(
      0,
      starts
        - Number(row.f_count || 0)
        - Number(row.l_count || 0)
        - Number(row.st_missing_count || 0)
    );
    const b = data?.baselines?.[scope]?.[String(course)]?.avg_st;
    if (!valid || b == null || !Number.isFinite(Number(b))) continue;
    weighted += valid * Number(b);
    total += valid;
  }
  return total ? weighted / total : null;
}

function buildVenueRankingData(data, file) {
  const racers = data?.racers || [];
  const shrinkK = Number(data?.shrinkage_k || 15);

  const rateRows = ({
    grades, courses, baselineKey, kimarite, countFn,
    metric, sort="adjRate_desc", title=""
  }) => {
    const rows = [];
    for (const racer of racers) {
      if (grades && !grades.includes(racer.grade)) continue;
      const scope = racer.grade;
      if (!["A1","A2","B1","B2"].includes(scope)) continue;

      const acc = aggregateVenueRacer(racer, courses);
      if (!acc.starts) continue;

      const baselineRate = kimarite
        ? weightedVenueKimariteBaseline(
            data, scope, racer, courses, kimarite
          )
        : weightedVenueBaseline(
            data, scope, racer, courses, baselineKey
          );
      if (baselineRate == null) continue;

      const count = countFn(acc);
      const rawRate = ratePctClient(count, acc.starts);
      const adjRate = shrinkRatePctClient(
        count, acc.starts, baselineRate, shrinkK
      );

      rows.push({
        regno:Number(racer.regno),
        name:racer.name || "",
        grade:racer.grade || null,
        branch:racer.branch || null,
        n:acc.starts,
        count,
        rawRate,
        adjRate,
        baselineRate,
        diffPtAdjusted:Number(adjRate) - Number(baselineRate),
      });
    }
    return {rows, metric, kimarite, sort, title};
  };

  if (file === "ranking_b_attackers.json") {
    const out = rateRows({
      grades:["B1","B2"],
      courses:[3,4,5,6],
      baselineKey:"win_rate",
      countFn:(a)=>a.wins,
      metric:"win_rate",
      sort:"diffPtAdjusted_desc",
      title:"B級の伏兵",
    });
    out.rows = out.rows.filter(
      (r) => Number(r.diffPtAdjusted) > 0
    );
    return out;
  }

  if (file === "ranking_makuri_B1.json") {
    return rateRows({
      grades:["B1"], courses:[1,2,3,4,5,6],
      kimarite:"まくり", countFn:(a)=>a.kimarite["まくり"],
      metric:"kimarite_win_rate_per_start",
      title:"B1 まくり職人",
    });
  }

  if (file === "ranking_sashi_B1.json") {
    return rateRows({
      grades:["B1"], courses:[1,2,3,4,5,6],
      kimarite:"差し", countFn:(a)=>a.kimarite["差し"],
      metric:"kimarite_win_rate_per_start",
      title:"B1 差し名人",
    });
  }

  if (file === "ranking_in_unstable_A1.json") {
    return rateRows({
      grades:["A1"], courses:[1],
      kimarite:"逃げ", countFn:(a)=>a.kimarite["逃げ"],
      metric:"nige_win_rate_per_start",
      sort:"adjRate_asc",
      title:"A1 イン不安定",
    });
  }

  if (file === "ranking_dash_B1.json") {
    return rateRows({
      grades:["B1"], courses:[4,5,6],
      baselineKey:"ren3_rate", countFn:(a)=>a.ren3,
      metric:"ren3_rate",
      title:"B1 ダッシュ巧者",
    });
  }

  if (
    file === "ranking_start_no_f_A1.json" ||
    file === "ranking_start_no_f_B1.json"
  ) {
    const grade = file.includes("_A1") ? "A1" : "B1";
    const rows = [];

    for (const racer of racers) {
      if (racer.grade !== grade) continue;

      const courses = [1,2,3,4,5,6];
      const acc = aggregateVenueRacer(racer, courses);
      if (!acc.validStN || acc.fCount !== 0) continue;

      const baselineAvgSt = weightedVenueStBaseline(
        data, grade, racer, courses
      );
      if (baselineAvgSt == null) continue;

      const avgSt = acc.stSum / acc.validStN;
      const adjustedSt = shrinkMeanClient(
        acc.stSum, acc.validStN, baselineAvgSt, shrinkK
      );

      rows.push({
        regno:Number(racer.regno),
        name:racer.name || "",
        grade:racer.grade || null,
        branch:racer.branch || null,
        n:acc.validStN,
        total_starts:acc.starts,
        avgSt,
        adjustedSt,
        baselineAvgSt,
        diffAdjusted:Number(adjustedSt)-Number(baselineAvgSt),
        f_count:acc.fCount,
        l_count:acc.lCount,
      });
    }

    return {
      rows,
      metric:"avg_st",
      sort:"adjustedSt_asc",
      title:`${grade} スタート巧者（Fなし）`,
      grade,
      f_filter:"f_count_zero",
    };
  }

  return {rows:[], metric:"", sort:"adjRate_desc", title:""};
}

async function loadRanking() {
  const file = $("#rankingFile").value;
  const minN = Math.max(1, Number($("#rankMinN").value || 30));
  const placeValue = $("#rankingVenue")?.value || "ALL";
  const placeNo = placeValue === "ALL" ? "ALL" : Number(placeValue);
  const requestedBasis = $("#rankingBasis")?.value || state.rankingBasis || "VENUE";
  const effectiveBasis = placeNo === "ALL" ? "ALL" : requestedBasis;
  const box = $("#rankingResult");

  state.rankingVenue = String(placeValue);
  state.rankingBasis = String(requestedBasis);
  localStorage.setItem("wake_ranking_venue", state.rankingVenue);
  localStorage.setItem("wake_ranking_basis", state.rankingBasis);

  // 「全場」を選択中は選択場成績という概念がないため、表示上も全場へ固定。
  const basisSelect = $("#rankingBasis");
  if (basisSelect) {
    basisSelect.disabled = placeNo === "ALL";
    if (placeNo === "ALL") basisSelect.value = "ALL";
  }

  updateRankingDescription();

  try {
    let data;

    if (effectiveBasis === "ALL") {
      // 全場成績ランキングをそのまま使用。
      // 本日出走ON + 特定場なら「全場で強い選手のうち、その場に今日出る選手」になる。
      data = await getJson(`${DATA_ROOT}/index/${file}`);
      data.ranking_basis = "ALL";
    } else {
      // 従来どおり、選択場での過去成績からランキングを作り直す。
      const venueData = await getJson(venueDataPath(placeNo));
      data = buildVenueRankingData(venueData, file);
      data.place_no = placeNo;
      data.place_name = venueData.place_name;
      data.ranking_basis = "VENUE";
    }

    const filtered = keepToday(
      (data.rows || []).filter((r) => Number(r.n) >= minN),
      placeNo
    );

    const rows = sortTodayRankingByRace(filtered, placeNo, data);
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
              <td><strong>${esc(r.name)}</strong><div class="meta">#${r.regno}</div>${todayInline(r.regno, placeNo)}</td>
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
              <td><strong>${esc(r.name)}</strong><div class="meta">#${r.regno}</div>${todayInline(r.regno, placeNo)}</td>
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
              <td><strong>${esc(r.name)}</strong><div class="meta">#${r.regno}</div>${todayInline(r.regno, placeNo)}</td>
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
                <td><strong>${esc(r.name)}</strong><div class="meta">#${r.regno}</div>${todayInline(r.regno, placeNo)}</td>
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

async function renderRankingLegacy() {
  shell(rankingView());
  bindGlobalControls();

  $("#rankingFile")?.addEventListener("change", () => {
    const input = $("#rankMinN");
    if (input) input.value = String(rankingDefaultMinN($("#rankingFile")?.value));
    loadRanking();
  });
  $("#rankReload")?.addEventListener("click", loadRanking);
  $("#rankingVenue")?.addEventListener("change", () => {
    state.rankingVenue = $("#rankingVenue")?.value || "ALL";
    localStorage.setItem("wake_ranking_venue", state.rankingVenue);
    updateRankingDescription();
    loadRanking();
  });

  $("#rankingBasis")?.addEventListener("change", () => {
    state.rankingBasis = $("#rankingBasis")?.value || "VENUE";
    localStorage.setItem("wake_ranking_basis", state.rankingBasis);
    updateRankingDescription();
    loadRanking();
  });

  let timer = null;
  $("#rankMinN")?.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(loadRanking, 180);
  });

  bindTodayToggle(() => renderRanking());
  updateRankingDescription();
  loadRanking();
}

// ============================================================================
// v2.5 組み合わせランキング
// ============================================================================
const RANKING_TYPES_V25 = [
  ["attack", "伏兵（1着率の基準差）"],
  ["ren3", "紐推し（3連対率）"],
  ["makuri", "まくり職人"],
  ["makurizashi", "まくり差し巧者"],
  ["sashi", "差し名人"],
  ["in_strong", "イン最強"],
  ["in_unstable", "イン不安定"],
  ["dash", "ダッシュ巧者（3連対率）"],
  ["start", "スタート巧者"],
  ["start_no_f", "スタート巧者（Fなし）"],
];

const RANKING_DESC_V25 = {
  attack:"指定級別・コースの1着率が、同じ級別の基準をどれだけ上回るかで伏兵候補を探します。",
  ren3:"指定級別・コースで3着以内に残る率が高い選手を、舟券の紐候補として比較します。",
  makuri:"指定コースから、まくりで1着になった率を比較します。",
  makurizashi:"指定コースから、まくり差しで1着になった率を比較します。",
  sashi:"指定コースから、差しで1着になった率を比較します。",
  in_strong:"逃げで1着になった率が高い順です。通常は1コースを選びます。",
  in_unstable:"逃げで1着になった率が低い順です。通常は1コース・最低50走を推奨します。",
  dash:"指定コースの3連対率を比較します。既定は4〜6コースです。",
  start:"指定コースの平均STを比較します。数字が小さいほど速い表示です。",
  start_no_f:"集計期間のFが0回の選手だけで、指定コースの平均STを比較します。",
};

function rankingDefaultCoursesV25(type) {
  if (type === "attack") return [3,4,5,6];
  if (type === "dash") return [4,5,6];
  if (type === "in_strong" || type === "in_unstable") return [1];
  return [1,2,3,4,5,6];
}
function rankingCoursesV25(type, value) {
  if (!value || value === "DEFAULT") return rankingDefaultCoursesV25(type);
  if (value === "ALL") return [1,2,3,4,5,6];
  if (value === "3-6") return [3,4,5,6];
  if (value === "4-6") return [4,5,6];
  const n = Number(value);
  return n >= 1 && n <= 6 ? [n] : rankingDefaultCoursesV25(type);
}
function rankingGradesV25(value) {
  if (value === "A") return ["A1","A2"];
  if (value === "B") return ["B1","B2"];
  if (["A1","A2","B1","B2"].includes(value)) return [value];
  return ["A1","A2","B1","B2"];
}
function rankingCourseLabelV25(courses) {
  if (courses.length === 6) return "全コース";
  if (courses.join(",") === "3,4,5,6") return "3〜6コース";
  if (courses.join(",") === "4,5,6") return "4〜6コース";
  return courses.map((c)=>`${c}コース`).join("・");
}
function rankingGenderBadgeV25(row) {
  return row.is_female || row.gender === "F" ? `<span class="female-badge">女子</span>` : "";
}

function buildRankingDataV25(data, {type, gradeValue, courseValue, femaleOnly}) {
  const grades = rankingGradesV25(gradeValue);
  const courses = rankingCoursesV25(type, courseValue);
  const racers = data?.racers || [];
  const shrinkK = Number(data?.shrinkage_k || 15);
  const rows = [];
  const isST = type === "start" || type === "start_no_f";
  const kimarite = type === "makuri" ? "まくり"
    : type === "makurizashi" ? "まくり差し"
      : type === "sashi" ? "差し"
        : (type === "in_strong" || type === "in_unstable") ? "逃げ" : null;

  for (const racer of racers) {
    if (!grades.includes(racer.grade)) continue;
    if (femaleOnly && !(racer.is_female || racer.gender === "F")) continue;
    const acc = aggregateVenueRacer(racer,courses);
    if (!acc.starts) continue;
    const base = {
      regno:Number(racer.regno), name:racer.name||"", grade:racer.grade||null,
      branch:racer.branch||null, gender:racer.gender||null,
      is_female:Boolean(racer.is_female || racer.gender === "F"),
    };

    if (isST) {
      if (!acc.validStN || (type === "start_no_f" && acc.fCount !== 0)) continue;
      const baselineAvgSt = weightedVenueStBaseline(data,racer.grade,racer,courses);
      if (baselineAvgSt == null) continue;
      const avgSt = acc.stSum / acc.validStN;
      const adjustedSt = shrinkMeanClient(acc.stSum,acc.validStN,baselineAvgSt,shrinkK);
      rows.push({...base,n:acc.validStN,total_starts:acc.starts,avgSt,adjustedSt,
        baselineAvgSt,diffAdjusted:Number(adjustedSt)-Number(baselineAvgSt),
        f_count:acc.fCount,l_count:acc.lCount});
      continue;
    }

    let count;
    let baselineRate;
    let metric;
    if (kimarite) {
      count = acc.kimarite[kimarite];
      baselineRate = weightedVenueKimariteBaseline(data,racer.grade,racer,courses,kimarite);
      metric = kimarite === "逃げ" ? "nige_win_rate_per_start" : "kimarite_win_rate_per_start";
    } else if (type === "ren3" || type === "dash") {
      count = acc.ren3;
      baselineRate = weightedVenueBaseline(data,racer.grade,racer,courses,"ren3_rate");
      metric = "ren3_rate";
    } else {
      count = acc.wins;
      baselineRate = weightedVenueBaseline(data,racer.grade,racer,courses,"win_rate");
      metric = "win_rate";
    }
    if (baselineRate == null) continue;
    const rawRate = ratePctClient(count,acc.starts);
    const adjRate = shrinkRatePctClient(count,acc.starts,baselineRate,shrinkK);
    const row = {...base,n:acc.starts,count,rawRate,adjRate,baselineRate,
      diffPtAdjusted:Number(adjRate)-Number(baselineRate)};
    if (type === "attack" && row.diffPtAdjusted <= 0) continue;
    rows.push(row);
  }

  return {
    rows,
    metric:isST ? "avg_st"
      : kimarite ? (kimarite === "逃げ" ? "nige_win_rate_per_start" : "kimarite_win_rate_per_start")
        : (type === "ren3" || type === "dash") ? "ren3_rate" : "win_rate",
    kimarite,
    sort:isST ? "adjustedSt_asc"
      : type === "in_unstable" ? "adjRate_asc"
        : type === "attack" ? "diffPtAdjusted_desc" : "adjRate_desc",
    courses,
    grades,
  };
}

function rankingViewV25() {
  const selected = (value,current) => value===current ? "selected" : "";
  return `
    <section class="section shell">
      <div class="section-title">
        <div><div class="kicker">RANKINGS</div><h2>WAKEランキング</h2></div>
        <p>${state.useAdjusted ? "補正値で順位付け" : "実測値で順位付け"}</p>
      </div>
      <div class="mode-panel"><div><strong>${modeText()}</strong><p>級別・コース・女子条件を自由に組み合わせて比較できます。</p></div>${adjustedSwitch()}</div>
      <div class="filters ranking-filters ranking-filters-v25">
        <div class="field"><label>ランキング</label><select id="rankingType">
          ${RANKING_TYPES_V25.map(([v,n])=>`<option value="${v}" ${selected(v,state.rankingType)}>${n}</option>`).join("")}
        </select></div>
        <div class="field"><label>級別</label><select id="rankingGrade">
          <option value="ALL" ${selected("ALL",state.rankingGrade)}>全級</option>
          <option value="A" ${selected("A",state.rankingGrade)}>A級（A1・A2）</option>
          <option value="B" ${selected("B",state.rankingGrade)}>B級（B1・B2）</option>
          ${["A1","A2","B1","B2"].map((g)=>`<option ${selected(g,state.rankingGrade)}>${g}</option>`).join("")}
        </select></div>
        <div class="field"><label>コース</label><select id="rankingCourse">
          <option value="DEFAULT" ${selected("DEFAULT",state.rankingCourse)}>ランキング既定</option>
          <option value="ALL" ${selected("ALL",state.rankingCourse)}>全コース</option>
          ${[1,2,3,4,5,6].map((c)=>`<option value="${c}" ${selected(String(c),state.rankingCourse)}>${c}コース</option>`).join("")}
          <option value="3-6" ${selected("3-6",state.rankingCourse)}>3〜6コース</option>
          <option value="4-6" ${selected("4-6",state.rankingCourse)}>4〜6コース</option>
        </select></div>
        <div class="field"><label>出走場（本日開催）</label><select id="rankingVenue">${venueOptions({mode:"ranking",selected:state.rankingVenue}).html}</select></div>
        <div class="field"><label>ランキング成績基準</label><select id="rankingBasis">
          <option value="VENUE" ${selected("VENUE",state.rankingBasis)}>選択場の成績</option>
          <option value="ALL" ${selected("ALL",state.rankingBasis)}>全場の成績</option>
        </select></div>
        <div class="field"><label>過去レース区分</label><select id="rankingRaceClass">
          <option value="ALL" ${selected("ALL",state.rankingRaceClass)}>指定なし</option>
          <option value="WOMEN" ${selected("WOMEN",state.rankingRaceClass)}>女子戦</option>
          <option value="MIXED" ${selected("MIXED",state.rankingRaceClass)}>男女混合戦</option>
        </select></div>
        <div class="field"><label>最低走数</label><input id="rankMinN" type="number" min="1" value="${state.rankingType==="in_unstable"?50:30}"></div>
        <div class="field check-field"><label>選手条件</label><label class="compact-check"><input id="rankingFemaleOnly" type="checkbox" ${state.rankingFemaleOnly?"checked":""}><span>女子選手のみ</span></label></div>
        <div class="field action-field"><label>&nbsp;</label><button class="primary" id="rankReload">表示</button></div>
      </div>
      <div class="sub-filter-row">${todayFilterControl()}<span class="sub-filter-note">女子・女子戦/混合戦・級別・コースは同時指定できます</span></div>
      <div id="rankingDescription" class="ranking-description"></div>
      <div id="rankingResult" class="table-wrap"><div class="empty">読み込み中…</div></div>
      <div class="notice">母数(n)は必ず併記します。女子戦・男女混合戦は過去2年の各レースの出走構成で分類した成績です。</div>
    </section>`;
}

function persistRankingV25() {
  localStorage.setItem("wake_ranking_type",state.rankingType);
  localStorage.setItem("wake_ranking_grade",state.rankingGrade);
  localStorage.setItem("wake_ranking_course",state.rankingCourse);
  localStorage.setItem("wake_ranking_female",state.rankingFemaleOnly?"1":"0");
  localStorage.setItem("wake_ranking_race_class",state.rankingRaceClass);
  localStorage.setItem("wake_ranking_venue",state.rankingVenue);
  localStorage.setItem("wake_ranking_basis",state.rankingBasis);
}

async function loadRankingV25() {
  const box = $("#rankingResult");
  const type = $("#rankingType")?.value || state.rankingType;
  const gradeValue = $("#rankingGrade")?.value || state.rankingGrade;
  const courseValue = $("#rankingCourse")?.value || state.rankingCourse;
  const femaleOnly = Boolean($("#rankingFemaleOnly")?.checked);
  const raceClass = $("#rankingRaceClass")?.value || "ALL";
  const minN = Math.max(1,Number($("#rankMinN")?.value||30));
  const placeValue = $("#rankingVenue")?.value || "ALL";
  const placeNo = placeValue === "ALL" ? "ALL" : Number(placeValue);
  const requestedBasis = $("#rankingBasis")?.value || "VENUE";
  const effectiveBasis = placeNo === "ALL" ? "ALL" : requestedBasis;
  Object.assign(state,{rankingType:type,rankingGrade:gradeValue,rankingCourse:courseValue,
    rankingFemaleOnly:femaleOnly,rankingRaceClass:raceClass,rankingVenue:String(placeValue),rankingBasis:requestedBasis});
  persistRankingV25();

  try {
    let source;
    if (raceClass !== "ALL") {
      const historical = await getJson(`${DATA_ROOT}/index/historical_race_classes.json`);
      const classData = historical?.classes?.[raceClass];
      source = effectiveBasis === "ALL" ? classData?.all : classData?.venues?.[String(placeNo)];
      if (!source) throw new Error("過去レース区分データを取得できません");
    } else {
      source = effectiveBasis === "ALL"
        ? await getJson(`${DATA_ROOT}/index/ranking_source.json`)
        : await getJson(venueDataPath(placeNo));
    }
    const data = buildRankingDataV25(source,{type,gradeValue,courseValue,femaleOnly});
    let rows = data.rows.filter((r)=>Number(r.n)>=minN);
    if (state.todayOnly) rows = keepToday(rows,placeNo);
    rows = sortRankingRows(rows,data);
    if (state.todayOnly && placeNo !== "ALL") {
      const order = new Map(rows.map((r,i)=>[Number(r.regno),i]));
      rows = [...rows].sort((a,b)=>earliestTodayRaceNo(a.regno,placeNo)-earliestTodayRaceNo(b.regno,placeNo)
        || (order.get(Number(a.regno))??Infinity)-(order.get(Number(b.regno))??Infinity));
    }

    const typeLabel = RANKING_TYPES_V25.find(([v])=>v===type)?.[1] || type;
    const venueLabel = placeNo === "ALL" ? "全場" : placeNames[placeNo];
    const gradeLabel = $("#rankingGrade")?.selectedOptions?.[0]?.textContent || gradeValue;
    $("#rankingDescription").innerHTML = `<strong>${esc(typeLabel)}</strong><span>${esc(RANKING_DESC_V25[type]||"")}</span>
      <div class="ranking-context-row"><span class="ranking-venue-context">${esc(venueLabel)}・${esc(effectiveBasis==="ALL"?"全場成績":"選択場成績")}</span>
      <span class="ranking-basis-context">${esc(gradeLabel)}・${esc(rankingCourseLabelV25(data.courses))}</span>
      ${femaleOnly?`<span class="ranking-female-context">女子のみ</span>`:""}
      ${raceClass!=="ALL"?`<span class="ranking-order-context">過去${raceClass==="WOMEN"?"女子戦":"男女混合戦"}成績</span>`:""}</div>`;

    if (!rows.length) {
      box.innerHTML = `<div class="empty">該当データなし</div>`;
      return;
    }
    const isST = data.metric === "avg_st";
    const metricLabel = rankingMetricLabel(data);
    box.innerHTML = `<table><thead><tr><th>#</th><th>選手</th><th>級別</th><th>支部</th><th>母数(n)</th>
      <th>${isST?"平均ST":esc(metricLabel)}</th>${isST?"<th>F</th>":"<th>基準差</th>"}</tr></thead><tbody>
      ${rows.slice(0,200).map((r,i)=>`<tr data-open="${r.regno}"><td class="rank">${i+1}</td>
        <td><strong>${esc(r.name)}</strong>${rankingGenderBadgeV25(r)}<div class="meta">#${r.regno}</div>${todayInline(r.regno,placeNo)}</td>
        <td>${esc(r.grade||"—")}</td><td>${esc(r.branch||"—")}</td><td>${r.n}</td>
        ${isST
          ? `<td class="rate">${fmt(state.useAdjusted?r.adjustedSt:r.avgSt,3)}${state.useAdjusted?`<div class="meta">（実測 ${fmt(r.avgSt,3)}）</div>`:""}</td><td>${r.f_count??0}</td>`
          : `<td class="rate">${fmt(state.useAdjusted?r.adjRate:r.rawRate)}%${state.useAdjusted?`<div class="meta">（実測 ${fmt(r.rawRate)}%）</div>`:""}</td>
             <td class="${Number(state.useAdjusted?r.diffPtAdjusted:Number(r.rawRate)-Number(r.baselineRate))>=0?"pos":"neg"}">${fmt(state.useAdjusted?r.diffPtAdjusted:Number(r.rawRate)-Number(r.baselineRate))}pt</td>`}
      </tr>`).join("")}</tbody></table>`;
    $$('[data-open]',box).forEach((tr)=>tr.addEventListener("click",()=>{location.hash=`#/racer/${tr.dataset.open}`;}));
  } catch (error) {
    box.innerHTML = `<div class="empty error">${esc(error.message||error)}</div>`;
  }
}

async function renderRanking() {
  shell(rankingViewV25());
  bindGlobalControls();
  const reload = () => loadRankingV25();
  ["rankingType","rankingGrade","rankingCourse","rankingVenue","rankingBasis","rankingRaceClass","rankingFemaleOnly"]
    .forEach((id)=>$(`#${id}`)?.addEventListener("change",()=>{
      if (id === "rankingType") {
        const input = $("#rankMinN");
        if (input) input.value = $("#rankingType")?.value === "in_unstable" ? "50" : "30";
      }
      reload();
    }));
  let timer;
  $("#rankMinN")?.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(reload,180);});
  $("#rankReload")?.addEventListener("click",reload);
  bindTodayToggle(()=>renderRanking());
  reload();
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

const KIMARITE_COLORS = {
  "逃げ": "#35e0d0",
  "差し": "#4d8fff",
  "まくり": "#78e3a8",
  "まくり差し": "#21bfa8",
  "抜き": "#f1c75b",
  "恵まれ": "#8697aa",
};

const KIMARITE_ORDER = ["逃げ", "差し", "まくり", "まくり差し", "抜き", "恵まれ"];

function kimariteDonutGradient(items, winN) {
  if (!winN || !items?.length) {
    return "conic-gradient(rgba(116,142,165,.18) 0deg 360deg)";
  }

  const byName = new Map((items || []).map((x) => [String(x.kimarite), Number(x.count || 0)]));
  let deg = 0;
  const parts = [];

  for (const name of KIMARITE_ORDER) {
    const count = byName.get(name) || 0;
    if (count <= 0) continue;
    const next = deg + (count / winN) * 360;
    parts.push(`${KIMARITE_COLORS[name] || "#8ea4b8"} ${deg.toFixed(3)}deg ${next.toFixed(3)}deg`);
    deg = next;
  }

  // 端数や未知の決まり手があってもリングに穴を作らない。
  if (deg < 359.999) {
    parts.push(`rgba(116,142,165,.18) ${deg.toFixed(3)}deg 360deg`);
  }

  return `conic-gradient(${parts.join(",")})`;
}

function kimariteDonuts(rows, courseStats) {
  const breakdown = new Map(
    (rows || []).map((c) => [Number(c.course), c])
  );

  // ユーザー要望: そのコースを1走でもしていればカード自体は表示。
  const courses = [...(courseStats || [])]
    .filter((c) => Number(c.n || 0) >= 1)
    .sort((a,b) => Number(a.course) - Number(b.course));

  if (!courses.length) return `<div class="empty">決まり手データなし</div>`;

  return `
    <div class="kimarite-donut-grid">
      ${courses.map((courseRow) => {
        const course = Number(courseRow.course);
        const startsN = Number(courseRow.n || 0);
        const winN = Number(courseRow.finish_counts?.win || 0);
        const courseWinRate = startsN > 0 ? 100 * winN / startsN : 0;
        const row = breakdown.get(course);
        const items = [...(row?.items || [])]
          .filter((x) => Number(x.count || 0) > 0)
          .sort((a,b) => {
            const ai = KIMARITE_ORDER.indexOf(String(a.kimarite));
            const bi = KIMARITE_ORDER.indexOf(String(b.kimarite));
            return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
          });

        const gradient = kimariteDonutGradient(items, winN);

        return `
          <article class="kimarite-donut-card">
            <div class="kimarite-card-head">
              <div>
                <strong>${course}コース</strong>
                <div class="kimarite-sample">
                  <span>出走 <b>${startsN}走</b></span>
                  <span class="kimarite-sample-sep">/</span>
                  <span>1着 <b>${winN}回</b></span>
                </div>
              </div>
            </div>

            <div class="kimarite-donut-body">
              <div
                class="kimarite-donut ${winN === 0 ? "is-empty" : ""}"
                style="background:${gradient}"
                role="img"
                aria-label="${course}コース 1着${winN}回の決まり手構成"
              >
                <div class="kimarite-donut-hole">
                  <span>1着</span>
                  <b>${winN}回</b>
                </div>
              </div>

              <div class="kimarite-legend">
                <div class="kimarite-course-winrate">
                  <span>このコースの1着率</span>
                  <strong>${fmt(courseWinRate)}%</strong>
                </div>
                ${winN > 0 ? items.map((x) => {
                  const count = Number(x.count || 0);
                  const pctRaw = winN > 0 ? 100 * count / winN : 0;
                  const color = KIMARITE_COLORS[String(x.kimarite)] || "#8ea4b8";
                  return `
                    <div class="kimarite-legend-row">
                      <span class="kimarite-legend-name">
                        <i style="background:${color}"></i>${esc(x.kimarite)}
                      </span>
                      <span class="kimarite-legend-value">
                        <b>${count}回</b>
                        <small>${fmt(pctRaw)}%</small>
                      </span>
                    </div>`;
                }).join("") : `
                  <div class="kimarite-no-win">
                    <strong>勝利データなし</strong>
                    <span>このコースでは集計期間内に1着がありません。</span>
                  </div>
                `}
              </div>
            </div>
          </article>`;
      }).join("")}
    </div>

    <div class="notice kimarite-note">
      決まり手は<strong>そのコースで1着になったレース</strong>の勝ち方を集計しています。
      各カードに「出走○走 / 1着○回 / 1着率○%」を分けて表示します。
      1着が1回でもあれば決まり手構成比を表示し、1着0回でもそのコースを1走以上していればカードは表示します。
      <br>※ ドーナツは実測の勝利内構成です。「この選手の意外な一面」の判定は、低母数の偶然を避けるため従来どおり補正値を使用します。
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
  if (!x || Number(x.n || 0) < 1) {
    return `
      <article class="defense-card defense-card-empty">
        <div class="defense-title">${label}</div>
        <div class="meta">該当データなし</div>
      </article>`;
  }

  const finishDiff = Number(x.avg_finish_diff);
  const top3Diff = Number(x.top3_diff_pt);
  const isReference = Number(x.n) < 8;
  const finishText = finishDiff < 0
    ? `基準より ${fmt(Math.abs(finishDiff),2)}着 良い`
    : finishDiff > 0
      ? `基準より ${fmt(finishDiff,2)}着 悪い`
      : "基準と同じ";
  const top3Sign = top3Diff >= 0 ? "+" : "";

  return `
    <article class="defense-card ${isReference ? "defense-reference" : ""}">
      <div class="defense-card-head">
        <div class="defense-title">${label}</div>
        ${isReference ? `<span class="reference-badge">参考値</span>` : ""}
      </div>
      <div class="defense-big">${x.n}回</div>
      <dl>
        <div><dt>平均着順</dt><dd>${fmt(x.avg_finish,2)}着</dd></div>
        <div><dt>全体基準</dt><dd>${fmt(x.baseline_avg_finish,2)}着</dd></div>
        <div><dt>比較</dt><dd class="${finishDiff <= 0 ? "pos" : "neg"}">${finishText}</dd></div>
        <div><dt>3着内率</dt><dd>${fmt(x.top3_rate)}%</dd></div>
        <div><dt>全体基準</dt><dd>${fmt(x.baseline_top3_rate)}%</dd></div>
        <div><dt>基準差</dt><dd class="${top3Diff >= 0 ? "pos" : "neg"}">${top3Sign}${fmt(top3Diff)}pt</dd></div>
      </dl>
      ${isReference ? `<div class="reference-note">※ 8件未満のため参考値です。数値は実測データをそのまま表示しています。</div>` : ""}
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
      <strong>1件から表示</strong>し、8件未満は参考値として明示します。
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
          <h2>コース別・勝った時の決まり手</h2>
          <p>1着1回から構成比を表示 / 分母表記あり</p>
        </div>
        ${kimariteDonuts(d.win_kimarite_breakdown, d.course_stats)}

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
  const callback = captureGoogleCallback();
  if (callback || location.hash === "#/google-access") {
    await renderGoogleAccess(callback ? "Googleログインを確認しました。続けて利用申請してください。" : "");
    return;
  }
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

    const todayIso = todayJstIso();
    const todayMetaValid = todayMeta
      && Array.isArray(todayMeta.racers)
      && String(todayMeta.date || "") === todayIso
      && Number(todayMeta.racer_count || 0) > 0;

    state.todayMetaStatus = todayMetaValid
      ? "ok"
      : todayMeta && String(todayMeta.date || "") !== todayIso
        ? "stale"
        : "error";

    state.todayMeta = todayMetaValid ? todayMeta : null;
    state.todayByRegno = new Map(
      (state.todayMeta?.racers || []).map((r) => [Number(r.regno), r])
    );

    if (!todayMetaValid) {
      state.todayOnly = false;
      localStorage.removeItem("wake_today_only");
      if (todayMeta?.date) {
        console.warn(
          `today_entries stale/unavailable: file_date=${todayMeta.date} jst_today=${todayIso}`
        );
      }
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
  if (h === "google-access") return renderGoogleAccess();
  if (h.startsWith("racer/")) return renderRacer(h.split("/")[1]);
  if (h === "reverse") return renderReverse();
  if (h === "ranking") return renderRanking();
  return renderHome();
}

window.addEventListener("hashchange", route);
boot();
