/* =========================
   Haftara mini-site v2 (CSV)
   ========================= */

// Reuse a single <audio> instance for better performance and fewer glitches.
let currentAudio = null;
let currentBox = null;
let currentPlayingBoxId = null;
let currentPlayingLabel = "";
let currentPlayingFile = "";


// Verse-by-verse (sequential) playback
let sequentialMode = false;
let sequentialIndex = -1;
let sequentialRepeat = 1; // 1..10 repeats per verse
let sequentialRepeatLeft = 1;
let lastSpeed = 1.0;
let verseList = []; // filled after loading psukim, order matters
let boxIdToIndex = new Map();
let sequentialBtnEl = null;

const AUDIO_DIR = "audio/";
const DATA_DIR = "data/";

const BUILD_VERSION = "v15";
const BUILD_TIMESTAMP = "2026-02-25 19:27:44";
const BUILD_LABEL = `${BUILD_VERSION} ${BUILD_TIMESTAMP}`;

/* ---------- UI helpers ---------- */

function setStatus(msg) {
  const el = document.getElementById("status");
  const finalMsg = msg ? `${msg} · ${BUILD_LABEL}` : BUILD_LABEL;
  if (el) el.textContent = finalMsg;
  const bf = document.getElementById("buildFooter");
  if (bf) bf.textContent = `Build: ${BUILD_LABEL}`;
  console.log("[STATUS]", finalMsg);
}


function clearHighlight() {
  if (currentBox) {
    currentBox.classList.remove("playing");
    currentBox = null;
  }
}

function setHighlightById(boxId) {
  if (!boxId) { 
    clearHighlight();
    return;
  }
  const box = document.getElementById(boxId);
  if (!box) { 
    clearHighlight();
    return;
  }
  // Switch highlight with minimal "blink"
  if (currentBox && currentBox !== box) {
    currentBox.classList.remove("playing");
  }
  currentBox = box;
  currentBox.classList.add("playing");

  // Scroll to current verse (helps on mobile)
  try {
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (_) {}
}

function stopAudio() {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch (_) {}
  }
  clearHighlight();
  setStatus("⏹ נעצר.");
}


function updateSequentialButtonState() {
  if (!sequentialBtnEl) return;
  if (sequentialMode) sequentialBtnEl.classList.add("active");
  else sequentialBtnEl.classList.remove("active");
}

function playVerseAtIndex(i, speed = 1.0) {
  if (!verseList || i < 0 || i >= verseList.length) return;
  const v = verseList[i];
  if (!v || !v.audioFile) {
    // skip missing audio
    const next = i + 1;
    if (sequentialMode && next < verseList.length) playVerseAtIndex(next, speed);
    return;
  }
  sequentialIndex = i;
  sequentialRepeatLeft = Math.max(1, sequentialRepeat|0);
  playAudio(v.audioFile, v.boxId, speed);
}

function toggleSequentialPlayback() {
  // Toggle on/off. When turning on: start from current verse if one is selected, otherwise from first.
  sequentialMode = !sequentialMode;
  updateSequentialButtonState();

  if (!sequentialMode) {
    sequentialIndex = -1;
    stopAudio();
    return;
  }

  // choose start index
  let startIdx = 0;
  if (currentBox && boxIdToIndex.has(currentBox.id)) {
    startIdx = boxIdToIndex.get(currentBox.id);
  }
  sequentialRepeatLeft = Math.max(1, sequentialRepeat|0);
  playVerseAtIndex(startIdx, lastSpeed);
}


/* ---------- Audio helpers ---------- */

function audioSrcCandidates(fileName) {
  // 3 options to handle different servers/OS path decoding:
  // 1) encodeURI on the full path (default)
  // 2) encode only the filename (encodeURIComponent) + audio/
  // 3) raw (no encoding) as last resort
  const raw = AUDIO_DIR + fileName;
  return [
    encodeURI(raw),
    AUDIO_DIR + encodeURIComponent(fileName),
    raw,
  ];
}

function getOrCreateAudio() {
  if (!currentAudio) {
    currentAudio = new Audio();
    // metadata מספיק לשמירת ביצועים; הדפדפן יטען לפי הצורך.
    currentAudio.preload = "metadata";
  }
  return currentAudio;
}

