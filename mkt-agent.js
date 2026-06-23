const API_BASE_URL = window.MARKET_AGENT_API_BASE_URL || "http://127.0.0.1:8000";

const form = document.getElementById("mkt-agent-form");
const modeInputs = Array.from(document.querySelectorAll('input[name="mode"]'));
const tickerInput = document.getElementById("ticker-input");
const questionInput = document.getElementById("question-input");
const holdingsInput = document.getElementById("holdings-input");
const includeNewsInput = document.getElementById("include-news");
const includeFundamentalsInput = document.getElementById("include-fundamentals");
const includeTechnicalsInput = document.getElementById("include-technicals");
const modeToggle = document.querySelector(".mode-toggle");
const singleField = document.querySelector(".single-field");
const portfolioField = document.querySelector(".portfolio-field");
const formNote = document.getElementById("form-note");
const apiStatus = document.getElementById("api-status");
const analyzeButton = document.querySelector(".analyze-button");
const researchSignalCard = document.getElementById("research-signal-card");
const signalPointer = document.getElementById("signal-pointer");
const signalLabel = document.getElementById("signal-label");
const summaryGrid = document.getElementById("summary-grid");
const analystStatus = document.getElementById("analyst-status");
const reportCard = document.getElementById("report-card");
const reportOutput = document.getElementById("report-output");
const responseStatus = document.getElementById("response-status");
const executionList = document.getElementById("execution-list");
const jsonOutput = document.getElementById("json-output");

apiStatus.textContent = API_BASE_URL.replace(/^https?:\/\//, "");
addTraceLines();
checkApiHealth();
window.setInterval(checkApiHealth, 15000);

const getMode = () => modeInputs.find(input => input.checked)?.value || "single";

const setFormMode = (shouldReplay = false) => {
    const mode = getMode();
    const isPortfolio = mode === "portfolio";

    singleField.classList.toggle("is-hidden", isPortfolio);
    portfolioField.classList.toggle("is-hidden", !isPortfolio);
    researchSignalCard.classList.toggle("is-hidden", isPortfolio);
    modeToggle.classList.toggle("is-portfolio", isPortfolio);

    formNote.classList.remove("is-error");
    formNote.textContent = "LLM analyst is requested by default. If it fails, the backend returns a template fallback report.";

    if (shouldReplay) {
        replayVisibleEntranceAnimations();
    }
};

modeInputs.forEach(input => input.addEventListener("change", () => setFormMode(true)));
setFormMode();

form.addEventListener("submit", async event => {
    event.preventDefault();

    const mode = getMode();
    const question = questionInput.value.trim();

    if (!question) {
        showFormError("Please enter a question.");
        return;
    }

    let endpoint = "/analyze/single";
    let payload = {
        user_query: question,
        include_news: includeNewsInput.checked,
        include_fundamentals: includeFundamentalsInput.checked,
        include_technicals: includeTechnicalsInput.checked,
        analyst_mode: "llm",
    };

    if (mode === "single") {
        const ticker = tickerInput.value.trim().toUpperCase();
        if (!ticker) {
            showFormError("請先輸入股票代號。");
            return;
        }
        payload.ticker = ticker;
    } else {
        const holdings = parseHoldings(holdingsInput.value);
        if (holdings.length === 0) {
            showFormError("Please enter at least one holding, for example VOO:5000.");
            return;
        }
        endpoint = "/portfolio";
        payload.holdings = holdings;
    }

    await runAnalysis(endpoint, payload, mode);
});

function replayVisibleEntranceAnimations() {
    const animatedElements = [
        ".mkt-kicker",
        ".mkt-hero h1",
        ".mkt-intro",
        ".form-note",
        ".mkt-card",
        ".mkt-card > :not(.trace-border-svg)",
        ".trace-border-svg rect",
        ".summary-grid div",
        ".analyze-button",
    ];

    window.requestAnimationFrame(() => {
        const elements = animatedElements.flatMap(selector =>
            Array.from(document.querySelectorAll(selector))
        ).filter(element => element.offsetParent !== null);

        elements.forEach(element => {
            element.style.animation = "none";
        });

        document.body.offsetHeight;

        elements.forEach(element => {
            element.style.animation = "";
        });
    });
}

function showFormError(message) {
    formNote.classList.add("is-error");
    formNote.textContent = message;
}

function addTraceLines() {
    const cards = document.querySelectorAll(
        ".field-card, .include-card, .signal-card, .report-card, .detail-grid .mkt-card"
    );

    cards.forEach(card => {
        if (card.querySelector(".trace-border-svg")) {
            return;
        }

        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");

        svg.classList.add("trace-border-svg");
        svg.setAttribute("viewBox", "0 0 100 100");
        svg.setAttribute("preserveAspectRatio", "none");
        rect.setAttribute("x", "1");
        rect.setAttribute("y", "1");
        rect.setAttribute("width", "98");
        rect.setAttribute("height", "98");
        rect.setAttribute("rx", "2");
        rect.setAttribute("pathLength", "100");
        svg.append(rect);
        card.append(svg);
    });
}

function parseHoldings(rawValue) {
    return rawValue
        .split(/\n|,/)
        .map(item => item.trim())
        .filter(Boolean)
        .map(item => {
            const [tickerPart, valuePart] = item.split(":");
            const ticker = (tickerPart || "").trim().toUpperCase();
            const marketValue = Number((valuePart || "").trim());

            if (!ticker) {
                return null;
            }

            const holding = { ticker };
            if (Number.isFinite(marketValue) && marketValue > 0) {
                holding.market_value = marketValue;
            }
            return holding;
        })
        .filter(Boolean);
}

async function runAnalysis(endpoint, payload, mode) {
    analyzeButton.disabled = true;
    analyzeButton.textContent = "Analyzing...";
    responseStatus.textContent = "Running";
    reportCard.classList.add("is-empty");
    reportOutput.textContent = "Analyzing structured market data...";
    formNote.classList.remove("is-error");
    formNote.textContent = "Requesting LLM analyst. Fallback report will be shown if the LLM is unavailable.";

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.detail || `Request failed: ${response.status}`);
        }

        renderResult(result, mode);
    } catch (error) {
        responseStatus.textContent = "Error";
        analystStatus.textContent = "Unavailable";
        summaryGrid.innerHTML = renderSummaryItems([
            ["Mode", mode === "portfolio" ? "Portfolio" : "Single Stock"],
            ["Status", "Error"],
            ["Analyst", "Unavailable"],
        ]);
        reportOutput.textContent = `Unable to reach Market Agent API.

${error.message}`;
        jsonOutput.textContent = JSON.stringify({ error: error.message }, null, 2);
    } finally {
        analyzeButton.disabled = false;
        analyzeButton.textContent = "⌕ Analyze";
    }
}

