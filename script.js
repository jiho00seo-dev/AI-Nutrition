// API Key is now managed in config.js (excluded from git)
const GEMINI_API_KEY = typeof CONFIG !== 'undefined' ? CONFIG.GEMINI_API_KEY : "YOUR_API_KEY_HERE";

// 캐시 시스템 (LocalStorage 활용)
const CACHE_KEY_TIMING = "ai_nutrition_cache_timing";
const CACHE_KEY_INTERACTION = "ai_nutrition_cache_interaction";

function getCache(key) {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : {};
}

function setCache(key, id, value) {
    const cache = getCache(key);
    const isLiked = cache[id] ? cache[id].liked : false;
    cache[id] = {
        data: value,
        timestamp: Date.now(),
        liked: isLiked
    };
    localStorage.setItem(key, JSON.stringify(cache));
}

window.toggleLike = function (cacheKey, id) {
    const cache = getCache(cacheKey);
    if (cache[id]) {
        cache[id].liked = !cache[id].liked;
        localStorage.setItem(cacheKey, JSON.stringify(cache));
        const btn = document.querySelector(`.like-btn[data-id="${id}"]`);
        if (btn) btn.classList.toggle('active');
        console.log(`[Feedback] '${id}' 좋아요 상태 변경.`);
    }
}

let selectedStack = [];

// DOM Elements
const input = document.getElementById('supplement-input');
const addBtn = document.getElementById('add-btn');
const stackContainer = document.getElementById('supplement-stack');
const analyzeBtn = document.getElementById('analyze-btn');
const resultSection = document.getElementById('result-section');
const resultContent = document.getElementById('result-content');
const loadingState = document.getElementById('loading-state');
const resultContainer = document.getElementById('result-container');

const timingInput = document.getElementById('timing-input');
const timingCheckBtn = document.getElementById('timing-check-btn');
const timingResult = document.getElementById('timing-result');
const timingLoading = document.getElementById('timing-loading');

const interactionTab = document.getElementById('tab-interaction');
const timingTab = document.getElementById('tab-timing');
const interactionView = document.getElementById('interaction-view');
const timingView = document.getElementById('timing-view');

// Tab Switching
interactionTab.addEventListener('click', () => {
    interactionTab.classList.add('active');
    timingTab.classList.remove('active');
    interactionView.classList.remove('hidden');
    timingView.classList.add('hidden');
});

timingTab.addEventListener('click', () => {
    timingTab.classList.add('active');
    interactionTab.classList.remove('active');
    timingView.classList.remove('hidden');
    interactionView.classList.add('hidden');
});

// JSON 응답 정제 함수 (마크다운 코드 블록 제거)
function cleanJsonResponse(text) {
    const regex = /```(?:json)?\s*([\s\S]*?)\s*```/;
    const match = text.match(regex);
    if (match) return match[1].trim();

    const startIdx = text.indexOf('[');
    const endIdx = text.lastIndexOf(']');
    if (startIdx !== -1 && endIdx !== -1) {
        return text.substring(startIdx, endIdx + 1).trim();
    }

    const objStart = text.indexOf('{');
    const objEnd = text.lastIndexOf('}');
    if (objStart !== -1 && objEnd !== -1) {
        return text.substring(objStart, objEnd + 1).trim();
    }

    return text.trim();
}

// 1. 복용 시기 확인 (Smart Caching 적용)
async function checkTiming() {
    const name = timingInput.value.trim();
    if (!name) return;

    // 로컬 캐시 확인
    const timingCache = getCache(CACHE_KEY_TIMING);
    if (timingCache[name]) {
        console.log(`[Cache Hit] '${name}' 정보를 캐시에서 불러왔습니다.`);
        renderTimingResult(name, timingCache[name].data, true);
        return;
    }

    timingResult.innerHTML = '';
    timingLoading.classList.remove('hidden');

    const prompt = `당신은 세계적인 영양학자이자 건강 코치입니다. 다음 영양제의 최적 복용 시기, 그에 대한 상세한 과학적 이유, 그리고 반드시 피해야 할 상황(시점/약물 궁합 등)을 분석하십시오.
    
    대상 영양제: "${name}"
    
    응답은 반드시 아래의 JSON 형식을 완벽하게 지켜서 출력하십시오.
    {
        "best": ["시점1", "시점2"],
        "reason": "왜 그 시점이 가장 좋은지 전문적인 이유를 3~4문장의 한국어로 상세히 설명하십시오.",
        "avoid": "언제 복용하는 것을 피해야 하는지, 혹은 같이 먹으면 안 되는 상황은 무엇인지 2~3문장의 한국어로 상세히 설명하십시오.",
        "warning": "기타 추가 주의사항(부작용, 권장 용량 등)이 있다면 작성하고, 없으면 null이라고 쓰십시오."
    }
    
    답변 시 주의사항:
    - "reason"과 "avoid" 필드는 반드시 상세한 설명이 포함되어야 합니다. 단답형은 절대 금지입니다.
    - 한국어로 친절하면서도 신뢰감 있는 어조를 사용하십시오.`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error.message);

        const aiText = data.candidates[0].content.parts[0].text;
        const cleanedJson = cleanJsonResponse(aiText);
        let info;
        try {
            info = JSON.parse(cleanedJson.trim());
        } catch (e) {
            info = aiText;
        }

        // 데이터 필드 추출 로직 고도화
        let parsedInfo = {};
        if (typeof info === 'object' && info !== null) {
            if (Array.isArray(info)) {
                parsedInfo = { reason: info.join(' '), best: [], avoid: "" };
            } else {
                parsedInfo = {
                    best: Array.isArray(info.best) ? info.best : (info.best ? [info.best] : []),
                    reason: info.reason || info.explanation || info.description || "",
                    avoid: info.avoid || info.caution || info.warning || "",
                    warning: info.warning || null
                };
            }
        } else {
            parsedInfo = { reason: info || aiText, best: [], avoid: "" };
        }

        // 캐시에 저장
        setCache(CACHE_KEY_TIMING, name, parsedInfo);
        renderTimingResult(name, parsedInfo, false);

    } catch (error) {
        console.error("복용 시기 분석 오류:", error);
        timingResult.innerHTML = `<div class="timing-card"><p class="interaction-desc">분석 중 오류가 발생했습니다. (사유: ${error.message})</p></div>`;
    } finally {
        timingLoading.classList.add('hidden');
    }
}

