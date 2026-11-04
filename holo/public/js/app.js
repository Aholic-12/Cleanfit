import { createDecartClient, models } from "../vendor/decart/index.js";

/* ------------------------------------------------------------------ *
 *  Cleanfit · Decart Lucy VTON Realtime
 *  Webcam stream  ──WebRTC──▶  Decart (lucy-vton)  ──WebRTC──▶  transformed stream
 *
 *  Two auth modes (auto-selected):
 *   1. Direct key  — a key pasted in Settings is stored in localStorage and
 *      sent straight to the browser SDK (createDecartClient({ apiKey })).
 *      No backend needed, so this works on the pure-static deploy.
 *   2. Token mint  — if no key is stored locally, we call our backend
 *      (/api/realtime-token) which uses the server-side DECART_API_KEY to
 *      mint a 60s client token. Used when running `npm start` locally.
 * ------------------------------------------------------------------ */

const KEY_STORE = "cleanfit.decart.key";

const els = {
  out: document.getElementById("out"),
  cam: document.getElementById("cam"),
  pip: document.getElementById("pip"),
  placeholder: document.getElementById("placeholder"),
  viewerBadge: document.getElementById("viewerBadge"),
  metric: document.getElementById("metric"),

  fileInput: document.getElementById("fileInput"),
  dropZone: document.getElementById("dropZone"),
  dropHint: document.getElementById("dropHint"),
  garmentPreview: document.getElementById("garmentPreview"),
  btnClearGarment: document.getElementById("btnClearGarment"),

  prompt: document.getElementById("prompt"),
  mirror: document.getElementById("mirror"),
  fast: document.getElementById("fast"),

  btnConnect: document.getElementById("btnConnect"),
  hint: document.getElementById("hint"),

  statusPill: document.getElementById("statusPill"),
  statusText: document.getElementById("statusText"),

  notice: document.getElementById("notice"),
  btnSettings: document.getElementById("btnSettings"),
  settingsModal: document.getElementById("settingsModal"),
  keyInput: document.getElementById("keyInput"),
  btnSaveKey: document.getElementById("btnSaveKey"),
  btnCloseSettings: document.getElementById("btnCloseSettings"),
  creditNote: document.getElementById("creditNote"),
};

const state = {
  modelName: "lucy-vton-latest",
  modelDef: null,
  garmentDataUri: "",
  client: null,
  rt: null,
  localStream: null,
  connected: false,
  connecting: false,
  timer: null,
  startedAt: 0,
};

/* ------------------------------ helpers ------------------------------ */

function setStatus(kind, text) {
  els.statusPill.className = "pill pill--" + kind;
  els.statusText.textContent = text;
}
function setHint(text, isErr = false) {
  els.hint.textContent = text || "";
  els.hint.classList.toggle("err", Boolean(isErr));
}
function getKey() {
  try { return localStorage.getItem(KEY_STORE) || ""; } catch { return ""; }
}
function setKey(k) {
  try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE); } catch {}
}

async function readHealth() {
  try {
    const r = await fetch("/api/health", { cache: "no-store" });
    const j = await r.json();
    if (j.model) state.modelName = j.model;
    if (j.keyConfigured) els.notice.hidden = true;
  } catch {}
}

/** POST /api/realtime-token → short-lived client token.
 *  Falls through to a clear "paste a key" error when there is no backend
 *  (e.g. the pure-static deploy with no server.js running). */
async function mintToken() {
  let r;
  let j = {};
  try {
    r = await fetch("/api/realtime-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: getKey() || undefined }),
    });
    j = await r.json().catch(() => ({}));
  } catch {
    const err = new Error("无法连接后端 /api/realtime-token（纯静态部署请直接在「设置」里粘贴 Key）");
    err.code = "NO_BACKEND";
    throw err;
  }
  if (!r.ok || !j.apiKey) {
    const err = new Error(j.message || `token 接口返回 ${r.status}`);
    err.code = j.error || "TOKEN_ERROR";
    throw err;
  }
  if (j.model) state.modelName = j.model;
  return j.apiKey;
}

/** Downscale a garment image to ≤1024px and return a data URI (keeps payload light). */
function fileToDataUri(file, maxDim = 1024) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const isPng = /png|webp/i.test(file.type);
      resolve(c.toDataURL(isPng ? "image/png" : "image/jpeg", 0.92));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("图片读取失败")); };
    img.src = url;
  });
}

