const form = document.getElementById("video-note-form");
const generateButton = document.querySelector(".generate-button");
const progressCard = document.getElementById("progress-card");
const progressBar = document.getElementById("progress-bar");
const progressPercent = document.getElementById("progress-percent");
const progressSteps = [...document.querySelectorAll("#progress-steps li")];
const workspaceCard = document.getElementById("workspace-card");
const workspaceGrid = document.getElementById("workspace-grid");
const viewButtons = [...document.querySelectorAll(".workspace-view-toggle [data-view]")];
const editor = document.getElementById("markdown-editor");
const preview = document.getElementById("markdown-preview");
const editorStatus = document.getElementById("editor-status");
const wordCount = document.getElementById("word-count");
const validationMessage = document.getElementById("validation-message");

const sampleMarkdown = `---
title: Plan-and-Execute Agent
source: https://www.bilibili.com/video/BV1X6Vo6EEMs/
platform: bilibili
source_language: zh
note_language: zh-TW
tags:
  - ai-agent
  - planning
  - agent-architecture
---

# Plan-and-Execute Agent

## 一句話介紹

Plan-and-Execute 是一種先建立完整計畫，再逐步執行任務的 [[AI Agent]] 架構。

> [!note] 影片內容
> 這份示範筆記用來呈現 VideoNote 的 Markdown 編輯與預覽介面，尚未連接實際轉錄後端。

## 為什麼需要

單純依靠模型即時決定下一步，容易在複雜任務中遺漏目標。Plan-and-Execute 將「規劃」與「執行」拆開，讓任務狀態更容易追蹤。

**來源時間：** 03:20–05:45

## 核心概念

- **Planner**：理解目標並產生任務清單。
- **Executor**：依照任務清單呼叫工具。
- **Re-planning**：根據執行結果更新剩餘計畫。

## 運作流程

1. 使用者提出目標。
2. Planner 將目標拆成數個步驟。
3. Executor 依序執行每個步驟。
4. 系統確認結果，必要時重新規劃。

\`\`\`text
User Goal
   ↓
Planner → Task Plan
   ↓
Executor → Tools → Result
\`\`\`

## 優缺點

| 優點 | 缺點 |
| --- | --- |
| 任務結構清楚 | 初始計畫可能不完整 |
| 容易追蹤執行狀態 | 多一次規劃成本 |
| 適合長流程任務 | 需要處理重新規劃 |

## 我的理解

- 我認為這個技術最核心的概念是：
- 我可以將它應用在哪個專案：
- 我仍然不理解的地方：
`;

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const escapeHTML = value => value.replace(/[&<>"]/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"})[character]);

function splitFrontmatter(markdown) {
    const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    return match ? { frontmatter: match[1].trim(), body: markdown.slice(match[0].length) } : { frontmatter: "", body: markdown };
}

function fallbackRender(markdown) {
    return `<p>${escapeHTML(markdown).replace(/^### (.*)$/gm,"<h3>$1</h3>").replace(/^## (.*)$/gm,"<h2>$1</h2>").replace(/^# (.*)$/gm,"<h1>$1</h1>").replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>").replace(/\n\n/g,"</p><p>")}</p>`;
}

function renderMarkdown() {
    const { frontmatter, body } = splitFrontmatter(editor.value);
    const normalized = body.replace(/\[\[([^\]]+)\]\]/g, "[$1](#wikilink-$1)");
    const renderer = window.markdownit ? window.markdownit({ html:false, linkify:true, typographer:true }) : null;
    const rendered = renderer ? renderer.render(normalized) : fallbackRender(normalized);
    const safe = window.DOMPurify ? window.DOMPurify.sanitize(rendered) : rendered;
    preview.innerHTML = (frontmatter ? `<div class="frontmatter-card">${escapeHTML(frontmatter)}</div>` : "") + safe;
    const plainText = editor.value.replace(/^---[\s\S]*?---/m, "").replace(/[#>*_`|\[\]()-]/g, " ").trim();
    wordCount.textContent = `${plainText ? plainText.split(/\s+/).length : 0} words`;
}

let renderTimer;
editor.addEventListener("input", () => {
    editorStatus.textContent = "Updating…";
    validationMessage.classList.add("is-hidden");
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => { renderMarkdown(); editorStatus.textContent = "Preview updated"; }, 220);
});

