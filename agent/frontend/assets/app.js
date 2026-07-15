const messagesEl = document.getElementById("messages");
const form = document.getElementById("chat-form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send-btn");
const quickList = document.getElementById("quick-list");
const statusPill = document.getElementById("status-pill");

/** @type {{role: string, content: string}[]} */
let history = [];
let busy = false;
let clarificationState = null;

/** HTML 转义，防止 XSS */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 轻量 Markdown → HTML
 * 关键点：支持「有序列表项 + 其下的无序子列表」嵌套，
 * 避免模型写成多个「1.」时被拆成多个 <ol> 导致序号全是 1。
 */
function renderMarkdown(src) {
  if (!src) return "";
  let text = escapeHtml(src).replace(/\r\n/g, "\n");

  // 代码块 ```
  text = text.replace(/```([\s\S]*?)```/g, (_, code) => {
    return `<pre class="md-code"><code>${code.trim()}</code></pre>`;
  });

  const lines = text.split("\n");
  const out = [];

  // mode: null | 'ol' | 'ul'（顶层列表类型）
  let mode = null;
  let olLiOpen = false; // 当前有序 li 是否未闭合
  let nestedUl = false; // 是否在有序 li 内的子 ul 中

  const inlineFormat = (line) => {
    line = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    line = line.replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, "$1<em>$2</em>");
    line = line.replace(/`([^`]+)`/g, "<code>$1</code>");
    return line;
  };

  const closeNestedUl = () => {
    if (nestedUl) {
      out.push("</ul>");
      nestedUl = false;
    }
  };

  const closeOlLi = () => {
    closeNestedUl();
    if (olLiOpen) {
      out.push("</li>");
      olLiOpen = false;
    }
  };

  const closeAllLists = () => {
    closeOlLi();
    if (mode === "ol") {
      out.push("</ol>");
      mode = null;
    } else if (mode === "ul") {
      out.push("</ul>");
      mode = null;
    }
  };

  for (let raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    // 空行：结束子列表与当前 li，但尽量保持同一个 <ol>，这样下一项会变成 2、3…
    if (!trimmed) {
      if (mode === "ol") {
        closeOlLi();
      } else if (mode === "ul") {
        out.push("</ul>");
        mode = null;
      }
      continue;
    }

    // 标题
    const h = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      closeAllLists();
      const level = h[1].length;
      out.push(`<h${level} class="md-h">${inlineFormat(h[2])}</h${level}>`);
      continue;
    }

    // 有序列表 1. / 2. / 1. （数字仅作标记，显示序号由 <ol> 自动生成）
    const ol = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      closeNestedUl();
      if (mode === "ul") {
        out.push("</ul>");
        mode = null;
      }
      if (mode !== "ol") {
        out.push('<ol class="md-list md-ol">');
        mode = "ol";
      }
      if (olLiOpen) {
        out.push("</li>");
        olLiOpen = false;
      }
      out.push(`<li><div class="md-li-title">${inlineFormat(ol[1])}</div>`);
      olLiOpen = true;
      continue;
    }

    // 无序列表 - * •
    // 若当前在有序 li 内 → 作为嵌套子列表（解决「1. 标题 + 若干 - 要点」）
    const ul = trimmed.match(/^[-*•]\s+(.+)$/);
    if (ul) {
      if (mode === "ol" && olLiOpen) {
        if (!nestedUl) {
          out.push('<ul class="md-list md-sub">');
          nestedUl = true;
        }
        out.push(`<li>${inlineFormat(ul[1])}</li>`);
        continue;
      }
      // 顶层无序列表
      closeOlLi();
      if (mode === "ol") {
        out.push("</ol>");
        mode = null;
      }
      if (mode !== "ul") {
        out.push('<ul class="md-list">');
        mode = "ul";
      }
      out.push(`<li>${inlineFormat(ul[1])}</li>`);
      continue;
    }

    // 中文顿号序号：一、二、三、 或 1、2、
    const cn = trimmed.match(/^([一二三四五六七八九十]+、|\d+、)\s*(.+)$/);
    if (cn) {
      closeAllLists();
      out.push(
        `<p class="md-cn-item"><span class="md-cn-num">${cn[1]}</span>${inlineFormat(cn[2])}</p>`
      );
      continue;
    }

    // 普通段落
    closeAllLists();
    out.push(`<p>${inlineFormat(trimmed)}</p>`);
  }
  closeAllLists();
  return out.join("");
}

function setBodyContent(bodyEl, text, { markdown = false, typing = false } = {}) {
  if (typing) {
    bodyEl.classList.add("typing");
    bodyEl.textContent = text;
    return;
  }
  bodyEl.classList.remove("typing");
  if (markdown) {
    bodyEl.classList.add("md-body");
    bodyEl.innerHTML = renderMarkdown(text);
  } else {
    bodyEl.classList.remove("md-body");
    bodyEl.textContent = text;
  }
}

function addMessage(role, content, citations) {
  const div = document.createElement("div");
  div.className = `msg ${role === "user" ? "user" : role === "system" ? "system" : "bot"}`;
  if (role !== "system") {
    const r = document.createElement("div");
    r.className = "role";
    r.textContent = role === "user" ? "你" : "助手";
    div.appendChild(r);
  }
  const body = document.createElement("div");
  body.className = "body";
  // 助手消息渲染 Markdown；用户/系统用纯文本
  if (role === "assistant" || role === "bot") {
    setBodyContent(body, content, { markdown: true });
  } else {
    body.textContent = content;
  }
  div.appendChild(body);

  // 按产品要求：不在界面展示章节/页码类引用备注
  void citations;

  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return { div, body };
}

function appendCitations(parent, citations) {
  const box = document.createElement("div");
  box.className = "citations";
  citations.forEach((c) => {
    const chip = document.createElement("span");
    chip.className = "cite";
    const pages =
      c.page_start != null
        ? ` p.${c.page_start}${c.page_end && c.page_end !== c.page_start ? "-" + c.page_end : ""}`
        : "";
    chip.textContent = `${c.section || c.chapter || "参考"}${pages}`;
    box.appendChild(chip);
  });
  parent.appendChild(box);
}

function setBusy(v) {
  busy = v;
  sendBtn.disabled = v;
  input.disabled = v;
}

async function loadHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    if (data.ok && data.kb_ready && data.has_api_key) {
      statusPill.textContent = "服务正常";
      statusPill.className = "pill pill-ok";
    } else if (data.ok && data.kb_ready && !data.has_api_key) {
      statusPill.textContent = "缺 API Key";
      statusPill.className = "pill pill-bad";
    } else if (data.ok && !data.kb_ready) {
      statusPill.textContent = "知识库未构建";
      statusPill.className = "pill pill-bad";
    } else {
      statusPill.textContent = "异常";
      statusPill.className = "pill pill-bad";
    }
  } catch {
    statusPill.textContent = "无法连接";
    statusPill.className = "pill pill-bad";
  }
}

async function loadQuick() {
  try {
    const res = await fetch("/api/quick-questions");
    const data = await res.json();
    (data.questions || []).forEach((q) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quick-btn";
      btn.textContent = q;
      btn.addEventListener("click", () => {
        if (busy) return;
        clarificationState = null;
        input.value = q;
        form.requestSubmit();
      });
      quickList.appendChild(btn);
    });
  } catch {
    /* ignore */
  }
}

async function sendMessage(text) {
  const message = text.trim();
  if (!message || busy) return;

  addMessage("user", message);
  history.push({ role: "user", content: message });
  input.value = "";
  autoResize();

  setBusy(true);
  const { body } = addMessage("assistant", "");
  setBodyContent(body, "思考中…", { typing: true });

  let full = "";
  let citations = [];

  try {
    const res = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        history: history.slice(0, -1).slice(-6),
        clarification_state: clarificationState,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `请求失败 ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let gotToken = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        const lines = part.split("\n");
        let event = "message";
        let dataLine = "";
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) dataLine += line.slice(5).trim();
        }
        if (!dataLine) continue;
        let data;
        try {
          data = JSON.parse(dataLine);
        } catch {
          continue;
        }

        if (event === "meta" && data.citations) {
          citations = data.citations;
        }
        if (event === "token" && data.text != null) {
          if (!gotToken) {
            full = "";
            gotToken = true;
          }
          full += data.text;
          // 流式过程中实时渲染 Markdown
          setBodyContent(body, full, { markdown: true });
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
        if (event === "done") {
          full = data.answer || full;
          citations = data.citations || citations;
          clarificationState = data.clarification_state || null;
          setBodyContent(body, full, { markdown: true });
          // 不展示引用 chips（章节/页码备注）
          const old = body.parentElement.querySelector(".citations");
          if (old) old.remove();
        }
        if (event === "error") {
          throw new Error(data.message || "生成失败");
        }
      }
    }

    if (!full) {
      setBodyContent(body, "没有收到回复，请稍后重试。", { markdown: false });
    } else {
      history.push({ role: "assistant", content: full });
    }
  } catch (e) {
    setBodyContent(body, `出错了：${e.message || e}`, { markdown: false });
  } finally {
    setBusy(false);
    input.focus();
  }
}

function autoResize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 140) + "px";
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage(input.value);
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});
input.addEventListener("input", autoResize);

addMessage(
  "system",
  "你好！我是美股投资扫盲助手。如果你想了解怎么开户、怎么把钱转进去、券商怎么选、税务要注意什么，可以直接问我或点左侧常问。不会荐股，也不提供逃税建议。"
);
loadHealth();
loadQuick();