function renderTimingResult(name, info, isCached) {
    const bestTime = info.best || [];
    const reason = info.reason || "정보가 없습니다.";
    const avoid = info.avoid || "특별히 피해야 할 시점 정보가 없습니다.";
    const warning = (info.warning && info.warning !== "null" && info.warning !== "없음" && info.warning !== info.avoid) ? info.warning : null;

    // 캐시에서 좋아요 상태 확인
    const cache = getCache(CACHE_KEY_TIMING);
    const isLiked = cache[name] ? cache[name].liked : false;

    const badges = bestTime.map(t => {
        let cls = '';
        if (!t) return '';
        const timeStr = String(t);
        if (timeStr.includes('오전')) cls = 'morning';
        if (timeStr.includes('밤') || timeStr.includes('취침') || timeStr.includes('저녁')) cls = 'night';
        if (timeStr.includes('공복') || timeStr.includes('식전')) cls = 'empty';
        if (timeStr.includes('식후') || timeStr.includes('식사')) cls = 'after-meal';
        return `<span class="time-badge ${cls}">${timeStr}</span>`;
    }).join('');

    timingResult.innerHTML = `
        <div class="timing-card">
            <div class="timing-badge-row">
                ${badges}
                ${isLiked ? '<span class="verified-badge">⭐ FOUNDER APPROVED</span>' : ''}
                ${isCached ? '<span class="time-badge" style="background:#f1f5f9; color:#64748b; font-size:0.6rem; border:1px dashed #cbd5e1;">⚡ FAST LOAD</span>' : ''}
            </div>
            <div class="timing-info">
                <div class="interaction-title">
                    <h3>${name}</h3>
                    <button class="like-btn ${isLiked ? 'active' : ''}" data-id="${name}" onclick="toggleLike(CACHE_KEY_TIMING, '${name}')" title="이 답변이 마음에 드시나요?">❤️</button>
                </div>
                <div class="timing-section">
                    <h4 class="section-title">✨ 왜 이때 먹어야 하나요?</h4>
                    <p class="section-content">${reason}</p>
                </div>
                <div class="timing-section avoid">
                    <h4 class="section-title">❌ 이때는 꼭 피하세요!</h4>
                    <p class="section-content">${avoid}</p>
                </div>
            </div>
            ${warning ? `<div class="timing-warning">⚠️ 추가 주의: ${warning}</div>` : ''}
            <!-- 향후 쿠팡 파트너스 API나 딥링크가 준비되면 이곳에 AFID를 적용하세요 -->
            <a href="https://www.coupang.com/np/search?q=${encodeURIComponent(name)}" target="_blank" class="coupang-btn">
                쿠팡에서 ${name} 최저가 확인
            </a>
        </div>
    `;
}

timingCheckBtn.addEventListener('click', checkTiming);
timingInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') checkTiming(); });

// 2. 영양제 스택 추가
function addSupplement() {
    const value = input.value.trim();
    if (value && !selectedStack.includes(value)) {
        selectedStack.push(value);
        renderStack();
        input.value = '';
        updateAnalyzeButton();
    }
}

function renderStack() {
    stackContainer.innerHTML = '';
    selectedStack.forEach((item, index) => {
        const chip = document.createElement('div');
        chip.className = 'chip';
        chip.innerHTML = `<span>${item}</span><button class="remove-btn" onclick="removeSupplement(${index})">&times;</button>`;
        stackContainer.appendChild(chip);
    });
}