function refreshConnectState() {
  const ready = Boolean(state.garmentDataUri) && !state.connecting;
  els.btnConnect.disabled = !ready;
  if (state.connected) {
    els.btnConnect.disabled = false;
    els.btnConnect.textContent = "停止试穿";
    els.btnConnect.classList.remove("btn--primary");
    els.btnConnect.classList.add("btn--danger");
  } else {
    els.btnConnect.textContent = state.connecting ? "连接中…" : "开始试穿";
    els.btnConnect.classList.remove("btn--danger");
    els.btnConnect.classList.add("btn--primary");
    if (!state.garmentDataUri) setHint("先上传一件衣服");
    else if (!state.connecting) setHint("");
  }
}

/* ------------------------------ garment ------------------------------ */

async function handleFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) { setHint("请选择图片文件（PNG / JPG）", true); return; }
  try {
    const dataUri = await fileToDataUri(file);
    state.garmentDataUri = dataUri;
    els.garmentPreview.src = dataUri;
    els.garmentPreview.hidden = false;
    els.dropHint.hidden = true;
    els.btnClearGarment.hidden = false;
    setHint("");
    refreshConnectState();
    // live swap if already connected
    if (state.connected && state.rt) {
      await state.rt.setImage(dataUri).catch((e) => setHint("换装失败：" + e.message, true));
    }
  } catch (e) {
    setHint(e.message || "图片读取失败", true);
  }
}

function clearGarment() {
  state.garmentDataUri = "";
  els.garmentPreview.hidden = true;
  els.garmentPreview.src = "";
  els.dropHint.hidden = false;
  els.btnClearGarment.hidden = true;
  els.fileInput.value = "";
  refreshConnectState();
}

/* ------------------------------ connect ------------------------------ */

async function getCamera() {
  const md = state.modelDef;
  const w = (md && md.width) || 1280;
  const h = (md && md.height) || 720;
  return navigator.mediaDevices.getUserMedia({
    audio: true,
    video: { width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 30 } },
  });
}

async function start() {
  if (state.connecting || state.connected) return;
  if (!state.garmentDataUri) { setHint("先上传一件衣服", true); return; }

  state.connecting = true;
  refreshConnectState();
  setStatus("busy", "连接中…");
  setHint("正在请求摄像头…");

  try {
    state.modelDef = models.realtime(state.modelName);
    state.localStream = await getCamera();
    els.cam.srcObject = state.localStream;

    // client auth: prefer a directly-pasted key (static-deploy friendly),
    // otherwise mint a short-lived client token via our backend.
    const localKey = getKey();
    state.client = localKey
      ? createDecartClient({ apiKey: localKey })
      : createDecartClient({ apiKeyProvider: () => mintToken() });

    setHint("正在建立实时通道…");
    const promptText = els.prompt.value.trim();

    state.rt = await state.client.realtime.connect(state.localStream, {
      model: state.modelDef,
      mirror: els.mirror.checked ? "auto" : false,
      resolution: "720p",
      speed: els.fast.checked ? "fast" : undefined,
      initialState: {
        image: state.garmentDataUri,
        ...(promptText ? { prompt: { text: promptText, enhance: true } } : {}),
      },
      onRemoteStream: (stream) => {
        els.out.srcObject = stream;
        els.out.play().catch(() => {});
        els.placeholder.classList.add("hide");
        els.pip.hidden = false;
        els.viewerBadge.hidden = false;
      },
      onConnectionChange: (s) => {
        const live = String(s).toLowerCase();
        if (live.includes("connect") && !live.includes("dis")) {
          markConnected();
        } else if (live.includes("dis") || live.includes("clos")) {
          markDisconnected();
        }
      },
    });

    state.rt.on("error", (e) => {
      setStatus("err", "出错");
      setHint(e?.message || "实时通道错误", true);
    });
    state.rt.on("sessionEnded", () => {
      markDisconnected();
      setHint("会话已结束（可能额度用尽或超时）", true);
    });

    markConnected();
  } catch (e) {
    console.error(e);
    state.connecting = false;
    await cleanup(false);
    const msg = e?.message || String(e);
    if (e?.code === "NO_API_KEY" || e?.code === "NO_BACKEND" || /NO_API_KEY|key|后端/i.test(msg)) {
      setStatus("err", "缺少 Key");
      setHint("请先点右上角「设置」粘贴 Decart API Key", true);
      els.notice.hidden = false;
      openSettings();
    } else {
      setStatus("err", "连接失败");
      setHint("连接失败：" + msg, true);
    }
    refreshConnectState();
  }
}