function normalizeAudioFileName(fileName) {
  // תיקון תאימות ל-v1/v2: אם קובץ נקרא "15.2-פסוק ב ..." אבל בפועל קיים "פסוק ב ..."
  // נחזיר גם אפשרות חלופית (fallback) בלי הקידומת.
  const original = (fileName || "").trim();
  if (!original) return { original: "", fallback: "" };

  const m = original.match(/^\d+(?:\.\d+)?\s*-(.+)$/);
  const fallback = m ? (m[1] || "").trim() : "";
  return { original, fallback };
}

function wireCommonAudioEvents(audio, label) {
  audio.addEventListener("playing", () => setStatus("▶ מנגן: " + label));
  audio.addEventListener("ended", () => {
    setStatus("✅ הסתיים: " + label);
    clearHighlight();
  });
  audio.addEventListener("error", () => {
    setStatus("❌ שגיאת טעינה/ניגון: " + label);
      if (sequentialMode) { sequentialMode = false; updateSequentialButtonState(); }
      clearHighlight();
  });
}

async function playAudio(fileName, boxId = null, speed = 1.0) {
  lastSpeed = speed;
  if (!fileName || !fileName.trim()) {
    setStatus("ℹ אין קובץ קריאה משויך לפסוק זה.");
    return;
  }

  const names = normalizeAudioFileName(fileName);
  const label = names.original;
  currentPlayingBoxId = boxId;
  currentPlayingLabel = label;
  currentPlayingFile = names.original;

  try {
    stopAudio();

    if (boxId) setHighlightById(boxId);
    else clearHighlight();

    const audio = getOrCreateAudio();
    // ננקה מאזינים קודמים (כדי למנוע כפילויות)
    audio.onended = null;
    audio.onerror = null;
    audio.onplaying = null;
    audio.onloadedmetadata = null;

    // מאזיני סטטוס
    // Some browsers reset playbackRate on src change; enforce rate on metadata/playing.
    audio.onloadedmetadata = () => {
      try { audio.playbackRate = speed; } catch (_) {}
    };
    audio.onplaying = () => {
      try { audio.playbackRate = speed; } catch (_) {}
      setStatus("▶ מנגן: " + label + (speed !== 1 ? ` (×${speed})` : ""));
    };
    audio.onended = () => {
      // Sequential mode: repeat current verse N times, then advance.
      if (sequentialMode && boxId) {
        // repeats
        if (sequentialRepeatLeft > 1) {
          sequentialRepeatLeft -= 1;
          setStatus(`↻ חוזר על הפסוק… (נותרו ×${sequentialRepeatLeft})`);
          try {
            audio.currentTime = 0;
            audio.playbackRate = speed;
            audio.play();
          } catch (_) {}
          return;
        }

        // advance to next verse
        const idx = boxIdToIndex.get(boxId);
        if (typeof idx === "number" && idx >= 0) {
          const next = idx + 1;
          if (next < verseList.length) {
            setStatus("▶ ממשיך לפסוק הבא…");
            playVerseAtIndex(next, lastSpeed);
            return;
          } else {
            // reached end
            sequentialMode = false;
            updateSequentialButtonState();
            setStatus("✅ הסתיימה השמעה רציפה.");
            clearHighlight();
            return;
          }
        }
      }

      // non-sequential end
      setStatus("✅ הסתיים: " + label);
      clearHighlight();
    };

    let triedFallback = false;
    let triedAltEnc = false;
    audio.onerror = async () => {
      // 1) try alternate encoding for the SAME filename (common on Windows local servers)
      if (!triedAltEnc) {
        triedAltEnc = true;
        const cands = audioSrcCandidates(names.original);
        const next = (audio.src === cands[0]) ? cands[1] : cands[2];
        setStatus("⚠ מנסה נתיב חלופי לקובץ: " + label);
        audio.src = next;
        try { await audio.play(); return; } catch (_) {}
      }

      // 2) try fallback name (e.g. strip '15.2-' prefix)
      if (!triedFallback && names.fallback) {
        triedFallback = true;
        const fbLabel = names.fallback;
        setStatus("⚠ מנסה שם חלופי לקובץ: " + fbLabel);
        audio.src = audioSrcCandidates(names.fallback)[0];
        try { await audio.play(); return; } catch (_) {}
      }

      setStatus("❌ שגיאת טעינה/ניגון: " + label);
      clearHighlight();
    };

    // טעינה
    setStatus("טוען: " + label + (speed !== 1 ? ` (×${speed})` : ""));
    audio.src = audioSrcCandidates(names.original)[0];
    try { audio.playbackRate = speed; } catch (_) {}
    await audio.play();
  } catch (err) {
    setStatus("❌ play() נכשל: " + (err?.message || err));
    clearHighlight();
    console.error(err);
  }
}

