const API_BASE_URL = window.MARKET_AGENT_API_BASE_URL || "http://127.0.0.1:8000";

const form = document.getElementById("mkt-agent-form");
const modeInputs = Array.from(document.querySelectorAll('input[name="mode"]'));
const questionInput = document.getElementById("question-input");
const holdingsInput = document.getElementById("holdings-input");
const includeNewsInput = document.getElementById("include-news");
const includeFundamentalsInput = document.getElementById("include-fundamentals");
const includeTechnicalsInput = document.getElementById("include-technicals");
const modeToggle = document.querySelector(".mode-toggle");
const portfolioField = document.querySelector(".portfolio-field");
const formNote = document.getElementById("form-note");
const apiStatus = document.getElementById("api-status");
const analyzeButton = document.querySelector(".analyze-button");
const researchSignalCard = document.getElementById("research-signal-card");
const signalPointer = document.getElementById("signal-pointer");
const signalLabel = document.getElementById("signal-label");
const summaryGrid = document.getElementById("summary-grid");
const reportCard = document.getElementById("report-card");
const reportOutput = document.getElementById("report-output");
const responseStatus = document.getElementById("response-status");
const pricePlanList = document.getElementById("price-plan-list");
const newsImpactList = document.getElementById("news-impact-list");
const jsonOutput = document.getElementById("json-output");