async function simulateGeneration() {
    progressCard.classList.remove("is-hidden");
    workspaceCard.classList.add("is-hidden");
    validationMessage.classList.add("is-hidden");
    generateButton.disabled = true;
    generateButton.firstElementChild.textContent = "Building…";
    progressSteps.forEach(step => step.className = "");

    for (let index = 0; index < progressSteps.length; index += 1) {
        progressSteps.forEach((step, stepIndex) => {
            step.classList.toggle("is-complete", stepIndex < index);
            step.classList.toggle("is-active", stepIndex === index);
        });
        const progress = Math.round(((index + 1) / progressSteps.length) * 100);
        progressBar.style.width = `${progress}%`;
        progressPercent.textContent = `${progress}%`;
        await wait(520);
    }
    progressSteps.forEach(step => { step.className = "is-complete"; });
    editor.value = sampleMarkdown;
    renderMarkdown();
    workspaceCard.classList.remove("is-hidden");
    generateButton.disabled = false;
    generateButton.firstElementChild.textContent = "Generate again";
    workspaceCard.scrollIntoView({ behavior:"smooth", block:"start" });
}

form.addEventListener("submit", event => { event.preventDefault(); simulateGeneration(); });
viewButtons.forEach(button => button.addEventListener("click", () => {
    workspaceGrid.dataset.view = button.dataset.view;
    viewButtons.forEach(item => item.classList.toggle("is-active", item === button));
}));

document.getElementById("validate-note").addEventListener("click", () => {
    const markdown = editor.value;
    const problems = [];
    const h1Count = (markdown.match(/^#\s+.+$/gm) || []).length;
    const fences = (markdown.match(/^```/gm) || []).length;
    const headings = (markdown.match(/^#{1,6}\s+(.+)$/gm) || []).map(item => item.replace(/^#{1,6}\s+/,""));
    const duplicates = headings.filter((item,index) => headings.indexOf(item) !== index);
    if (h1Count !== 1) problems.push(`需要恰好一個 H1，目前有 ${h1Count} 個`);
    if (fences % 2) problems.push("程式碼區塊沒有成對關閉");
    if (duplicates.length) problems.push(`發現重複標題：${[...new Set(duplicates)].join("、")}`);
    if (!/^---\s*\n[\s\S]*?\n---/m.test(markdown)) problems.push("缺少 YAML Frontmatter");
    validationMessage.className = `validation-message ${problems.length ? "is-warning" : "is-success"}`;
    validationMessage.textContent = problems.length ? `需要確認：${problems.join("；")}。` : "格式檢查通過。標題、Frontmatter 與程式碼區塊皆正常。";
});

function noteFilename() {
    const title = editor.value.match(/^#\s+(.+)$/m)?.[1] || "VideoNote";
    return `${title.replace(/[<>:"/\\|?*\x00-\x1f]/g,"-").trim()}.md`;
}

document.getElementById("download-note").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([editor.value], { type:"text/markdown;charset=utf-8" }));
    const link = Object.assign(document.createElement("a"), { href:url, download:noteFilename() });
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
});

document.getElementById("save-note").addEventListener("click", async () => {
    validationMessage.className = "validation-message";
    if (!("showDirectoryPicker" in window)) {
        validationMessage.classList.add("is-warning");
        validationMessage.textContent = "目前瀏覽器不支援資料夾寫入，請先使用「下載 Markdown」。Chrome 或 Edge 可支援此功能。";
        return;
    }
    try {
        const directory = await window.showDirectoryPicker({ mode:"readwrite" });
        const file = await directory.getFileHandle(noteFilename(), { create:true });
        const writable = await file.createWritable();
        await writable.write(editor.value); await writable.close();
        validationMessage.classList.add("is-success");
        validationMessage.textContent = `已儲存 ${noteFilename()} 至你選擇的資料夾。`;
    } catch (error) {
        if (error.name !== "AbortError") {
            validationMessage.classList.add("is-warning");
            validationMessage.textContent = `無法儲存：${error.message}`;
        }
    }
});

renderMarkdown();
