const LOCAL_API_BASE_URL = "http://127.0.0.1:8010";
const API_BASE_URL = window.VIDEONOTE_API_BASE_URL || LOCAL_API_BASE_URL;

const form = document.getElementById("video-note-form");
const apiStatus = document.getElementById("api-status");
const generateButton = document.querySelector(".generate-button");
const progressCard = document.getElementById("progress-card");
const progressBar = document.getElementById("progress-bar");
const progressPercent = document.getElementById("progress-percent");
const progressDetail = document.getElementById("progress-detail");
const progressSteps = [...document.querySelectorAll("#progress-steps li")];
const workspaceCard = document.getElementById("workspace-card");
const workspaceGrid = document.getElementById("workspace-grid");
const viewButtons = [...document.querySelectorAll(".workspace-view-toggle [data-view]")];
const editor = document.getElementById("markdown-editor");
const preview = document.getElementById("markdown-preview");
const editorStatus = document.getElementById("editor-status");
const wordCount = document.getElementById("word-count");
const validationMessage = document.getElementById("validation-message");
let currentJobId = null;

const STAGE_ORDER = ["video_info", "subtitles", "transcription", "planning", "generation"];
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const escapeHTML = value => value.replace(/[&<>"]/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"})[character]);

function splitFrontmatter(markdown) {
    const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    return match ? { frontmatter:match[1].trim(), body:markdown.slice(match[0].length) } : { frontmatter:"", body:markdown };
}

function normalizeVideoUrl(value) {
    try {
        const url = new URL(value.trim());
        if (["bilibili.com", "www.bilibili.com", "m.bilibili.com"].includes(url.hostname)) {
            const match = url.pathname.match(/\/video\/(BV[0-9A-Za-z]+|av\d+)/i);
            if (match) return `https://www.bilibili.com/video/${match[1]}/`;
        }
    } catch { /* The backend will provide the URL validation message. */ }
    return value.trim();
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
    const plainText = editor.value.replace(/^---[\s\S]*?---/m, "").replace(/[#>*_`|\[\]()-]/g," ").trim();
    wordCount.textContent = `${plainText ? plainText.split(/\s+/).length : 0} words`;
}

let renderTimer;
editor.addEventListener("input", () => {
    editorStatus.textContent = "Updating…";
    validationMessage.classList.add("is-hidden");
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => { renderMarkdown(); editorStatus.textContent = "Preview updated"; }, 220);
});

function showMessage(message, type = "warning") {
    validationMessage.className = `validation-message is-${type}`;
    validationMessage.textContent = message;
}

async function apiRequest(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: { "Content-Type":"application/json", ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail || body);
        throw new Error(detail || `Request failed (${response.status})`);
    }
    return body;
}

async function checkApi() {
    try {
        const health = await apiRequest("/api/health");
        apiStatus.textContent = health.llm_configured ? `API ready · ${health.model}` : "API ready · Add OPENROUTER_API_KEY";
        apiStatus.className = `connection-pill ${health.llm_configured ? "is-online" : "is-offline"}`;
    } catch {
        apiStatus.textContent = "API offline";
        apiStatus.className = "connection-pill is-offline";
    }
}

function updateProgress(job) {
    progressBar.style.width = `${job.progress}%`;
    progressPercent.textContent = `${job.progress}%`;
    progressDetail.textContent = job.error || job.message;
    const normalizedStage = job.stage === "audio_download" ? "transcription" :
        ["processing","context"].includes(job.stage) ? "transcription" :
        job.stage === "validation" || job.stage === "complete" ? "generation" : job.stage;
    const currentIndex = STAGE_ORDER.indexOf(normalizedStage);
    progressSteps.forEach((step, index) => {
        step.classList.toggle("is-complete", job.status === "complete" || index < currentIndex);
        step.classList.toggle("is-active", job.status === "running" && index === currentIndex);
    });
}

async function pollJob(jobId) {
    while (true) {
        const job = await apiRequest(`/api/jobs/${jobId}`);
        updateProgress(job);
        if (job.status === "complete") return apiRequest(`/api/jobs/${jobId}/result`);
        if (job.status === "failed") throw new Error(job.error || "VideoNote generation failed");
        await wait(1000);
    }
}