apiStatus.textContent = API_BASE_URL.replace(/^https?:\/\//, "");
addTraceLines();
checkApiHealth();
window.setInterval(checkApiHealth, 15000);

const getMode = () => modeInputs.find(input => input.checked)?.value || "single";

const setFormMode = (shouldReplay = false) => {
    const mode = getMode();
    const isPortfolio = mode === "portfolio";

    portfolioField.classList.toggle("is-hidden", !isPortfolio);
    researchSignalCard.classList.toggle("is-hidden", isPortfolio);
    modeToggle.classList.toggle("is-portfolio", isPortfolio);

    formNote.classList.remove("is-error");
    formNote.textContent = "預設使用 LLM analyst；如果 LLM 無法使用，後端會回傳 rule-based fallback。";

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
        showFormError("請先輸入問題。");
        return;
    }

    let endpoint = "/query";
    let payload = {
        user_query: question,
        include_news: includeNewsInput.checked,
        include_fundamentals: includeFundamentalsInput.checked,
        include_technicals: includeTechnicalsInput.checked,
        analyst_mode: "llm",
    };

    if (mode === "portfolio") {
        const holdings = parseHoldings(holdingsInput.value);
        if (holdings.length === 0) {
            showFormError("請至少輸入一個持倉，例如 VOO:5000。");
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
        ".plan-list div",
        ".news-impact-list div",
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
        ".field-card, .include-card, .signal-card, .report-card"
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
    setReportStatus("Running", "running");
    reportCard.classList.add("is-empty");
    reportOutput.textContent = "Analyzing structured market data...";
    formNote.classList.remove("is-error");
    formNote.textContent = "正在請 LLM analyst 分析；如果 LLM 無法使用，會顯示 rule-based fallback。";
    renderLoadingState(mode);

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

        renderResult(result, mode, payload);
    } catch (error) {
        setReportStatus("Error", "error");
        summaryGrid.innerHTML = renderSummaryItems([
            ["估值", "無法分析"],
            ["技術", "無法分析"],
            ["結論", "請確認 API"],
        ]);
        renderPricePlan({});
        renderNewsImpact({});
        reportOutput.textContent = `Unable to reach Market Agent API.

${error.message}`;
        jsonOutput.textContent = JSON.stringify(buildStructuredDebugView(withRequestOptions({ error: error.message }, payload)), null, 2);
    } finally {
        analyzeButton.disabled = false;
        analyzeButton.textContent = "⌕ Analyze";
    }
}

function renderLoadingState(mode) {
    summaryGrid.innerHTML = renderSummaryItems([
        ["估值", "分析中"],
        ["技術", "分析中"],
        ["結論", mode === "portfolio" ? "檢查持倉" : "等待結果"],
    ]);
    renderPricePlan({});
    renderNewsImpact({});
}

function renderResult(result, mode, payload) {
    const data = result.data || {};
    const resultMode = result.intent === "portfolio_analysis" ? "portfolio" : "single";

    setReportStatus(buildEvidenceStatusLabel(result, data), getEvidenceStatusLevel(result, data));
    reportCard.classList.remove("is-empty");
    jsonOutput.textContent = JSON.stringify(buildStructuredDebugView(withRequestOptions(result, payload)), null, 2);

    if (resultMode === "portfolio") {
        renderPortfolio(data);
        reportOutput.textContent = result.report || "No report returned.";
    } else if (result.intent === "industry_trend" || result.intent === "backtest_query") {
        renderResearchResult(result, data);
        reportOutput.textContent = result.report || "No report returned.";
    } else if (result.status && result.status !== "success") {
        renderWorkflowMessage(result, data);
        reportOutput.textContent = result.report || data.message || "No report returned.";
    } else {
        renderSingleStock(data);
        reportOutput.textContent = buildSingleStockReport(data);
    }

    formNote.classList.remove("is-error");
    formNote.textContent = "分析完成。價格區間是研究用計畫，不是投資建議。";
}

function setReportStatus(label, level = "neutral") {
    responseStatus.textContent = label;
    responseStatus.classList.remove(
        "is-high",
        "is-medium",
        "is-low-to-medium",
        "is-low",
        "is-none",
        "is-running",
        "is-error",
        "is-neutral"
    );
    responseStatus.classList.add(`is-${level.replaceAll("_", "-")}`);
}

function buildEvidenceStatusLabel(result, data) {
    if (result.status && result.status !== "success") {
        return result.status;
    }

    const evidenceLevel = getEvidenceStatusLevel(result, data);

    if (evidenceLevel === "neutral") {
        return result.status || "success";
    }

    return `Evidence: ${evidenceLevel}`;
}

function getEvidenceStatusLevel(result, data) {
    const evidenceQuality = data.evidence_quality
        || data.research_profile?.evidence_quality
        || {};
    const level = evidenceQuality.level;

    if (!level) {
        return result.status === "success" ? "neutral" : "error";
    }

    return level;
}

function withRequestOptions(result, payload) {
    return {
        ...result,
        request_options: {
            include_news: Boolean(payload.include_news),
            include_fundamentals: Boolean(payload.include_fundamentals),
            include_technicals: Boolean(payload.include_technicals),
        },
    };
}

function buildStructuredDebugView(result) {
    const data = result.data || {};

    if (result.error && !data.status) {
        return {
            status: result.status || "error",
            error: result.error,
            request_options: result.request_options || {},
        };
    }

    if (result.intent === "single_stock_analysis") {
        return buildSingleStockDebugView(result, data);
    }

    if (result.intent === "backtest_query") {
        return buildBacktestDebugView(result, data);
    }

    if (result.intent === "industry_trend") {
        return buildThemeDebugView(result, data);
    }

    if (result.intent === "portfolio_analysis") {
        return buildPortfolioDebugView(result, data);
    }

    return {
        status: result.status,
        intent: result.intent,
        request_options: result.request_options || {},
        route: result.route || {},
        error: result.error || null,
    };
}

function buildSingleStockDebugView(result, data) {
    const technical = data.technical_analysis || {};
    const signals = data.signals || {};
    const decision = buildSingleStockDecision(data);
    const newsSummary = data.news_analysis?.summary || {};
    const fundamentals = data.fundamentals || {};
    const backtestEvidence = data.backtest_evidence || {};

    return {
        status: result.status,
        intent: result.intent,
        ticker: data.ticker,
        request_options: result.request_options || {},
        route: result.route || {},
        summary: decision,
        technical: {
            current_price: technical.current_price,
            ma20: technical.ma20,
            ma50: technical.ma50,
            rsi_14: technical.rsi14,
            macd_histogram: technical.macd_histogram,
            momentum_state: technical.momentum_state,
            signals: {
                breakout: Boolean(signals.breakout?.is_breakout),
                volume_surge: Boolean(signals.volume_surge?.is_volume_surge),
                pullback: Boolean(signals.pullback?.is_pullback),
            },
        },
        news: {
            total_items: newsSummary.total_items || 0,
            sentiment: newsSummary.sentiment || "unknown",
            high_importance_count: newsSummary.high_importance_count || 0,
            top_topics: newsSummary.top_topics || {},
        },
        fundamentals: {
            status: fundamentals.status,
            stance: fundamentals.summary?.stance,
            positives: fundamentals.summary?.positives || [],
            risks: fundamentals.summary?.risks || [],
        },
        backtest_evidence: summarizeBacktestEvidence(backtestEvidence),
        ml_research: data.ml_research || data.agent_outputs?.ml_research || {},
        evidence_quality: data.evidence_quality || data.research_profile?.evidence_quality || {},
        analyst: result.analyst || {},
        error: result.error || null,
    };
}

function buildBacktestDebugView(result, data) {
    const evidenceQuality = data.evidence_quality || {};

    return {
        status: result.status,
        intent: result.intent,
        ticker: data.ticker,
        strategy: data.strategy,
        request_options: result.request_options || {},
        route: result.route || {},
        data_window: data.data_window || {},
        metrics: data.report?.metrics || {},
        evidence_quality: evidenceQuality,
        analyst: result.analyst || {},
        error: result.error || null,
    };
}

function buildThemeDebugView(result, data) {
    return {
        status: result.status,
        intent: result.intent,
        theme_key: data.theme_key,
        theme_name: data.theme_name,
        request_options: result.request_options || {},
        route: result.route || {},
        scan_scope: data.scan_scope || {},
        sector_summary: data.sector_summary || {},
        evidence_quality: data.evidence_quality || {},
        analyst: result.analyst || {},
        error: result.error || null,
    };
}

function buildPortfolioDebugView(result, data) {
    return {
        status: result.status,
        intent: result.intent,
        request_options: result.request_options || {},
        route: result.route || {},
        portfolio_summary: data.portfolio_summary || {},
        risk_summary: data.risk_summary || {},
        concentration: data.concentration || {},
        theme_exposure: data.theme_exposure || {},
        error: result.error || null,
    };
}

function summarizeBacktestEvidence(backtestEvidence = {}) {
    return {
        status: backtestEvidence.status,
        triggered_signal_count: backtestEvidence.summary?.triggered_signal_count || 0,
        strategies: backtestEvidence.summary?.strategies || [],
        best_evidence_level: backtestEvidence.summary?.best_evidence_level,
        signals: (backtestEvidence.signals || []).map(signal => ({
            strategy: signal.strategy,
            label: signal.label,
            sample_size: signal.sample_size,
            horizons: signal.horizons,
            average_return: signal.average_return,
            max_loss: signal.max_loss,
            evidence_quality: signal.evidence_quality,
        })),
    };
}

function renderResearchResult(result, data) {
    signalPointer.style.left = "50%";
    signalLabel.textContent = "中立";

    if (result.intent === "industry_trend") {
        const scanScope = data.scan_scope || {};
        const sectorSummary = data.sector_summary || {};
        summaryGrid.innerHTML = renderSummaryItems([
            ["估值", "主題掃描"],
            ["技術", `${scanScope.scanned_ticker_count || 0} 檔標的`],
            ["結論", sectorSummary.strongest_ticker ? `關注 ${sectorSummary.strongest_ticker}` : "等待更多資料"],
        ]);
    } else if (result.intent === "backtest_query") {
        summaryGrid.innerHTML = renderSummaryItems([
            ["估值", "回測不適用"],
            ["技術", data.strategy || "策略回測"],
            ["結論", data.status === "success" ? "查看歷史表現" : "需要更多條件"],
        ]);
    } else {
        summaryGrid.innerHTML = renderSummaryItems([
            ["估值", "未分類"],
            ["技術", "未分類"],
            ["結論", result.status || "需要更多資料"],
        ]);
    }

    renderPricePlan({});
    renderNewsImpact({});
}

function renderWorkflowMessage(result, data) {
    signalPointer.style.left = "50%";
    signalLabel.textContent = "中立";
    summaryGrid.innerHTML = renderSummaryItems([
        ["估值", "無法分析"],
        ["技術", "需要更多資料"],
        ["結論", data.message || result.status || "需要補充條件"],
    ]);
    renderPricePlan({});
    renderNewsImpact({});
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

function renderSingleStock(data) {
    const profile = data.research_profile || {};
    const score = calculateSingleStockSignal(profile);
    const signal = getSignalLabel(score);
    const decision = buildSingleStockDecision(data);

    signalPointer.style.left = `${score}%`;
    signalLabel.textContent = signal;
    summaryGrid.innerHTML = renderSummaryItems([
        ["估值", decision.valuation],
        ["技術", decision.technical],
        ["結論", decision.conclusion],
    ]);
    renderPricePlan(data);
    renderNewsImpact(data);
}

function renderPortfolio(data) {
    const summary = data.portfolio_summary || {};
    const risk = data.risk_summary || {};
    const concentration = data.concentration || {};

    signalPointer.style.left = "50%";
    signalLabel.textContent = "中立";
    summaryGrid.innerHTML = renderSummaryItems([
        ["估值", "Portfolio 不適用"],
        ["技術", `${summary.holding_count || 0} 檔持倉`],
        ["結論", getPortfolioConclusion(risk.risk_level, concentration.position_concentration)],
    ]);
    renderPricePlan({});
    renderNewsImpact({});
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

function buildSingleStockDecision(data) {
    const valuation = getValuationLabel(data.fundamentals);
    const technical = getTechnicalLabel(data);
    const conclusion = getConclusionLabel({ valuation, technical, data });

    return { valuation, technical, conclusion };
}

function getValuationLabel(fundamentals = {}) {
    if (!fundamentals || fundamentals.status === "skipped") {
        return "未納入基本面";
    }

    if (fundamentals.status && fundamentals.status !== "success") {
        return "估值資料不足";
    }

    const metrics = fundamentals.metrics || {};
    const trailingPe = Number(metrics.trailing_pe);
    const forwardPe = Number(metrics.forward_pe);
    const priceToSales = Number(metrics.price_to_sales);
    const revenueGrowth = Number(metrics.revenue_growth);
    const pe = Number.isFinite(forwardPe) ? forwardPe : trailingPe;

    if ((Number.isFinite(pe) && pe >= 60) || (Number.isFinite(priceToSales) && priceToSales >= 20)) {
        return "明顯偏貴";
    }

    if ((Number.isFinite(pe) && pe >= 35) || (Number.isFinite(priceToSales) && priceToSales >= 12)) {
        return "合理偏貴";
    }

    if (Number.isFinite(pe) && pe <= 20 && Number.isFinite(revenueGrowth) && revenueGrowth > 0) {
        return "合理偏便宜";
    }

    return "估值中立";
}

function getTechnicalLabel(data) {
    const technical = data.technical_analysis || {};
    const signals = data.signals || {};

    if (signals.pullback?.is_pullback) {
        return "接近支撐觀察區";
    }

    if (technical.short_term_trend === "strong" && technical.is_above_ma20) {
        return "多方比較有力";
    }

    if (technical.short_term_trend === "weak" || technical.is_above_ma20 === false) {
        return "空方壓力還在";
    }

    if (signals.breakout?.is_breakout || signals.volume_surge?.is_volume_surge) {
        return "多方剛發動，還要確認";
    }

    return "多空方向不明";
}

function getConclusionLabel({ valuation, technical, data }) {
    const newsSentiment = data.news_analysis?.summary?.sentiment || "neutral";

    if (technical === "空方壓力還在") {
        return "暫不進場";
    }

    if (valuation === "明顯偏貴") {
        return "等待更好價格";
    }

    if (technical === "接近支撐觀察區") {
        return "觀察回踩有效";
    }

    if (technical === "多方比較有力" && newsSentiment !== "negative") {
        return "可列入觀察";
    }

    if (newsSentiment === "negative") {
        return "降低進場信心";
    }

    return "還需要觀察";
}

function getPortfolioConclusion(riskLevel, concentrationLevel) {
    if (riskLevel === "high" || concentrationLevel === "high") {
        return "風險偏高";
    }

    if (riskLevel === "medium" || concentrationLevel === "medium") {
        return "需要控管部位";
    }

    if (riskLevel === "low") {
        return "風險較分散";
    }

    return "需要更多資料";
}

function renderPricePlan(data) {
    const technical = data.technical_analysis || {};
    const currentPrice = Number(technical.current_price);
    const ma20 = Number(technical.ma20);
    const ma50 = Number(technical.ma50);

    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
        pricePlanList.innerHTML = renderDefinitionItems([
            ["建議進場區間", "-"],
            ["建議出場區間", "-"],
            ["止損區間", "-"],
        ]);
        return;
    }

    const entryBase = Number.isFinite(ma20) && ma20 > 0 ? ma20 : currentPrice;
    const stopBase = Number.isFinite(ma50) && ma50 > 0 ? Math.min(ma50, entryBase) : entryBase;
    const entryLow = entryBase * 0.97;
    const entryHigh = entryBase * 1.02;
    const exitLow = Math.max(currentPrice, entryHigh) * 1.12;
    const exitHigh = Math.max(currentPrice, entryHigh) * 1.22;
    const stopPrice = stopBase * 0.94;

    pricePlanList.innerHTML = renderDefinitionItems([
        ["建議進場區間", `${formatMoney(entryLow)} ~ ${formatMoney(entryHigh)}`],
        ["建議出場區間", `${formatMoney(exitLow)} ~ ${formatMoney(exitHigh)}`],
        ["止損區間", `${formatMoney(stopPrice)} 以下`],
    ]);
}

function renderNewsImpact(data) {
    const newsAnalysis = data.news_analysis || {};
    const summary = newsAnalysis.summary || {};
    const totalItems = Number(summary.total_items || 0);

    if (!totalItems) {
        newsImpactList.innerHTML = renderDefinitionItems([
            ["新聞方向", "未納入"],
            ["影響強度", "低"],
            ["主要影響", "沒有新聞資料"],
        ]);
        return;
    }

    const sentiment = summary.sentiment || "neutral";
    const highImportanceCount = Number(summary.high_importance_count || 0);
    const topTopics = summary.top_topics || {};
    const impactType = getNewsImpactType(topTopics, sentiment);
    const impactLevel = highImportanceCount >= 2 ? "高" : highImportanceCount === 1 || sentiment !== "neutral" ? "中" : "低";
    const sentimentLabel = sentiment === "positive" ? "偏利多" : sentiment === "negative" ? "偏利空" : "中立";

    newsImpactList.innerHTML = renderDefinitionItems([
        ["新聞方向", sentimentLabel],
        ["影響強度", impactLevel],
        ["主要影響", impactType],
    ]);
}

function getNewsImpactType(topTopics, sentiment) {
    const topics = Object.entries(topTopics)
        .sort((a, b) => b[1] - a[1])
        .map(([topic]) => topic);
    const mainTopic = topics[0] || "general";

    if (["earnings", "guidance", "industry_demand"].includes(mainTopic)) {
        return "影響財報預期";
    }

    if (["macro", "lawsuit"].includes(mainTopic)) {
        return "有風險消息";
    }

    if (mainTopic === "analyst_rating") {
        return "分析師看法改變";
    }

    if (mainTopic === "product") {
        return "有產品或需求題材";
    }

    return sentiment === "neutral" ? "只是市場在關注" : "影響短線情緒";
}

function buildNewsAnalysisText({ sentiment, sentimentLabel, impactLevel, impactType, technicalLabel }) {
    const impactExplanation = describeNewsImpactType(impactType);

    if (sentiment === "negative") {
        return `近期新聞情緒為${sentimentLabel}，影響程度為${impactLevel}，主要屬於「${impactType}」。${impactExplanation} 如果技術面仍是「${technicalLabel}」，新聞面會降低立即進場的信心，較適合等待價格與量能重新確認。`;
    }

    if (sentiment === "positive") {
        return `近期新聞情緒為${sentimentLabel}，影響程度為${impactLevel}，主要屬於「${impactType}」。${impactExplanation} 新聞面有助於提升市場關注，但仍需要搭配技術面是否站回多方，以及估值是否合理來判斷。`;
    }

    return `近期新聞情緒大致中立，影響程度為${impactLevel}，主要屬於「${impactType}」。${impactExplanation} 目前新聞尚未明顯改變判斷，仍以技術面、估值與價格計畫作為主要觀察依據。`;
}

function describeNewsImpactType(impactType) {
    const descriptions = {
        "影響財報預期": "這代表新聞跟營收、獲利、財測或產業需求有關，可能會改變市場對公司未來賺多少錢的預期。",
        "有風險消息": "這代表新聞帶來不確定性，例如官司、監管、總經政策或景氣壓力，市場可能會因此變得比較保守。",
        "分析師看法改變": "這代表新聞主要來自分析師升評、降評或目標價調整，通常會影響短線股價情緒，但不一定代表公司體質已經改變。",
        "有產品或需求題材": "這代表新聞和新產品、AI、晶片、server、訂單或需求題材有關，可能提高市場想像空間，但仍要看能不能轉成營收和獲利。",
        "影響短線情緒": "這代表新聞偏正面或負面，但目前比較像短線市場情緒變化，還不一定直接改變公司的基本面。",
        "只是市場在關注": "這代表新聞本身偏中性，表示市場正在討論這檔股票，但方向還不明確。",
        "沒有新聞資料": "這代表這次沒有抓到新聞，或沒有勾選 News，所以新聞面不參與這次判斷。",
    };

    return descriptions[impactType] || "這代表新聞有影響，但目前還需要搭配基本面與技術面一起判斷。";
}

function buildSingleStockReport(data) {
    return [
        ["研究摘要", buildResearchSummaryText(data)],
        ["基本面分析", buildFundamentalAnalysisText(data)],
        ["技術面分析", buildTechnicalAnalysisText(data)],
        ["新聞面分析", buildNewsReportText(data)],
        ["ML Reference", buildMlReferenceText(data)],
        ["綜合評估", buildOverallAssessmentText(data)],
        ["風險提醒", buildRiskReminderText()],
    ].map(([title, body]) => title + "\n" + body).join("\n\n");
}

function buildResearchSummaryText(data) {
    const ticker = data.ticker || "這檔股票";
    const decision = buildSingleStockDecision(data);
    const profile = data.research_profile || {};
    const evidenceQuality = data.evidence_quality || profile.evidence_quality || {};
    const confidence = profile.research_confidence || "unknown";
    const evidenceLevel = evidenceQuality.level || confidence;
    return ticker + "目前結論為「" + decision.conclusion + "」。估值判斷是「" + decision.valuation + "」，技術面是「" + decision.technical + "」，研究信心為 " + confidence + "，證據品質為 " + evidenceLevel + "。";
}

function buildFundamentalAnalysisText(data) {
    const fundamentals = data.fundamentals || {};
    const valuation = getValuationLabel(fundamentals);
    if (!fundamentals || fundamentals.status === "skipped") {
        return "這次未納入基本面資料，因此估值判斷需要另外搭配財報、成長率、獲利能力與同業比較再確認。";
    }
    if (fundamentals.status && fundamentals.status !== "success") {
        return "目前基本面資料不足，暫時無法可靠判斷估值高低，建議先補齊營收成長、獲利能力與本益比資料。";
    }
    const metrics = fundamentals.metrics || {};
    const parts = ["目前估值判斷為「" + valuation + "」。"];
    const trailingPe = Number(metrics.trailing_pe);
    const forwardPe = Number(metrics.forward_pe);
    const revenueGrowth = Number(metrics.revenue_growth);
    const earningsGrowth = Number(metrics.earnings_growth);
    const grossMargins = Number(metrics.gross_margins);
    if (Number.isFinite(forwardPe)) {
        parts.push("Forward P/E 約 " + forwardPe.toFixed(1) + "。");
    } else if (Number.isFinite(trailingPe)) {
        parts.push("Trailing P/E 約 " + trailingPe.toFixed(1) + "。");
    }
    if (Number.isFinite(revenueGrowth)) {
        parts.push("營收成長約 " + (revenueGrowth * 100).toFixed(1) + "% 。");
    }
    if (Number.isFinite(earningsGrowth)) {
        parts.push("獲利成長約 " + (earningsGrowth * 100).toFixed(1) + "% 。");
    }
    if (Number.isFinite(grossMargins)) {
        parts.push("毛利率約 " + (grossMargins * 100).toFixed(1) + "% 。");
    }
    const summary = fundamentals.summary || {};
    const risks = summary.risks || [];
    if (risks.length) {
        parts.push("仍需留意估值、負債或獲利波動帶來的風險。");
    }
    return parts.join(" ");
}

function buildTechnicalAnalysisText(data) {
    const technical = data.technical_analysis || {};
    const signals = data.signals || {};
    const technicalLabel = getTechnicalLabel(data);
    const currentPrice = Number(technical.current_price);
    const ma20 = Number(technical.ma20);
    const ma50 = Number(technical.ma50);
    const rsi14 = Number(technical.rsi14);
    const macd = Number(technical.macd);
    const macdSignal = Number(technical.macd_signal);
    const macdHistogram = Number(technical.macd_histogram);
    const momentumState = technical.momentum_state || "neutral";
    const parts = ["目前技術判斷為「" + technicalLabel + "」。"];
    if (Number.isFinite(currentPrice)) {
        parts.push("股價約 " + formatMoney(currentPrice) + "。");
    }
    if (Number.isFinite(ma20)) {
        parts.push("MA20 約 " + formatMoney(ma20) + "。");
    }
    if (Number.isFinite(ma50)) {
        parts.push("MA50 約 " + formatMoney(ma50) + "。");
    }
    if (Number.isFinite(rsi14)) {
        parts.push("RSI 14 為 " + rsi14.toFixed(1) + "，" + describeRsi(rsi14));
    }
    if (Number.isFinite(macd) && Number.isFinite(macdSignal) && Number.isFinite(macdHistogram)) {
        parts.push("MACD 為 " + macd.toFixed(4) + "，signal 為 " + macdSignal.toFixed(4) + "，histogram 為 " + macdHistogram.toFixed(4) + "。");
    }
    parts.push(describeMomentumState(momentumState));
    if (signals.breakout?.is_breakout) {
        parts.push("價格有突破訊號，但仍需確認是否能延續。");
    }
    if (signals.volume_surge?.is_volume_surge) {
        parts.push("成交量有放大，短線關注度提高。");
    }
    if (signals.pullback?.is_pullback) {
        parts.push("價格接近 MA20 回踩區，可觀察支撐是否有效。");
    }
    if (technical.short_term_trend === "weak" || technical.is_above_ma20 === false) {
        parts.push("若尚未站回關鍵均線，立即進場信心較低。");
    }
    parts.push(buildHistoricalSignalEvidenceText(data.backtest_evidence));
    return parts.join(" ").replace(/\s+/g, " ").trim();
}

function buildHistoricalSignalEvidenceText(backtestEvidence = {}) {
    const signals = Array.isArray(backtestEvidence.signals) ? backtestEvidence.signals : [];

    if (backtestEvidence.status === "no_triggered_signals" || signals.length === 0) {
        return "歷史訊號參考：目前沒有明確突破、放量或回踩訊號，因此本次不附加歷史訊號參考。";
    }

    if (backtestEvidence.status && backtestEvidence.status !== "success") {
        const message = backtestEvidence.summary?.message || "歷史資料不足，暫時無法建立歷史訊號參考。";
        return "歷史訊號參考：" + message;
    }

    const lines = ["歷史訊號參考："];

    signals.forEach(signal => {
        const label = signal.label || getStrategyLabel(signal.strategy);
        const sampleSize = Number(signal.sample_size || 0);
        const evidenceLevel = signal.evidence_quality?.level || "unknown";
        const averageReturn = Number(signal.average_return);
        const maxLoss = Number(signal.max_loss);

        lines.push("目前出現" + label + "。過去 15 年出現類似訊號 " + sampleSize + " 次。");
        lines.push("5 個交易日後上漲勝率：" + formatPercent(signal.horizons?.["5"]?.win_rate));
        lines.push("10 個交易日後上漲勝率：" + formatPercent(signal.horizons?.["10"]?.win_rate));
        lines.push("20 個交易日後上漲勝率：" + formatPercent(signal.horizons?.["20"]?.win_rate));

        if (Number.isFinite(averageReturn)) {
            lines.push("20 個交易日平均報酬：" + formatSignedPercent(averageReturn));
        }

        if (Number.isFinite(maxLoss)) {
            lines.push("歷史最大虧損：" + formatSignedPercent(maxLoss));
        }

        lines.push("證據品質：" + evidenceLevel + "。");
    });

    lines.push("這些數字只代表過去類似技術訊號的歷史表現，不代表未來一定會重複，也不構成買賣建議。");

    return lines.join(" ");
}

function getStrategyLabel(strategy) {
    const labels = {
        breakout: "突破訊號",
        volume_surge: "放量訊號",
        pullback: "回踩訊號",
    };

    return labels[strategy] || "技術訊號";
}

function buildNewsReportText(data) {
    const newsAnalysis = data.news_analysis || {};
    const summary = newsAnalysis.summary || {};
    const totalItems = Number(summary.total_items || 0);
    if (!totalItems) {
        return "這次沒有納入新聞資料，判斷主要來自技術面與基本面資料。";
    }
    const sentiment = summary.sentiment || "neutral";
    const highImportanceCount = Number(summary.high_importance_count || 0);
    const topTopics = summary.top_topics || {};
    const impactType = getNewsImpactType(topTopics, sentiment);
    const impactLevel = highImportanceCount >= 2 ? "高" : highImportanceCount === 1 || sentiment !== "neutral" ? "中" : "低";
    const sentimentLabel = sentiment === "positive" ? "偏利多" : sentiment === "negative" ? "偏利空" : "中立";
    return buildNewsAnalysisText({ sentiment, sentimentLabel, impactLevel, impactType, technicalLabel: getTechnicalLabel(data) });
}

function buildMlReferenceText(data) {
    const mlResearch = data.ml_research || data.agent_outputs?.ml_research || {};

    if (!mlResearch || mlResearch.status !== "success") {
        const reason = mlResearch.reason || mlResearch.status || "missing ml_research output";
        const message = mlResearch.message ? " " + mlResearch.message : "";
        return "這次沒有可用的機器學習參考。原因：" + reason + "。" + message;
    }

    const lines = [
        "以下是模型根據歷史資料、技術特徵、市場環境與新聞摘要產生的參考，不會直接改變本次結論或價格計畫。",
        "",
        "上漲與風險機率：",
    ];
    const targets = mlResearch.targets || {};
    const targetLabels = [
        ["up_5d", "5 個交易日後上漲機率"],
        ["up_10d", "10 個交易日後上漲機率"],
        ["up_20d", "20 個交易日後上漲機率"],
        ["large_drop_20d", "20 個交易日內中途大跌風險"],
    ];

    targetLabels.forEach(([key, label]) => {
        const target = targets[key];
        if (!target) {
            return;
        }

        const probability = Number(target.probability);
        const probabilityText = Number.isFinite(probability)
            ? formatPercent(probability)
            : target.probability_percent || "-";
        const signalLabel = target.signal_label ? "，" + translateMlSignalLabel(target.signal_label) : "";
        lines.push("- " + label + "：" + probabilityText + signalLabel + "。");
    });

    const returnReference = mlResearch.return_reference || {};
    if (hasReturnReferenceDetails(returnReference)) {
        lines.push("");
        lines.push("歷史相似情境參考：");
        lines.push(...buildReturnReferenceLines(returnReference));
    }

    const returnModel = mlResearch.return_model || {};
    if (returnModel.status === "success") {
        lines.push("");
        lines.push("報酬模型估算：");
        lines.push("- 這是第一版實驗模型，仍以歷史區間作為主要參考。");
        lines.push(...buildReturnModelLines(returnModel));
    } else if (returnModel.status || returnModel.reason) {
        const reason = returnModel.reason || returnModel.status;
        lines.push("");
        lines.push("報酬模型估算：");
        lines.push("- 這次沒有可用的報酬模型估算。原因：" + reason + "。");
    }

    return lines.join("\n");
}

function hasReturnReferenceDetails(returnReference) {
    if (!returnReference) {
        return false;
    }

    return Boolean(
        returnReference.sample_size
        || returnReference.expected_return_range_5d
        || returnReference.expected_return_range_10d
        || returnReference.expected_return_range_20d
        || returnReference.max_drop_range_20d
    );
}

function buildReturnReferenceLines(returnReference) {
    const parts = [];
    const sampleSize = Number(returnReference.sample_size);
    const evidenceQuality = returnReference.evidence_quality;

    if (Number.isFinite(sampleSize)) {
        parts.push("- 相似樣本數：" + sampleSize + " 筆。");
    }

    if (evidenceQuality) {
        parts.push("- 證據品質：" + translateQualityLabel(evidenceQuality) + "。");
    }

    ["5d", "10d", "20d"].forEach(horizon => {
        const range = returnReference["expected_return_range_" + horizon];
        const average = returnReference["historical_average_return_" + horizon];
        const rangeText = formatRangePercent(range);
        const averageText = formatSignedPercent(average);
        const horizonLabel = translateHorizonLabel(horizon);

        if (rangeText !== "-") {
            parts.push("- " + horizonLabel + "歷史報酬區間：" + rangeText + "。");
        }

        if (averageText !== "-") {
            parts.push("- " + horizonLabel + "歷史平均報酬：" + averageText + "。");
        }
    });

    const maxDropRange = formatRangePercent(returnReference.max_drop_range_20d);
    if (maxDropRange !== "-") {
        parts.push("- 20 個交易日內中途最大跌幅區間：" + maxDropRange + "。");
    }

    return parts.length ? parts : ["- 目前沒有足夠的歷史區間資料。"];
}

function buildReturnModelLines(returnModel) {
    const targets = returnModel.targets || {};
    const labels = [
        ["forward_return_5d", "模型估算 5 個交易日報酬"],
        ["forward_return_10d", "模型估算 10 個交易日報酬"],
        ["forward_return_20d", "模型估算 20 個交易日報酬"],
        ["max_drop_20d", "模型估算 20 個交易日內中途最大跌幅"],
    ];

    return labels.map(([key, label]) => {
        const target = targets[key];
        if (!target) {
            return null;
        }

        const value = formatSignedPercent(target.predicted_value);
        const range = formatRangePercent(target.predicted_range);
        const quality = translateQualityLabel(target.model_quality || "unknown");
        const rangeText = range === "-" ? "" : "，估算區間 " + range;
        return "- " + label + "：" + value + rangeText + "，模型品質 " + quality + "。";
    }).filter(Boolean);
}

function translateMlSignalLabel(label) {
    const normalizedLabel = String(label || "").toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
    const labels = {
        bullish: "偏多",
        bearish: "偏空",
        slightly_bullish: "稍微偏多",
        slightly_bearish: "稍微偏空",
        unclear_direction: "方向不明確",
        high_large_drop_risk: "中途大跌風險偏高",
        medium_large_drop_risk: "中途大跌風險中等",
        low_large_drop_risk: "中途大跌風險偏低",
    };

    return labels[normalizedLabel] || String(label || "").replaceAll("_", " ");
}

function translateQualityLabel(label) {
    const labels = {
        high: "高",
        medium: "中",
        low_to_medium: "低到中",
        low: "低",
        none: "無",
        unknown: "未知",
    };

    return labels[label] || label;
}

function translateHorizonLabel(horizon) {
    const labels = {
        "5d": "5 個交易日",
        "10d": "10 個交易日",
        "20d": "20 個交易日",
    };

    return labels[horizon] || horizon;
}

function buildOverallAssessmentText(data) {
    const decision = buildSingleStockDecision(data);
    const profile = data.research_profile || {};
    const evidenceQuality = data.evidence_quality || profile.evidence_quality || {};
    const riskLevel = profile.risk_level || "unknown";
    const combinedScore = Number(profile.combined_score);
    const scoreText = Number.isFinite(combinedScore) ? "綜合分數為 " + combinedScore.toFixed(2) + "。" : "綜合分數目前不足。";
    const evidenceText = buildEvidenceQualityText(evidenceQuality);
    return scoreText + " 基本面、技術面與新聞面合併後，目前結論為「" + decision.conclusion + "」，風險等級為 " + riskLevel + "。" + evidenceText + " 價格計畫可作為後續觀察區間，但不代表現在一定適合進場。";
}

function describeRsi(rsi14) {
    if (rsi14 >= 70) {
        return "代表短線偏熱，追高要更謹慎。";
    }

    if (rsi14 <= 30) {
        return "代表短線偏弱或超跌，適合觀察是否出現反彈確認。";
    }

    if (rsi14 >= 55) {
        return "代表買盤動能偏強。";
    }

    if (rsi14 <= 45) {
        return "代表賣壓仍偏明顯。";
    }

    return "代表短線動能大致中性。";
}

function describeMomentumState(momentumState) {
    const descriptions = {
        bullish_but_overbought: "RSI 與 MACD 顯示多方動能仍在，但 RSI 已偏高，短線不適合用追價心態看待。",
        bearish_but_oversold: "RSI 與 MACD 顯示空方動能仍在，但 RSI 已偏低，後續可觀察是否有止跌或反彈確認。",
        bullish_momentum: "RSI 與 MACD 顯示多方動能增強，短線買盤相對占優。",
        bearish_momentum: "RSI 與 MACD 顯示空方動能仍在，短線賣壓相對占優。",
        turning_positive: "MACD 動能正在轉正，但還需要價格與量能確認是否延續。",
        turning_negative: "MACD 動能正在轉弱，短線需要留意上漲力道不足。",
        neutral: "RSI 與 MACD 目前沒有給出明確方向。",
    };

    return descriptions[momentumState] || "RSI 與 MACD 目前訊號不明確，需要搭配價格位置一起看。";
}

function buildEvidenceQualityText(evidenceQuality) {
    if (!evidenceQuality || !evidenceQuality.level) {
        return " 目前沒有足夠的證據品質資料。";
    }

    const parts = ["證據品質為 " + evidenceQuality.level];

    if (evidenceQuality.peer_group === "not_used" || evidenceQuality.market_wide === "not_used") {
        parts.push("目前尚未納入同產業或全市場相似案例驗證");
    }

    return " " + parts.join("，") + "。詳細資訊放在 Structured Data。";
}

function buildRiskReminderText() {
    return [
        "- 這份輸出只整理資料與策略訊號，不構成投資建議。",
        "- 新聞、價格資料與回測結果都可能延遲或不完整。",
        "- 進出場仍需要搭配個人風險承受度、部位大小與停損規劃。",
    ].join("\n");
}

function renderSummaryItems(items) {
    return items.map(([label, value]) => `
        <div>
            <span>${escapeHTML(label)}</span>
            <strong>${escapeHTML(String(value))}</strong>
        </div>
    `).join("");
}

function renderDefinitionItems(items) {
    return items.map(([label, value]) => `
        <div>
            <dt>${escapeHTML(label)}</dt>
            <dd>${escapeHTML(String(value))}</dd>
        </div>
    `).join("");
}

function formatMoney(value) {
    if (!Number.isFinite(value)) {
        return "-";
    }

    return `$${value.toFixed(value >= 100 ? 0 : 2)}`;
}

function formatPercent(value) {
    const numberValue = Number(value);

    if (!Number.isFinite(numberValue)) {
        return "-";
    }

    return (numberValue * 100).toFixed(1) + "%";
}

function formatSignedPercent(value) {
    const numberValue = Number(value);

    if (!Number.isFinite(numberValue)) {
        return "-";
    }

    const sign = numberValue > 0 ? "+" : "";
    return sign + (numberValue * 100).toFixed(1) + "%";
}

function formatRangePercent(range) {
    if (!range) {
        return "-";
    }

    if (Array.isArray(range) && range.length >= 2) {
        const low = formatSignedPercent(range[0]);
        const high = formatSignedPercent(range[1]);
        return low === "-" || high === "-" ? "-" : low + " ~ " + high;
    }

    const low = range.low ?? range.min ?? range.p25 ?? range.q25;
    const high = range.high ?? range.max ?? range.p75 ?? range.q75;
    const lowPercent = range.low_percent ?? range.min_percent ?? range.p25_percent ?? range.q25_percent;
    const highPercent = range.high_percent ?? range.max_percent ?? range.p75_percent ?? range.q75_percent;
    const lowText = formatSignedPercent(low);
    const highText = formatSignedPercent(high);

    if (lowText !== "-" && highText !== "-") {
        return lowText + " ~ " + highText;
    }

    const lowPercentNumber = Number(lowPercent);
    const highPercentNumber = Number(highPercent);

    if (!Number.isFinite(lowPercentNumber) || !Number.isFinite(highPercentNumber)) {
        return "-";
    }

    const lowPercentSign = lowPercentNumber > 0 ? "+" : "";
    const highPercentSign = highPercentNumber > 0 ? "+" : "";
    return lowPercentSign + lowPercentNumber.toFixed(1) + "% ~ " + highPercentSign + highPercentNumber.toFixed(1) + "%";
}

function escapeHTML(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