function renderResult(result, mode) {
    const data = result.data || {};
    const analyst = result.analyst || {};
    const fallbackUsed = Boolean(analyst.fallback_used);
    const analystLabel = fallbackUsed ? "Template fallback" : "AI";

    responseStatus.textContent = result.status || "success";
    analystStatus.textContent = analystLabel;
    reportCard.classList.remove("is-empty");
    reportOutput.textContent = result.report || "No report returned.";
    jsonOutput.textContent = JSON.stringify(result, null, 2);
    renderStatusSummary(mode, result.status || data.status || "success", analystLabel);

    if (fallbackUsed) {
        formNote.classList.add("is-error");
        formNote.textContent = "LLM failed or is not configured. Showing rule-based fallback report.";
    } else {
        formNote.classList.remove("is-error");
        formNote.textContent = analyst.message || "LLM analyst completed.";
    }

    renderExecution(result, data, analyst);

    if (mode === "portfolio") {
        renderPortfolio(data);
    } else {
        renderSingleStock(data);
    }
}

async function checkApiHealth() {
    try {
        const response = await fetch(`${API_BASE_URL}/health`, {
            method: "GET",
            cache: "no-store",
        });

        if (!response.ok) {
            throw new Error(`API health failed: ${response.status}`);
        }

        apiStatus.classList.add("is-online");
        apiStatus.classList.remove("is-offline");
    } catch (_error) {
        apiStatus.classList.remove("is-online");
        apiStatus.classList.add("is-offline");
    }
}

function renderStatusSummary(mode, status, analystLabel) {
    summaryGrid.innerHTML = renderSummaryItems([
        ["Mode", mode === "portfolio" ? "Portfolio" : "Single Stock"],
        ["Status", status || "-"],
        ["Analyst", analystLabel || "-"],
    ]);
}

function renderExecution(result, data, analyst) {
    const plan = data.execution_plan || [];
    executionList.innerHTML = [
        ["Intent", result.intent || data.intent || "-"],
        ["Plan", plan.length ? plan.join(" -> ") : "-"],
        ["Fallback", analyst.fallback_used ? "true" : "false"],
    ].map(([label, value]) => `
        <div>
            <dt>${escapeHTML(label)}</dt>
            <dd>${escapeHTML(String(value))}</dd>
        </div>
    `).join("");
}

function renderSingleStock(data) {
    const profile = data.research_profile || {};
    const score = calculateSingleStockSignal(profile);
    const signal = getSignalLabel(score);

    signalPointer.style.left = `${score}%`;
    signalLabel.textContent = signal;
}

function renderPortfolio(_data) {
    signalPointer.style.left = "50%";
    signalLabel.textContent = "Neutral";
}

function calculateSingleStockSignal(profile) {
    const combinedScore = Number(profile.combined_score || 0);
    const riskLevel = profile.risk_level || "unknown";
    const riskPenalty = riskLevel === "high" ? 18 : riskLevel === "medium" ? 9 : 0;
    const rawScore = 50 + combinedScore * 9 - riskPenalty;
    return Math.max(0, Math.min(100, Math.round(rawScore)));
}

function getSignalLabel(score) {
    if (score < 20) return "明顯利空";
    if (score < 40) return "偏利空";
    if (score < 60) return "中立";
    if (score < 80) return "偏利多";
    return "明顯利多";
}

function renderSummaryItems(items) {
    return items.map(([label, value]) => `
        <div>
            <span>${escapeHTML(label)}</span>
            <strong>${escapeHTML(String(value))}</strong>
        </div>
    `).join("");
}

function escapeHTML(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