async function playLoop(fileName, times, boxId = null, speed = 1.0) {
  if (!fileName || !fileName.trim()) {
    setStatus("ℹ אין קובץ קריאה משויך לפסוק זה.");
    return;
  }

  const names = normalizeAudioFileName(fileName);
  const label = names.original;

  try {
    stopAudio();

    if (boxId) setHighlightById(boxId);
    else clearHighlight();

    let count = 0;
    setStatus(`🔁 לופ ${times}x: ${label}` + (speed !== 1 ? ` (×${speed})` : ""));

    const audio = getOrCreateAudio();
    audio.onended = null;
    audio.onerror = null;
    audio.onplaying = null;
    audio.onloadedmetadata = null;

    let triedFallback = false;

    audio.onloadedmetadata = () => {
      try { audio.playbackRate = speed; } catch (_) {}
    };

    audio.onplaying = () => {
      try { audio.playbackRate = speed; } catch (_) {}
      setStatus(`🔁 מנגן (${count + 1}/${times}): ${label}` + (speed !== 1 ? ` (×${speed})` : ""));
    };

    audio.onended = async () => {
      count++;
      if (count < times) {
        audio.currentTime = 0;
        try { audio.playbackRate = speed; } catch (_) {}
        try {
          await audio.play();
        } catch (e) {
          setStatus("❌ ניגון לופ נכשל: " + (e?.message || e));
          clearHighlight();
          console.error(e);
        }
      } else {
        setStatus("✅ סיום לופ: " + label);
        clearHighlight();
      }
    };

    audio.onerror = async () => {
      if (!triedFallback && names.fallback) {
        triedFallback = true;
        const fbLabel = names.fallback;
        setStatus("⚠ שגיאה — מנסה שם חלופי לקובץ: " + fbLabel);
        audio.src = audioSrcCandidates(names.fallback)[0];
        try {
          await audio.play();
          return;
        } catch (_) {}
      }
      setStatus("❌ שגיאת טעינה/ניגון בלופ: " + label);
      clearHighlight();
    };

    audio.src = audioSrcCandidates(names.original)[0];
    try { audio.playbackRate = speed; } catch (_) {}
    await audio.play();
  } catch (err) {
    setStatus("❌ playLoop נכשל: " + (err?.message || err));
    clearHighlight();
    console.error(err);
  }
}


/* ---------- CSV helpers ---------- */