async function generateNote() {
    progressCard.classList.remove("is-hidden");
    workspaceCard.classList.add("is-hidden");
    validationMessage.classList.add("is-hidden");
    generateButton.disabled = true;
    generateButton.firstElementChild.textContent = "Building…";
    progressSteps.forEach(step => step.className = "");
    progressBar.style.width = "0%";
    progressPercent.textContent = "0%";
    try {
        const job = await apiRequest("/api/jobs", {
            method:"POST",
            body:JSON.stringify({
                url:normalizeVideoUrl(document.getElementById("video-url").value),
                output_language:document.getElementById("output-language").value,
                whisper_model:document.getElementById("whisper-model").value,
                note_style:"standard",
                grounding_mode:"assisted",
                force_cpu:document.getElementById("force-cpu").checked,
                cookies_from_browser:document.getElementById("cookies-browser").value || null,
            }),
        });
        currentJobId = job.job_id;
        const result = await pollJob(currentJobId);
        editor.value = result.markdown;
        renderMarkdown();
        document.querySelector(".workspace-heading p").textContent = `${result.video.title} · ${result.video.platform} · ${result.transcript.source}`;
        workspaceCard.classList.remove("is-hidden");
        generateButton.firstElementChild.textContent = "Generate again";
        workspaceCard.scrollIntoView({ behavior:"smooth", block:"start" });
        const unsupported = result.validation.grounding?.unsupported_claims?.length || 0;
        if (unsupported) showMessage(`筆記已完成，但有 ${unsupported} 個說法需要人工確認。`, "warning");
    } catch (error) {
        progressDetail.textContent = `Failed: ${error.message}`;
        progressPercent.textContent = "Error";
        showMessage(`生成失敗：${error.message}`, "warning");
        workspaceCard.classList.remove("is-hidden");
    } finally {
        generateButton.disabled = false;
        if (generateButton.firstElementChild.textContent === "Building…") generateButton.firstElementChild.textContent = "Generate note";
    }
}

form.addEventListener("submit", event => { event.preventDefault(); generateNote(); });
viewButtons.forEach(button => button.addEventListener("click", () => {
    workspaceGrid.dataset.view = button.dataset.view;
    viewButtons.forEach(item => item.classList.toggle("is-active", item === button));
}));

document.getElementById("validate-note").addEventListener("click", async () => {
    try {
        showMessage("正在檢查 Markdown 與逐字稿忠實度…", "success");
        const result = await apiRequest("/api/validate", {
            method:"POST",
            body:JSON.stringify({ markdown:editor.value, job_id:currentJobId, include_grounding:Boolean(currentJobId) }),
        });
        const issues = [...result.errors, ...result.warnings];
        const unsupported = result.grounding?.unsupported_claims?.length || 0;
        const message = issues.length || unsupported
            ? `需要確認：${[...issues, unsupported ? `${unsupported} 個說法缺少逐字稿支持` : ""].filter(Boolean).join("；")}`
            : "檢查通過：Markdown 格式正常，沒有發現缺乏逐字稿支持的說法。";
        showMessage(message, issues.length || unsupported ? "warning" : "success");
    } catch (error) { showMessage(`檢查失敗：${error.message}`, "warning"); }
});

function currentSection() {
    const beforeCursor = editor.value.slice(0, editor.selectionStart);
    const matches = [...beforeCursor.matchAll(/^##\s+(.+)$/gm)];
    if (!matches.length) return null;
    const match = matches[matches.length - 1];
    const start = match.index;
    const after = editor.value.slice(start + match[0].length);
    const next = after.search(/^##\s+/m);
    return { heading:match[1].trim(), start, end:next === -1 ? editor.value.length : start + match[0].length + next };
}

document.getElementById("regenerate-section").addEventListener("click", async () => {
    if (!currentJobId) return showMessage("請先完成一個 VideoNote 任務。", "warning");
    const section = currentSection();
    if (!section) return showMessage("請先把游標放在要重新生成的二級章節內。", "warning");
    const instruction = window.prompt(`如何修改「${section.heading}」？`, "改善清晰度並維持逐字稿忠實度。") || "";
    if (!instruction.trim()) return;
    try {
        showMessage(`正在重新生成「${section.heading}」…`, "success");
        const result = await apiRequest("/api/regenerate-section", {
            method:"POST",
            body:JSON.stringify({ job_id:currentJobId, markdown:editor.value, section_heading:section.heading, instruction }),
        });
        editor.value = editor.value.slice(0,section.start) + result.section_markdown + "\n\n" + editor.value.slice(section.end).replace(/^\s+/,"");
        renderMarkdown();
        showMessage(`「${section.heading}」已重新生成，請檢查內容後再下載。`, "success");
    } catch (error) { showMessage(`重新生成失敗：${error.message}`, "warning"); }
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

renderMarkdown();
checkApi();
