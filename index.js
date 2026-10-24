// Tavern Token Lens v1.0.0
// Standalone SillyTavern/TauriTavern frontend extension.
// API-reported usage is preferred when available; otherwise text-based estimates are explicitly labelled.
import { eventSource, event_types, getContext } from "../../../script.js";

const EXT = "TavernTokenLens";
const STORE_KEY = "TavernTokenLens.stats.v1";
let startedAt = null;
let lastPromptText = "";
let lastOutputText = "";
let currentStatus = "等待生成";
let latest = null;
let stats = loadStats();

function loadStats() {
    try {
        return JSON.parse(localStorage.getItem(STORE_KEY)) || {
            calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0,
            estimatedCalls: 0, totalMs: 0, errors: 0, history: []
        };
    } catch {
        return { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCalls: 0, totalMs: 0, errors: 0, history: [] };
    }
}
function saveStats() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(stats)); } catch {}
}
function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
function fmt(n) {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
    return Math.round(Number(n)).toLocaleString();
}
function duration(ms) {
    if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
    return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}
function estimateTokens(text) {
    // Deliberately rough multilingual estimate, not a model tokenizer.
    // Chinese text often tokenizes closer to character-level; English differs by tokenizer.
    const s = String(text ?? "");
    if (!s) return 0;
    const cjk = (s.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g) || []).length;
    const other = s.length - cjk;
    return Math.max(1, Math.ceil(cjk * 1.15 + other / 4));
}
function pick(obj, paths) {
    for (const path of paths) {
        let v = obj;
        for (const k of path.split(".")) v = v?.[k];
        if (v !== undefined && v !== null && Number.isFinite(Number(v))) return Number(v);
    }
    return null;
}
function findUsage(obj) {
    if (!obj || typeof obj !== "object") return null;
    const input = pick(obj, [
        "usage.prompt_tokens", "usage.input_tokens", "usage.promptTokenCount",
        "usage.inputTokenCount", "data.usage.prompt_tokens", "data.usage.input_tokens",
        "response.usage.prompt_tokens", "response.usage.input_tokens",
        "usageMetadata.promptTokenCount", "response.usageMetadata.promptTokenCount"
    ]);
    const output = pick(obj, [
        "usage.completion_tokens", "usage.output_tokens", "usage.candidatesTokenCount",
        "usage.completionTokenCount", "usage.outputTokenCount", "data.usage.completion_tokens",
        "data.usage.output_tokens", "response.usage.completion_tokens", "response.usage.output_tokens",
        "usageMetadata.candidatesTokenCount", "response.usageMetadata.candidatesTokenCount"
    ]);
    const total = pick(obj, ["usage.total_tokens", "usage.totalTokenCount", "data.usage.total_tokens", "usageMetadata.totalTokenCount"]);
    if (input !== null || output !== null || total !== null) {
        return { input: input ?? (total !== null && output !== null ? Math.max(0, total - output) : null),
                 output: output ?? (total !== null && input !== null ? Math.max(0, total - input) : null),
                 total, source: "接口返回" };
    }
    return null;
}
function getModel() {
    try {
        const c = getContext();
        const candidates = [
            c?.main_api, c?.api,
            c?.oai_settings?.model, c?.openai_settings?.model,
            c?.nai_settings?.model, c?.textgenerationwebui_settings?.model
        ];
        for (const v of candidates) if (typeof v === "string" && v.trim()) return v;
        const el = document.querySelector('#model_list, #model, [name="model"]');
        if (el?.value) return el.value;
    } catch {}
    return "无法从前端上下文读取";
}
function getMode() {
    try {
        const c = getContext();
        const api = c?.main_api || c?.api || "";
        const source = c?.chat_completion_source || c?.oai_settings?.chat_completion_source || "";
        return [api, source].filter(Boolean).join(" / ") || "酒馆当前连接方式（未识别）";
    } catch { return "未识别"; }
}
function getChatText() {
    try {
        const c = getContext();
        const chat = c?.chat || [];
        return chat.map(m => `${m?.name || m?.role || ""}: ${m?.mes || m?.content || ""}`).join("\n");
    } catch { return ""; }
}
function getLastAssistantText() {
    try {
        const c = getContext();
        const chat = c?.chat || [];
        for (let i = chat.length - 1; i >= 0; i--) {
            const m = chat[i];
            if (m && !m.is_user && !m.is_system && (m.mes || m.content)) return String(m.mes || m.content);
        }
    } catch {}
    return "";
}
function render() {
    const root = document.getElementById("ttl-root");
    if (!root) return;
    const a = latest || {};
    root.innerHTML = `
      <div class="ttl-head">
        <div><strong>Token Lens</strong><small>酒馆用量监测</small></div>
        <div class="ttl-head-actions">
          <button id="ttl-min" title="折叠/展开">${root.classList.contains("ttl-mini") ? "展开" : "折叠"}</button>
          <button id="ttl-close" title="隐藏面板">×</button>
        </div>
      </div>
      <div class="ttl-body">
        <div class="ttl-status"><span class="ttl-dot ${startedAt ? "busy" : ""}"></span>${esc(currentStatus)}</div>
        <div class="ttl-grid">
          <div class="ttl-metric"><span>输入 Token</span><b>${fmt(a.input)}</b></div>
          <div class="ttl-metric"><span>输出 Token</span><b>${fmt(a.output)}</b></div>
          <div class="ttl-metric"><span>合计 Token</span><b>${fmt(a.total)}</b></div>
          <div class="ttl-metric"><span>生成耗时</span><b>${duration(a.ms)}</b></div>
          <div class="ttl-metric"><span>首 Token 延迟</span><b>${duration(a.ttft)}</b></div>
          <div class="ttl-metric"><span>输出速度</span><b>${a.output && a.ms > 0 ? (a.output / (a.ms / 1000)).toFixed(2) + " tok/s" : "—"}</b></div>
        </div>
        <div class="ttl-detail"><span>模型</span><b title="${esc(a.model || getModel())}">${esc(a.model || getModel())}</b></div>
        <div class="ttl-detail"><span>请求方式</span><b title="${esc(a.mode || getMode())}">${esc(a.mode || getMode())}</b></div>
        <div class="ttl-detail"><span>用量来源</span><b>${esc(a.source || "尚无生成记录")}</b></div>
        <div class="ttl-note">估算值不是账单数据；接口未返回 usage 时仅按文本粗估。</div>
        <hr>
        <div class="ttl-section">本次会话累计</div>
        <div class="ttl-summary">
          <span>请求 <b>${fmt(stats.calls)}</b></span>
          <span>输入 <b>${fmt(stats.inputTokens)}</b></span>
          <span>输出 <b>${fmt(stats.outputTokens)}</b></span>
          <span>合计 <b>${fmt(stats.totalTokens)}</b></span>
          <span>耗时 <b>${duration(stats.totalMs)}</b></span>
          <span>估算请求 <b>${fmt(stats.estimatedCalls)}</b></span>
        </div>
        <div class="ttl-actions">
          <button id="ttl-copy">复制统计</button>
          <button id="ttl-export">导出 CSV</button>
          <button id="ttl-reset">清空累计</button>
        </div>
        <div class="ttl-section">最近请求</div>
        <div class="ttl-history">${(stats.history || []).slice(0, 8).map(h => `<div class="ttl-history-row"><span>${esc(h.time)} · ${esc(h.model)}</span><span>↑${fmt(h.input)} ↓${fmt(h.output)} · ${duration(h.ms)}</span></div>`).join("") || '<div class="ttl-empty">暂无记录</div>'}</div>
      </div>`;
    root.querySelector("#ttl-min")?.addEventListener("click", () => {
        root.classList.toggle("ttl-mini"); render();
    });
    root.querySelector("#ttl-close")?.addEventListener("click", () => {
        root.classList.add("ttl-hidden");
        const toggle = document.getElementById("ttl-toggle");
        if (toggle) toggle.style.display = "block";
    });
    root.querySelector("#ttl-copy")?.addEventListener("click", async () => {
        const text = [
            "Tavern Token Lens",
            `模型: ${a.model || getModel()}`, `方式: ${a.mode || getMode()}`,
            `输入Token: ${a.input ?? "—"}`, `输出Token: ${a.output ?? "—"}`, `总Token: ${a.total ?? "—"}`,
            `耗时: ${duration(a.ms)}`, `首Token延迟: ${duration(a.ttft)}`, `来源: ${a.source || "—"}`,
            `累计请求: ${stats.calls}`, `累计输入: ${stats.inputTokens}`, `累计输出: ${stats.outputTokens}`, `累计总量: ${stats.totalTokens}`
        ].join("\n");
        try { await navigator.clipboard.writeText(text); currentStatus = "统计已复制"; render(); } catch { currentStatus = "复制失败：请检查剪贴板权限"; render(); }
    });
    root.querySelector("#ttl-export")?.addEventListener("click", () => {
        const rows = [["time","model","mode","input_tokens","output_tokens","total_tokens","duration_ms","ttft_ms","source"]];
        for (const h of stats.history || []) rows.push([h.time,h.model,h.mode,h.input,h.output,h.total,h.ms,h.ttft,h.source]);
        const csv = rows.map(row => row.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
        const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a"); link.href = url; link.download = "tavern-token-stats.csv"; link.click();
        URL.revokeObjectURL(url);
    });
    root.querySelector("#ttl-reset")?.addEventListener("click", () => {
        if (!confirm("清空 Token Lens 的累计统计与最近请求记录？不会删除酒馆聊天记录。")) return;
        stats = { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCalls: 0, totalMs: 0, errors: 0, history: [] };
        saveStats(); latest = null; currentStatus = "累计统计已清空"; render();
    });
}
function mount() {
    if (document.getElementById("ttl-root")) return;
    const root = document.createElement("section");
    root.id = "ttl-root";
    root.innerHTML = "";
    document.body.appendChild(root);
    const toggle = document.createElement("button");
    toggle.id = "ttl-toggle"; toggle.textContent = "Token";
    toggle.title = "显示 Token Lens"; toggle.style.display = "none";
    toggle.addEventListener("click", () => { root.classList.remove("ttl-hidden"); toggle.style.display = "none"; render(); });
    document.body.appendChild(toggle);
    render();
}
function finishGeneration() {
    if (!startedAt) return;
    const ms = Math.max(0, performance.now() - startedAt);
    startedAt = null;
    const text = getLastAssistantText();
    const outEstimate = estimateTokens(text);
    const inEstimate = estimateTokens(getChatText());
    const usage = latest?.pendingUsage || null;
    const input = usage?.input ?? inEstimate;
    const output = usage?.output ?? outEstimate;
    const total = usage?.total ?? (input + output);
    const source = usage ? usage.source : "本地估算";
    const record = {
        time: new Date().toLocaleString(),
        model: getModel(),
        mode: getMode(),
        input, output, total, ms, ttft: latest?.ttft ?? null, source
    };
    latest = { ...record };
    stats.calls += 1;
    stats.inputTokens += input || 0;
    stats.outputTokens += output || 0;
    stats.totalTokens += total || 0;
    stats.totalMs += ms;
    if (!usage) stats.estimatedCalls += 1;
    stats.history.unshift(record);
    stats.history = stats.history.slice(0, 500);
    saveStats();
    currentStatus = "生成完成";
    render();
}
function onStart() {
    startedAt = performance.now();
    latest = { model: getModel(), mode: getMode(), input: null, output: null, total: null, ms: null, ttft: null, source: "等待接口数据" };
    currentStatus = "正在生成";
    render();
}
function onEnd() { finishGeneration(); }
function safeListen(name, fn) {
    try {
        const type = event_types?.[name] || name;
        eventSource.on(type, fn);
    } catch (e) { console.warn(`[${EXT}] event listener failed:`, name, e); }
}
function installUsageProbe() {
    // Best-effort observation of same-window fetch responses. It never changes request/response data.
    // Many Tavern providers proxy usage through the backend, so this may not see provider usage.
    if (window.__ttlFetchProbeInstalled) return;
    window.__ttlFetchProbeInstalled = true;
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
        const response = await original(...args);
        try {
            const clone = response.clone();
            const ct = clone.headers.get("content-type") || "";
            if (ct.includes("json")) {
                clone.json().then(data => {
                    const usage = findUsage(data);
                    if (usage && latest) latest.pendingUsage = usage;
                }).catch(() => {});
            } else if (ct.includes("event-stream")) {
                clone.text().then(text => {
                    const lines = text.split(/\r?\n/).filter(x => x.startsWith("data:"));
                    for (const line of lines) {
                        try {
                            const data = JSON.parse(line.slice(5).trim());
                            const usage = findUsage(data);
                            if (usage && latest) latest.pendingUsage = usage;
                            if (latest && !latest.ttft && data?.choices?.[0]?.delta?.content) latest.ttft = performance.now() - (startedAt || performance.now());
                        } catch {}
                    }
                }).catch(() => {});
            }
        } catch {}
        return response;
    };
}
function init() {
    mount();
    installUsageProbe();
    safeListen("GENERATION_STARTED", onStart);
    safeListen("GENERATION_ENDED", onEnd);
    safeListen("GENERATION_STOPPED", onEnd);
    safeListen("MESSAGE_RECEIVED", () => { if (startedAt) finishGeneration(); });
    safeListen("CHAT_CHANGED", () => { currentStatus = "已切换聊天；累计统计保留"; render(); });
    console.info(`[${EXT}] loaded`);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
