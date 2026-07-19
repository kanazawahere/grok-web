const $ = (id) => document.getElementById(id);
const output = $("output");
const activity = $("activity");
const input = $("input");
const conn = $("conn");
const meta = $("meta");
const listEl = $("session-list");

let sessionId = localStorage.getItem("grokWebSession") || "";
let ws = null;
let streaming = false;

function logActivity(text, cls = "") {
  const d = document.createElement("div");
  d.className = `ev ${cls}`;
  d.textContent = text;
  activity.appendChild(d);
  activity.scrollTop = activity.scrollHeight;
}

function appendUser(text) {
  const wrap = document.createElement("div");
  wrap.className = "msg-user";
  wrap.innerHTML = `<div class="msg-label">You</div>`;
  const body = document.createElement("div");
  body.textContent = text;
  wrap.appendChild(body);
  output.appendChild(wrap);
  output.scrollTop = output.scrollHeight;
}

function ensureAssistantBubble() {
  let el = output.querySelector(".msg-assistant.live");
  if (!el) {
    el = document.createElement("div");
    el.className = "msg-assistant live";
    el.innerHTML = `<div class="msg-label">Grok</div>`;
    const body = document.createElement("div");
    body.className = "body";
    el.appendChild(body);
    output.appendChild(el);
  }
  return el.querySelector(".body");
}

async function refreshSessions() {
  const res = await fetch("/api/sessions");
  const data = await res.json();
  listEl.innerHTML = "";
  for (const s of data.sessions || []) {
    const li = document.createElement("li");
    li.textContent = s.title || s.id;
    li.dataset.id = s.id;
    if (s.id === sessionId) li.classList.add("active");
    li.onclick = () => {
      sessionId = s.id;
      localStorage.setItem("grokWebSession", sessionId);
      connect();
      refreshSessions();
    };
    listEl.appendChild(li);
  }
}

async function refreshMeta() {
  try {
    const h = await (await fetch("/api/health")).json();
    meta.textContent = [
      `model ${h.model}`,
      h.hasApiKey ? "key ok" : "NO API KEY",
      `OC ${h.fleet?.opencodeWeb} · Pi ${h.fleet?.piWeb} · Grok ${h.fleet?.grokWeb}`,
    ].join("\n");
  } catch {
    meta.textContent = "health failed";
  }
}

function connect() {
  if (ws) {
    try { ws.close(); } catch { /* */ }
  }
  output.innerHTML = "";
  activity.innerHTML = "";
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const q = sessionId ? `?session=${encodeURIComponent(sessionId)}` : "";
  ws = new WebSocket(`${proto}://${location.host}/ws${q}`);
  conn.textContent = "connecting…";
  conn.classList.remove("live");

  ws.onopen = () => {
    conn.textContent = "live";
    conn.classList.add("live");
  };
  ws.onclose = () => {
    conn.textContent = "disconnected";
    conn.classList.remove("live");
  };
  ws.onerror = () => logActivity("ws error", "err");

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    switch (msg.type) {
      case "session":
        sessionId = msg.session.id;
        localStorage.setItem("grokWebSession", sessionId);
        logActivity(`session ${sessionId} · ${msg.session.projectPath}`);
        refreshSessions();
        break;
      case "history":
        for (const m of msg.messages || []) {
          if (m.role === "user") appendUser(m.content);
          else if (m.role === "assistant" && m.content) {
            const body = ensureAssistantBubble();
            body.textContent += m.content;
            body.parentElement.classList.remove("live");
          } else if (m.role === "tool") {
            logActivity(`tool ${m.name}: ${String(m.content).slice(0, 200)}`, "tool");
          }
        }
        break;
      case "text_delta":
        streaming = true;
        ensureAssistantBubble().textContent += msg.content;
        output.scrollTop = output.scrollHeight;
        break;
      case "tool_call":
        logActivity(`→ ${msg.name}(${msg.arguments.slice(0, 180)})`, "tool");
        break;
      case "tool_result":
        logActivity(
          `← ${msg.name}: ${String(msg.content).slice(0, 400)}`,
          msg.isError ? "err" : "ok",
        );
        break;
      case "status":
        logActivity(msg.message);
        break;
      case "done":
        streaming = false;
        document.querySelector(".msg-assistant.live")?.classList.remove("live");
        logActivity("done", "ok");
        break;
      case "cancelled":
        streaming = false;
        logActivity("cancelled", "err");
        break;
      case "error":
        streaming = false;
        logActivity(msg.message, "err");
        break;
    }
  };
}

function send() {
  const text = input.value.trim();
  if (!text || !ws || ws.readyState !== 1) return;
  appendUser(text);
  document.querySelector(".msg-assistant.live")?.classList.remove("live");
  ws.send(JSON.stringify({ type: "user_message", content: text }));
  input.value = "";
}

$("btn-send").onclick = send;
$("btn-stop").onclick = () => {
  if (ws?.readyState === 1) ws.send(JSON.stringify({ type: "interrupt" }));
};
$("btn-new").onclick = async () => {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const data = await res.json();
  sessionId = data.session.id;
  localStorage.setItem("grokWebSession", sessionId);
  connect();
  refreshSessions();
};
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    send();
  }
});

refreshMeta();
refreshSessions().then(connect);