window.removeSupplement = function (index) {
    selectedStack.splice(index, 1);
    renderStack();
    updateAnalyzeButton();
    if (selectedStack.length === 0) resultSection.classList.add('hidden');
}

function updateAnalyzeButton() {
    analyzeBtn.disabled = selectedStack.length < 2;
    if (analyzeBtn.disabled) analyzeBtn.classList.add('disabled');
    else analyzeBtn.classList.remove('disabled');
}

// 3. 궁합 분석 (Smart Caching 적용)
async function analyzeStack() {
    const stackId = [...selectedStack].sort().map(s => s.toLowerCase()).join('|');
    const interactionCache = getCache(CACHE_KEY_INTERACTION);

    if (interactionCache[stackId]) {
        console.log(`[Cache Hit] 스택 정보를 캐시에서 불러왔습니다.`);
        resultSection.classList.remove('hidden');
        resultContainer.classList.remove('hidden');
        renderResults(interactionCache[stackId].data);
        resultSection.scrollIntoView({ behavior: 'smooth' });
        return;
    }

    resultSection.classList.remove('hidden');
    resultContainer.classList.add('hidden');
    loadingState.classList.remove('hidden');
    resultContent.innerHTML = '';

    const prompt = `당신은 전문 영양학자이자 바이오해커입니다. 사용자가 섭취하는 다음 영양제 리스트를 분석하십시오: [${selectedStack.join(', ')}]. 
    분석 기준:
    1. 흡수를 방해하는 나쁜 조합 (Caution)
    2. 효과를 높이는 시너지 조합 (Excellent/Good)
    3. 일반적인 주의사항
    
    응답은 반드시 마크다운 코드 블록 없이 순수한 JSON 배열 형식으로만 하십시오. 예시:
    [
        {"combination": ["영양제1", "영양제2"], "interaction": "Caution", "reason": "이유", "recommendation": "권장사항"}
    ]
    모든 텍스트는 한국어로 작성하십시오.`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error.message);

        const aiText = data.candidates[0].content.parts[0].text;
        const cleanedJson = cleanJsonResponse(aiText);
        const interactions = JSON.parse(cleanedJson);

        setCache(CACHE_KEY_INTERACTION, stackId, interactions);
        renderResults(interactions);

    } catch (error) {
        console.error("궁합 분석 오류:", error);
        resultContent.innerHTML = `<p class="interaction-desc">분석 중 오류가 발생했습니다. (사유: ${error.message})</p>`;
    } finally {
        loadingState.classList.add('hidden');
        resultContainer.classList.remove('hidden');
        resultSection.scrollIntoView({ behavior: 'smooth' });
    }
}

function renderResults(interactions) {
    if (Array.isArray(interactions) && interactions.length > 0) {
        interactions.forEach((match, index) => {
            const stackId = [...selectedStack].sort().map(s => s.toLowerCase()).join('|');
            const cache = getCache(CACHE_KEY_INTERACTION);
            const isLiked = cache[stackId] ? cache[stackId].liked : false;

            const div = document.createElement('div');
            div.className = 'interaction-item';
            const badgeClass = match.interaction ? match.interaction.toLowerCase() : 'good';

            const compName = Array.isArray(match.combination) ? match.combination.join(' ') : (match.combination || '영양제');

            div.innerHTML = `
                <div class="interaction-title">
                    <div class="title-content">
                        <span class="badge ${badgeClass}">${match.interaction || 'Info'}</span>
                        ${Array.isArray(match.combination) ? match.combination.join(' + ') : (match.combination || '일반 정보')}
                        ${isLiked ? '<span class="verified-badge">⭐ TRUSTED</span>' : ''}
                    </div>
                    <button class="like-btn ${isLiked ? 'active' : ''}" data-id="${stackId}" onclick="toggleLike(CACHE_KEY_INTERACTION, '${stackId}')">❤️</button>
                </div>
                <p class="interaction-desc">${match.reason}</p>
                <div class="recommendation">💡 추천: ${match.recommendation}</div>
                <!-- 향후 쿠팡 파트너스 API나 딥링크가 준비되면 이곳에 AFID를 적용하세요 -->
                <a href="https://www.coupang.com/np/search?q=${encodeURIComponent(compName)}" target="_blank" class="coupang-btn">
                    쿠팡에서 ${compName} 최저가 확인
                </a>
            `;
            resultContent.appendChild(div);
        });
    } else {
        resultContent.innerHTML = '<p class="interaction-desc">입력하신 조합에서 특별한 주의사항이 발견되지 않았습니다. 안전하게 섭취하셔도 좋습니다!</p>';
    }
}

addBtn.addEventListener('click', addSupplement);
input.addEventListener('keypress', (e) => { if (e.key === 'Enter') addSupplement(); });
analyzeBtn.addEventListener('click', analyzeStack);