function markConnected() {
  state.connecting = false;
  state.connected = true;
  state.startedAt = Date.now();
  setStatus("live", "实时中");
  setHint("");
  els.placeholder.classList.add("hide");
  els.viewerBadge.hidden = false;
  refreshConnectState();
  startTimer();
}

function markDisconnected() {
  state.connected = false;
  state.connecting = false;
  setStatus("idle", "未连接");
  stopTimer();
  els.viewerBadge.hidden = true;
  els.pip.hidden = true;
  els.placeholder.classList.remove("hide");
  refreshConnectState();
}

function startTimer() {
  stopTimer();
  const tick = () => {
    const s = Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));
    const rate = els.fast.checked ? 4 : 2;
    els.metric.textContent = `LIVE ${s}s · ≈${s * rate} credits`;
  };
  tick();
  state.timer = setInterval(tick, 1000);
}
function stopTimer() {
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
  els.metric.textContent = "--";
}

async function cleanup(showPlaceholder = true) {
  try { state.rt?.disconnect(); } catch {}
  state.rt = null;
  if (state.localStream) {
    state.localStream.getTracks().forEach((t) => t.stop());
    state.localStream = null;
  }
  els.cam.srcObject = null;
  els.out.srcObject = null;
  els.pip.hidden = true;
  if (showPlaceholder) {
    els.placeholder.classList.remove("hide");
    els.viewerBadge.hidden = true;
  }
}

async function stop() {
  setStatus("busy", "断开中…");
  await cleanup(true);
  state.connected = false;
  state.connecting = false;
  setStatus("idle", "未连接");
  stopTimer();
  refreshConnectState();
}

/* ------------------------------ settings ------------------------------ */

function openSettings() {
  els.keyInput.value = getKey();
  els.settingsModal.hidden = false;
  setTimeout(() => els.keyInput.focus(), 30);
}
function closeSettings() {
  els.settingsModal.hidden = true;
}
function saveKey() {
  setKey(els.keyInput.value.trim());
  closeSettings();
  els.notice.hidden = Boolean(getKey());
  setHint(getKey() ? "Key 已保存" : "Key 已清除");
}

/* ------------------------------ events ------------------------------ */

els.btnConnect.addEventListener("click", () => {
  if (state.connected) stop();
  else start();
});

els.dropZone.addEventListener("click", () => els.fileInput.click());
els.dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); els.fileInput.click(); }
});
els.fileInput.addEventListener("change", (e) => handleFile(e.target.files?.[0]));
els.btnClearGarment.addEventListener("click", clearGarment);

["dragenter", "dragover"].forEach((ev) =>
  els.dropZone.addEventListener(ev, (e) => { e.preventDefault(); els.dropZone.classList.add("drag"); })
);
["dragleave", "drop"].forEach((ev) =>
  els.dropZone.addEventListener(ev, (e) => { e.preventDefault(); els.dropZone.classList.remove("drag"); })
);
els.dropZone.addEventListener("drop", (e) => handleFile(e.dataTransfer?.files?.[0]));

els.btnSettings.addEventListener("click", openSettings);
els.btnCloseSettings.addEventListener("click", closeSettings);
els.btnSaveKey.addEventListener("click", saveKey);
els.settingsModal.addEventListener("click", (e) => { if (e.target === els.settingsModal) closeSettings(); });

els.fast.addEventListener("change", () => {
  els.creditNote.textContent = els.fast.checked ? "4 信用/秒 · Fast" : "2 信用/秒";
  if (state.connected) startTimer();
});

// live prompt update
let promptTimer = null;
els.prompt.addEventListener("input", () => {
  clearTimeout(promptTimer);
  promptTimer = setTimeout(() => {
    const text = els.prompt.value.trim();
    if (state.connected && state.rt && text) {
      state.rt.setPrompt(text, { enhance: true }).catch(() => {});
    }
  }, 500);
});

/* ------------------------------ boot ------------------------------ */

(async function boot() {
  await readHealth();
  refreshConnectState();
  if (!getKey()) els.notice.hidden = false;
  // surface setup need early, but don't block
  setStatus("idle", "未连接");
})();
