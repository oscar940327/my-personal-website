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
const vaultDestination = document.getElementById("vault-destination");
const vaultFolderSelect = document.getElementById("vault-folder-select");
const newFolderField = document.getElementById("new-folder-field");
const vaultNewFolder = document.getElementById("vault-new-folder");
const vaultRecommendation = document.getElementById("vault-recommendation");
let currentJobId = null;
let currentVaultRelativePath = null;
let recommendedVaultFolder = null;

const STAGE_ORDER = ["video_info", "subtitles", "transcription", "planning", "generation"];
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const escapeHTML = value => value.replace(/[&<>"]/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"})[character]);

function replayEntrance(element, className = "is-entering") {
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
}

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
    replayEntrance(validationMessage, "is-message-entering");
}

function uniqueFolders(folders) {
    return [...new Set(folders.map(folder => String(folder).trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right, "zh-Hant"));
}

function setVaultFolderOptions(folders, selectedFolder) {
    const values = uniqueFolders([...folders, selectedFolder || ""]);
    vaultFolderSelect.replaceChildren(...values.map(folder => {
        const option = document.createElement("option");
        option.value = folder;
        option.textContent = folder;
        return option;
    }));
    const newOption = document.createElement("option");
    newOption.value = "__new__";
    newOption.textContent = "＋ 建立新分類";
    vaultFolderSelect.appendChild(newOption);
    vaultFolderSelect.value = selectedFolder && values.includes(selectedFolder) ? selectedFolder : (values[0] || "__new__");
    toggleNewFolderField(false);
}

function toggleNewFolderField(focusInput = true) {
    const creating = vaultFolderSelect.value === "__new__";
    newFolderField.classList.toggle("is-hidden", !creating);
    if (creating) {
        replayEntrance(newFolderField, "is-revealing");
        if (focusInput) vaultNewFolder.focus();
    }
}

function selectedVaultFolder() {
    const selected = vaultFolderSelect.value === "__new__" ? vaultNewFolder.value.trim() : vaultFolderSelect.value.trim();
    if (!selected) throw new Error("請選擇分類，或輸入新分類名稱。");
    if (/\.\.|[\\/:]/.test(selected)) throw new Error("分類名稱不能包含斜線、冒號或 ..。");
    return selected;
}

function rememberVaultFolder(folder) {
    const options = [...vaultFolderSelect.options];
    if (!options.some(option => option.value === folder)) {
        const option = document.createElement("option");
        option.value = folder;
        option.textContent = folder;
        vaultFolderSelect.insertBefore(option, options.find(option => option.value === "__new__") || null);
    }
    vaultFolderSelect.value = folder;
    vaultNewFolder.value = "";
    toggleNewFolderField(false);
}

async function prepareVaultDestination(markdown) {
    vaultRecommendation.textContent = "正在讀取 note-garden 分類…";
    vaultDestination.classList.remove("is-hidden");
    replayEntrance(vaultDestination, "is-revealing");
    const [foldersResult, recommendationResult] = await Promise.allSettled([
        apiRequest("/api/vault/folders"),
        apiRequest("/api/vault/classify", { method:"POST", body:JSON.stringify({ markdown }) }),
    ]);
    const folders = foldersResult.status === "fulfilled" ? foldersResult.value.folders : [];
    const fallback = foldersResult.status === "fulfilled" ? foldersResult.value.default : null;
    if (recommendationResult.status === "fulfilled") {
        const recommendation = recommendationResult.value;
        recommendedVaultFolder = recommendation.folder;
        const confidence = Math.round(Number(recommendation.confidence || 0) * 100);
        vaultRecommendation.textContent = `建議「${recommendation.folder}」· 信心 ${confidence}% · ${recommendation.reason}`;
        setVaultFolderOptions(folders, recommendation.folder);
    } else {
        recommendedVaultFolder = fallback;
        vaultRecommendation.textContent = "LLM 建議暫時無法使用，請自行選擇分類後再儲存。";
        setVaultFolderOptions(folders.length ? folders : ["Inbox"], fallback || "Inbox");
    }
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
    replayEntrance(progressCard);
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
        replayEntrance(workspaceCard);
        generateButton.firstElementChild.textContent = "Generate again";
        workspaceCard.scrollIntoView({ behavior:"smooth", block:"start" });
        currentVaultRelativePath = null;
        recommendedVaultFolder = null;
        await prepareVaultDestination(editor.value);
    } catch (error) {
        progressDetail.textContent = `Failed: ${error.message}`;
        progressPercent.textContent = "Error";
        showMessage(`生成失敗：${error.message}`, "warning");
        workspaceCard.classList.remove("is-hidden");
        replayEntrance(workspaceCard);
    } finally {
        generateButton.disabled = false;
        if (generateButton.firstElementChild.textContent === "Building…") generateButton.firstElementChild.textContent = "Generate note";
    }
}

form.addEventListener("submit", event => { event.preventDefault(); generateNote(); });
viewButtons.forEach(button => button.addEventListener("click", () => {
    workspaceGrid.dataset.view = button.dataset.view;
    viewButtons.forEach(item => item.classList.toggle("is-active", item === button));
    replayEntrance(workspaceGrid, "is-view-entering");
}));
vaultFolderSelect.addEventListener("change", () => {
    toggleNewFolderField();
    if (currentVaultRelativePath) showMessage("分類已調整；下次儲存或發布會安全搬移現有筆記。", "success");
});
vaultNewFolder.addEventListener("input", () => {
    if (currentVaultRelativePath && vaultNewFolder.value.trim()) {
        validationMessage.classList.add("is-hidden");
    }
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

document.getElementById("save-vault").addEventListener("click", async () => {
    try {
        const folder = selectedVaultFolder();
        showMessage("正在安全寫入 Obsidian Vault…", "success");
        const result = await apiRequest("/api/vault/save", {
            method:"POST",
            body:JSON.stringify({
                markdown:editor.value,
                folder,
                relative_path:currentVaultRelativePath,
            }),
        });
        currentVaultRelativePath = result.relative_path;
        rememberVaultFolder(folder);
        const moved = result.moved_from ? `（已從 ${result.moved_from} 搬移）` : "";
        showMessage(`已儲存到 Vault：${result.relative_path}${moved}`, "success");
    } catch (error) {
        showMessage(`Vault 儲存失敗：${error.message}`, "warning");
    }
});

document.getElementById("publish-note").addEventListener("click", async () => {
    try {
        const folder = selectedVaultFolder();
        showMessage("正在儲存、建立 Git commit 並推送到 GitHub…", "success");
        const result = await apiRequest("/api/vault/publish", {
            method:"POST",
            body:JSON.stringify({
                markdown:editor.value,
                folder,
                relative_path:currentVaultRelativePath,
            }),
        });
        currentVaultRelativePath = result.relative_path;
        rememberVaultFolder(folder);
        const moved = result.moved_from ? `，已從 ${result.moved_from} 搬移` : "";
        showMessage(`已發布：${result.relative_path}（${result.branch}）${moved}`, "success");
    } catch (error) {
        showMessage(`發布尚未完成：${error.message}`, "warning");
    }
});

renderMarkdown();
checkApi();