function showCsvFatalError(title, details) {
  try {
    const main = document.getElementById("main") || document.body;
    const box = document.createElement("div");
    box.className = "csv-error-box";
    box.innerHTML = `
      <div class="csv-error-title">❌ ${title}</div>
      <div class="csv-error-details">${details}</div>
      <div class="csv-error-hint">טיפ: שמור את ה-CSV כ- <b>CSV UTF-8</b> (ולא CSV רגיל של Excel), וודא שאין שורות עם פסיקים/מרכאות לא מאוזנות.</div>
    `;
    main.prepend(box);
  } catch (_) {}
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseCSV(text, sourceName = "(CSV)") {
  // CSV parser with validation + friendly line-number errors.
  // Treat " as a CSV quote ONLY when it starts a field.

  const rowsWithLine = []; // { row: string[], line: number }
  let i = 0;
  let field = "";
  let row = [];
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;

  const pushField = () => { row.push(field); field = ""; };

  const pushRow = () => {
    if (!(row.length === 1 && (row[0] || "").trim() === "")) {
      rowsWithLine.push({ row: row.slice(), line: rowStartLine });
    }
    row = [];
  };

  while (i < text.length) {
    const c = text[i];
    const prev = i === 0 ? "" : text[i - 1];

    if (c === "\n") {
      if (!inQuotes) {
        pushField();
        pushRow();
        line += 1;
        rowStartLine = line;
        i += 1;
        continue;
      }
      field += c;
      line += 1;
      i += 1;
      continue;
    }

    if (c === "\r") {
      const nextIsLF = text[i + 1] === "\n";
      if (!inQuotes) {
        pushField();
        pushRow();
        line += 1;
        rowStartLine = line;
        i += nextIsLF ? 2 : 1;
        continue;
      }
      field += "\n";
      line += 1;
      i += nextIsLF ? 2 : 1;
      continue;
    }

    if (c === '"') {
      const isFieldStart = (!inQuotes && field === "" && (i === 0 || prev === "," || prev === "\n" || prev === "\r"));
      if (isFieldStart) {
        inQuotes = true;
        i += 1;
        continue;
      }

      if (inQuotes) {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        const next = text[i + 1];
        if (next === "," || next === "\n" || next === "\r" || i + 1 >= text.length) {
          inQuotes = false;
          i += 1;
          continue;
        }
        field += '"';
        i += 1;
        continue;
      }

      field += '"';
      i += 1;
      continue;
    }

    if (!inQuotes && c === ",") {
      pushField();
      i += 1;
      continue;
    }

    field += c;
    i += 1;
  }

  pushField();
  if (row.length > 1 || (row.length === 1 && (row[0] || "").trim() !== "")) {
    rowsWithLine.push({ row: row.slice(), line: rowStartLine });
  }

  if (inQuotes) {
    const msg = `${sourceName}: מרכאות לא נסגרו (שדה במרכאות) החל משורה ${rowStartLine}.`;
    showCsvFatalError("שגיאה בקובץ CSV", escapeHtml(msg));
    throw new Error(msg);
  }

  if (rowsWithLine.length === 0) return [];

  rowsWithLine[0].row[0] = (rowsWithLine[0].row[0] || "").replace(/^\uFEFF/, "");

  const header = rowsWithLine[0].row.map(h => (h || "").trim());
  const headerLen = header.length;

  const out = [];
  for (let k = 1; k < rowsWithLine.length; k++) {
    const r = rowsWithLine[k].row;
    const ln = rowsWithLine[k].line;

    if (!r.some(x => String(x ?? "").trim() !== "")) continue;

    if (r.length !== headerLen) {
      const preview = escapeHtml(r.join(","));
      const msg = `${sourceName}: שורה ${ln} – מספר עמודות שגוי (נמצאו ${r.length} במקום ${headerLen}).`;
      showCsvFatalError("שגיאה בקובץ CSV", `${escapeHtml(msg)}<br><br><b>השורה:</b><br><code>${preview}</code>`);
      throw new Error(msg);
    }

    const obj = {};
    for (let j = 0; j < headerLen; j++) {
      obj[header[j]] = String(r[j] ?? "").trim();
    }
    out.push(obj);
  }

  return out;
}

async function loadCSV(path) {
  let res;
  try {
    res = await fetch(path, { cache: "no-store" });
  } catch (_) {
    const msg = `Fetch failed (network/CORS) for: ${path}`;
    showCsvFatalError("שגיאת טעינה", escapeHtml(msg));
    throw new Error(msg);
  }

  if (!res.ok) {
    const msg = `HTTP ${res.status} loading CSV: ${path}`;
    showCsvFatalError("שגיאת טעינה", escapeHtml(msg));
    throw new Error(msg);
  }

  let text = await res.text();

  text = text.replace(/^\uFEFF/, "");
  text = text.replace(/\u0000/g, "");
  text = text.replace(/\r\n/g, "\n");
  text = text.replace(/\r/g, "\n");

  let t = text.trim();

  if (t.startsWith("'") && t.endsWith("'") && t.includes("\n")) {
    t = t.slice(1, -1);
  }

  if (t.startsWith("'") && !t.startsWith("'\"") && t.includes(",") && t.includes("\n")) {
    t = t.slice(1);
  }

  return parseCSV(t, path);
}


/* ---------- Hebrew helpers (strip nikud) ---------- */

function stripNikud(s) {
  // ניקוד + טעמי מקרא: 0591-05C7
  return (s || "").replace(/[\u0591-\u05C7]/g, "");
}

/* עיצוב מילים לפי word_styles.csv:
   - rules: [{pasuk_id, word_plain, style_name}]
   - משווה לפי מילה בלי ניקוד
*/
function styleVerseText(pasukId, text, rules) {
  // rules יכול להיות גם Map שהוכן מראש (לשיפור ביצועים)
  if (!rules) return text;

  const tokens = (text || "").split(" ");

  const styledTokens = tokens.map(tok => {
    // פיצול פיסוק מהתחלה/סוף כדי להשוות רק אותיות עבריות
    const lead = tok.match(/^[^\u05D0-\u05EA]+/u)?.[0] || "";
    const trail = tok.match(/[^\u05D0-\u05EA]+$/u)?.[0] || "";
    const mid = tok.slice(lead.length, tok.length - trail.length);

    const midPlain = stripNikud(mid);

    const styleName =
      rules instanceof Map
        ? (rules.get(pasukId)?.get(midPlain) || "")
        : (rules.find(r => r.pasuk_id === pasukId && (r.word_plain || "").trim() === midPlain)?.style_name || "");

    if (styleName) {
      const cls = String(styleName).trim();
      if (cls) return `${lead}<span class="${cls}">${mid}</span>${trail}`;
    }
    return tok;
  });

  return styledTokens.join(" ");
}

/* ---------- Render helpers ---------- */

function makeButton(label, onClickJs, extraClass = "", disabled = false) {
  const btn = document.createElement("button");
  btn.textContent = label;

  if (extraClass) btn.className = extraClass;

  if (disabled) {
    btn.disabled = true;
  } else {
    btn.setAttribute("onclick", onClickJs);
  }

  return btn;
}

function safeIdFromPasukId(pasukId) {
  // 15.2 -> pasuk-15-2
  return "pasuk-" + String(pasukId).replace(".", "-");
}

/* ---------- Main page rendering (CSV -> DOM) ---------- */


function renderTextBlocksInto(container, textBlocks, location) {
  if (!container) return;
  const blocks = (textBlocks || [])
    .filter(b => (b.location || "").trim() === location)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

  for (const b of blocks) {
    const box = document.createElement("div");
    box.className = (b.style_name || "note-box").trim() || "note-box";
    box.innerHTML = b.html || "";
    container.appendChild(box);
  }
}

async function renderMain() {
  // טוענים CSV עם פירוט תקלות
  const siteRows = await loadCSV(DATA_DIR + "site.csv");
  if (!siteRows || siteRows.length === 0) throw new Error("site.csv is empty");
  const site = siteRows[0];

  const psukim = await loadCSV(DATA_DIR + "psukim.csv");

  // Prepare verse list for sequential playback (order as in psukim.csv)
  verseList = [];
  boxIdToIndex = new Map();

  const wordRulesRaw = await loadCSV(DATA_DIR + "word_styles.csv");
  const textBlocks = await loadCSV(DATA_DIR + "text_blocks.csv");

  // Index word styles by pasuk_id + word_plain (בלי ניקוד) לשיפור ביצועים
  const wordRules = new Map();
  for (const r of wordRulesRaw) {
    const pid = (r.pasuk_id || "").trim();
    const w = stripNikud((r.word_plain || "").trim());
    const s = (r.style_name || "").trim();
    if (!pid || !w || !s) continue;
    if (!wordRules.has(pid)) wordRules.set(pid, new Map());
    wordRules.get(pid).set(w, s);
  }


  // Page Top blocks (above main header)
  const pageTop = document.getElementById("pageTop");
  if (pageTop) {
    pageTop.innerHTML = "";
    renderTextBlocksInto(pageTop, textBlocks, "page_top");
  }

  // Header
  const header = document.getElementById("pageHeader");
  if (!header) throw new Error("Missing #pageHeader in index.html");
  header.innerHTML = ""; 

  const fullAudio = (site.audio_file || "").trim();

  const title = document.createElement("h1");
  title.className = ((site.title_style || "main-title").toString().trim() || "main-title").replace(/\s+/g, " ");
  title.textContent = (site.title || "אתר לימוד").toString();
  // If the site has a title audio file, make the title clickable to play it
  if (fullAudio) {
    title.classList.add("has-audio");
    title.title = "לחץ להפעלת הקראת הכותרת";
    title.addEventListener("click", () => playAudio(fullAudio));
  }
  header.appendChild(title);

  const hb = document.createElement("div");
  hb.className = "header-buttons";

  hb.appendChild(makeButton("▶ נגן את כל ההפטרה", `playAudio('${fullAudio}')`, "", !fullAudio));
  // Sequential verse-by-verse playback toggle
  sequentialBtnEl = makeButton("🔁 השמע פסוק פסוק", "toggleSequentialPlayback()", "seq", false);
  hb.appendChild(sequentialBtnEl);

  // repeat selector (×1..×10)
  const seqRepeatSelect = document.createElement("select");
  seqRepeatSelect.id = "seqRepeatSelect";
  seqRepeatSelect.className = "seq-repeat-select";
  for (let k = 1; k <= 10; k++) {
    const opt = document.createElement("option");
    opt.value = String(k);
    opt.textContent = `×${k}`;
    if (k === 1) opt.selected = true;
    seqRepeatSelect.appendChild(opt);
  }
  seqRepeatSelect.addEventListener("change", () => {
    const v = parseInt(seqRepeatSelect.value, 10);
    sequentialRepeat = (isFinite(v) && v >= 1 && v <= 10) ? v : 1;
    sequentialRepeatLeft = sequentialRepeat;
    setStatus(`🔁 חזרות לכל פסוק: ×${sequentialRepeat}`);
  });
  hb.appendChild(seqRepeatSelect);
  hb.appendChild(makeButton("🐢 איטי ×0.75", `playAudio('${fullAudio}', null, 0.75)`, "", !fullAudio));
  hb.appendChild(makeButton("🐇 מהיר ×1.5", `playAudio('${fullAudio}', null, 1.5)`, "", !fullAudio));
  hb.appendChild(makeButton("🐢🐢 איטי ×0.5", `playAudio('${fullAudio}', null, 0.5)`, "", !fullAudio));
  hb.appendChild(makeButton("⏹ עצור", "stopAudio()", "stop", false));
  header.appendChild(hb);
  updateSequentialButtonState();

  // Link to styles page

  // Text blocks
  const dynFooter = document.getElementById("dynamicTextFooter");
  if (!dynFooter) throw new Error("Missing #dynamicTextFooter in index.html");

  // page_header blocks go INSIDE the header card (as in v1)
  const headerBlocks = (textBlocks || [])
    .filter(b => (b.location || "").trim() === "page_header")
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

  for (const b of headerBlocks) {
    const div = document.createElement("div");
    div.className = (b.style_name || "note-box").trim() || "note-box";
    div.innerHTML = b.html || "";
    header.appendChild(div);
  }

  // page_footer blocks go below the psukim list
  const footerBlocks = (textBlocks || [])
    .filter(b => (b.location || "").trim() === "page_footer")
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

  dynFooter.innerHTML = "";
  for (const b of footerBlocks) {
    const div = document.createElement("div");
    div.className = (b.style_name || "note-box").trim() || "note-box";
    div.innerHTML = b.html || "";
    dynFooter.appendChild(div);
  }

  // Verses
  const container = document.getElementById("psukimContainer");
  if (!container) throw new Error("Missing #psukimContainer in index.html");
  container.innerHTML = "";

  for (const p of psukim) {
    const pasukId = (p.pasuk_id || "").trim();
    const boxId = safeIdFromPasukId(pasukId);
    const audioFileForSeq = (p.audio_file || "").trim();
    const idxSeq = verseList.length;
    verseList.push({ pasukId, boxId, audioFile: audioFileForSeq });
    boxIdToIndex.set(boxId, idxSeq);


    const box = document.createElement("div");
    box.className = "pasuk";
    box.id = boxId;

    const btnRow = document.createElement("div");
    btnRow.className = "buttons";

    const audioFile = (p.audio_file || "").trim();
    const hasAudio = audioFile.length > 0;

    if (!hasAudio) box.classList.add("no-audio");

    btnRow.appendChild(makeButton("▶ הפעלה", `playAudio('${audioFile}','${boxId}')`, "", !hasAudio));
    btnRow.appendChild(makeButton("🔁 לופ x10", `playLoop('${audioFile}',10,'${boxId}')`, "", !hasAudio));
    btnRow.appendChild(makeButton("🐢 ×0.75", `playAudio('${audioFile}','${boxId}',0.75)`, "", !hasAudio));
    btnRow.appendChild(makeButton("🐇 ×1.5", `playAudio('${audioFile}','${boxId}',1.5)`, "", !hasAudio));
    btnRow.appendChild(makeButton("🐢🐢 ×0.5", `playAudio('${audioFile}','${boxId}',0.5)`, "", !hasAudio));
    btnRow.appendChild(makeButton("⏹ עצור", "stopAudio()", "stop", false));

    const textP = document.createElement("p");
    textP.className = "pasuk-text";

    const label = document.createElement("strong");
    label.className = "pasuk-label";
    label.textContent = (p.display_ref || "").trim();
    textP.appendChild(label);

    const styled = styleVerseText(pasukId, p.text || "", wordRules);
    const span = document.createElement("span");
    span.innerHTML = " " + styled;
    textP.appendChild(span);

    box.appendChild(btnRow);
    box.appendChild(textP);
    container.appendChild(box);
  }

  setStatus("✅ נטען בהצלחה מהדאטה־בייס (CSV). · v13 2026-02-25 17:03:39");
}

/* ---------- Styles page rendering (CSS -> list) ---------- */

async function renderStyles() {
  const cssRes = await fetch("style.css", { cache: "no-store" });
  if (!cssRes.ok) throw new Error(`HTTP ${cssRes.status} loading style.css`);
  let cssText = await cssRes.text();

  // strip comments
  cssText = cssText.replace(/\/\*[\s\S]*?\*\//g, "");

  // Extract ALL selectors that appear before "{", including:
  // .main-title , #status , .pasuk.playing , .buttons button , etc.
  const selectorSet = new Set();

  // naive, but robust enough for this project:
  // grab "something {", ignore @rules and keyframes frames (0%, 100%).
  const re = /([^{@}]+)\{/g;
  let m;
  while ((m = re.exec(cssText)) !== null) {
    const raw = (m[1] || "").trim();
    if (!raw) continue;

    // Ignore @media/@keyframes inner braces by filtering typical junk
    // (we keep actual selectors inside @media because they also appear here).
    const parts = raw.split(",").map(s => s.trim()).filter(Boolean);
    for (const sel of parts) {
      if (!sel) continue;
      if (sel.startsWith("@")) continue;
      if (/^\d+%$/.test(sel)) continue; // keyframes steps
      selectorSet.add(sel);
    }
  }

  const selectors = Array.from(selectorSet).sort((a, b) => a.localeCompare(b, "he"));

  const list = document.getElementById("stylesList");
  if (!list) throw new Error("Missing #stylesList in styles.html");
  list.innerHTML = "";


function normalizeSelector(sel) {
  // Remove pseudo-classes/elements for demo rendering (e.g. :hover, :active, ::before)
  // Keep structural tokens like spaces and '>' to build nested demo nodes.
  return sel
    .replace(/::?[a-zA-Z0-9\-]+(\([^\)]*\))?/g, "")
    .replace(/\[.*?\]/g, "") // attribute selectors
    .replace(/\s+/g, " ")
    .trim();
}

  function extractClasses(sel) {
    const out = [];
    const cre = /\.([a-zA-Z0-9\-_]+)/g;
    let cm;
    while ((cm = cre.exec(sel)) !== null) out.push(cm[1]);
    return out;
  }
  function extractId(sel) {
    const im = sel.match(/#([a-zA-Z0-9\-_]+)/);
    return im ? im[1] : null;
  }

  function makeDemoForSelector(sel) {
    const selNorm = normalizeSelector(sel);

    // Build a best-effort DOM that matches common selectors in this project.
    // We focus on demonstrating classes/IDs, plus a few structural selectors.
    const wrap = document.createElement("div");
    wrap.className = "note-box";
    wrap.style.marginBottom = "10px";

    const name = document.createElement("div");
    name.innerHTML = `<b>${escapeHtml(sel)}</b>`;
    name.style.marginBottom = "8px";
    wrap.appendChild(name);

    const demoArea = document.createElement("div");
    demoArea.style.padding = "8px";
    demoArea.style.border = "1px solid rgba(92,102,122,.18)";
    demoArea.style.borderRadius = "12px";
    demoArea.style.background = "rgba(255,255,255,.55)";

    const id = extractId(selNorm);
    const classes = extractClasses(selNorm);

    // Structural demo for ".buttons button" and similar
    if (selNorm.includes("button") && selNorm.includes(".buttons")) {
      const row = document.createElement("div");
      row.className = "buttons";
      const b1 = document.createElement("button");
      b1.textContent = "כפתור דוגמה";
      row.appendChild(b1);

      const b2 = document.createElement("button");
      b2.className = "stop";
      b2.textContent = "כפתור עצור";
      row.appendChild(b2);

      demoArea.appendChild(row);
      wrap.appendChild(demoArea);
      return wrap;
    }

    // Demo for ".pasuk.playing" (card)
    if (selNorm.includes(".pasuk") && selNorm.includes(".playing")) {
      const card = document.createElement("div");
      card.className = "pasuk playing";
      const row = document.createElement("div");
      row.className = "buttons";
      const b = document.createElement("button");
      b.textContent = "▶ הפעלה";
      row.appendChild(b);
      const s = document.createElement("button");
      s.className = "stop";
      s.textContent = "⏹ עצור";
      row.appendChild(s);

      const p = document.createElement("p");
      p.className = "pasuk-text";
      p.innerHTML = `<strong class="pasuk-label">פסוק לדוגמה)</strong> וַיֹּאמֶר ה'...`;

      card.appendChild(row);
      card.appendChild(p);
      demoArea.appendChild(card);
      wrap.appendChild(demoArea);
      return wrap;
    }

    // If selector targets a button directly
    if (selNorm.trim().startsWith("button") || selNorm.includes(" button")) {
      const btn = document.createElement("button");
      if (classes.length) btn.className = classes.join(" ");
      btn.textContent = "כפתור דוגמה";
      demoArea.appendChild(btn);
      wrap.appendChild(demoArea);
      return wrap;
    }


// If selector is a simple descendant chain (e.g. ".pasuk.playing .pasuk-text"),
// build a nested structure so styles actually apply.
if (selNorm.includes(" ") || selNorm.includes(">")) {
  const chain = selNorm.replace(/\s*>\s*/g, " > ").split(" ").filter(Boolean);
  // We'll only handle descendant and direct-child in a simple way.
  const root = document.createElement("div");
  let cur = root;

  for (let i = 0; i < chain.length; i++) {
    const part = chain[i];
    if (part === ">") continue;

    const el = document.createElement(part.startsWith("#") || part.startsWith(".") ? "div" : part || "div");
    const pid = extractId(part);
    const pcl = extractClasses(part);

    if (pid) el.id = pid;
    if (pcl.length) el.className = pcl.join(" ");

    // If this part is "button" create an actual button for better demo
    if (part.includes("button") || part === "button") {
      const b = document.createElement("button");
      b.textContent = "כפתור דוגמה";
      el.appendChild(b);
    } else {
      el.innerHTML = `טקסט דוגמה עבור: <span dir="rtl">אבגדה 123</span>`;
    }

    cur.appendChild(el);
    cur = el;
  }

  demoArea.appendChild(root);
  wrap.appendChild(demoArea);
  return wrap;
}

    // Default: make a div with extracted classes and id.
    const el = document.createElement("div");
    if (id) el.id = id;
    if (classes.length) el.className = classes.join(" ");
    el.innerHTML = `טקסט דוגמה עבור הסלקטור: <span dir="rtl">אבגדה 123</span>`;

    demoArea.appendChild(el);
    wrap.appendChild(demoArea);
    return wrap;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  for (const sel of selectors) {
    list.appendChild(makeDemoForSelector(sel));
  }

  setStatus("✅ נטענו סלקטורים מתוך CSS: " + selectors.length);
}


/* ---------- Boot ---------- */

document.addEventListener("DOMContentLoaded", async () => {
  try {
    if (window.__PAGE__ === "styles") {
      await renderStyles();
    } else {
      await renderMain();
    }
  } catch (e) {
    setStatus("❌ שגיאה בטעינת הדאטה־בייס (CSV): " + (e?.message || e));
    console.error(e);
  }
});