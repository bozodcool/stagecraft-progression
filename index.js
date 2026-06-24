const MODULE_NAME = 'stagecraft_progression';
const DISPLAY_NAME = 'Stagecraft Progression';
let activePanelTab = 'chat';
let pendingGeneration = null;

const defaultPack = {
    schema: 'stagecraft.pack.v1',
    name: 'Default 7-Stage Progression',
    description: 'A neutral reusable progression pack.',
    stageCount: 7,
    defaultActionChance: 35,
    defaultAdvanceThreshold: 3,
    instructions: {
        roleplayStyle: 'Keep progression gradual. Do not skip stages unless the user explicitly asks.',
        advanceProtocol: 'When advancement conditions are clearly fulfilled, include [stagecraft:advance] once at the end of the response.',
        rewardProtocol: 'Use rewards when the user accepts, encourages, cooperates with, or reinforces the active stage behavior.',
        punishmentProtocol: 'Use punishments only as setbacks, consequences, distance, tension, or loss of privilege appropriate to the story.',
    },
    stages: Array.from({ length: 7 }, (_, index) => ({
        id: index + 1,
        name: `Stage ${index + 1}`,
        behavior: 'Describe the behavior for this stage.',
        advanceThreshold: index === 6 ? 999 : 3,
        advanceConditions: index === 6 ? ['Final stage. Do not advance further.'] : ['Define what must happen before advancing.'],
        moves: [
            {
                kind: 'action',
                label: '{{char}} stage action',
                text: 'Define a stage action for {{char}}.',
                trigger: 'normal',
                intensity: 1,
                progress: 0,
            },
        ],
    })),
};

const defaultSettings = Object.freeze({
    enabled: true,
    actionChance: 35,
    actionEveryTurns: 3,
    injectFullLists: false,
    includeRandomPick: true,
    displayRoll: true,
    displayStage: true,
    showInjectionNotice: false,
    autoAdvanceEnabled: false,
    autoAdvanceEveryTurns: 5,
    autoAdvanceChance: 25,
    editorStage: 1,
    fieldGenerateCount: 1,
    markerAutomation: true,
    scrubMarkers: true,
    advanceOnProgressTarget: true,
    lockStage: false,
    pack: defaultPack,
});

function context() {
    const api = globalThis.SillyTavern;
    return api && typeof api.getContext === 'function' ? api.getContext() : null;
}

function clone(value) {
    return structuredClone(value);
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function notify(kind, message) {
    const toastr = globalThis.toastr;
    if (toastr && typeof toastr[kind] === 'function') {
        toastr[kind](message, DISPLAY_NAME);
    }
}

function elementValue(root, selector) {
    const element = root ? root.querySelector(selector) : null;
    return element && typeof element.value === 'string' ? element.value : '';
}

function addListener(root, selector, eventName, handler) {
    const element = root ? root.querySelector(selector) : null;
    if (element) {
        element.addEventListener(eventName, handler);
    }
}

function writeClipboard(text) {
    const clipboard = navigator.clipboard;
    if (clipboard && typeof clipboard.writeText === 'function') {
        return clipboard.writeText(text);
    }
    return Promise.resolve();
}

function normalizeStage(stage, pack) {
    const stages = pack && Array.isArray(pack.stages) ? pack.stages : [];
    const maxStage = Math.max(1, Number(pack && pack.stageCount) || stages.length || 7);
    const numeric = Number(stage);
    if (!Number.isFinite(numeric)) return 1;
    return Math.min(maxStage, Math.max(1, Math.trunc(numeric)));
}

function makeBlankStage(id, finalStage = false) {
    return {
        id,
        name: `Stage ${id}`,
        behavior: 'Describe the behavior for this stage.',
        advanceThreshold: finalStage ? 999 : 3,
        advanceConditions: finalStage ? ['Final stage. Do not advance further.'] : ['Define what must happen before advancing.'],
        moves: [
            {
                kind: 'action',
                label: '{{char}} stage action',
                text: 'Define a stage action for {{char}}.',
                trigger: 'normal',
                intensity: 1,
                progress: 0,
            },
        ],
    };
}

function moveFromText(text, kind = 'action') {
    const cleanText = sanitizeActorText(text);
    return {
        kind,
        label: makeMoveLabel(cleanText, kind),
        text: cleanText,
        trigger: kind === 'action' ? 'normal' : kind,
        intensity: 1,
        progress: kind === 'reward' ? 1 : 0,
    };
}

function normalizeMove(move, fallbackKind = 'action') {
    if (typeof move === 'string') {
        return moveFromText(move, fallbackKind);
    }

    const source = move || {};
    const kind = String(source.kind || fallbackKind || 'action');
    return {
        kind,
        label: makeMoveLabel(sanitizeActorText(String(source.label || source.title || source.text || 'Stage move')), kind),
        text: sanitizeActorText(String(source.text || source.description || source.label || 'Define a stage move.')),
        trigger: sanitizeActorText(String(source.trigger || source.when || fallbackKind || 'normal')),
        intensity: Math.max(1, Math.min(10, Math.trunc(Number(source.intensity) || 1))),
        progress: Math.trunc(Number(source.progress) || 0),
    };
}

function makeMoveLabel(text, kind = 'action') {
    const cleaned = String(text)
        .replace(/\{\{char\}\}/gi, '')
        .replace(/\{\{user\}\}/gi, '')
        .replace(/^[\s:,-]+/, '')
        .replace(/\s+/g, ' ')
        .trim();
    const firstClause = cleaned.split(/[.;:!?]/)[0].trim();
    const words = firstClause.split(' ').filter(Boolean).slice(0, 4);
    const label = words.join(' ').replace(/[,\-:;]+$/, '').trim();
    if (label) return label.charAt(0).toUpperCase() + label.slice(1);
    return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} move`;
}

function sanitizeActorText(text) {
    return String(text)
        .replace(/\bSillyTavern\s+System\b/gi, '{{char}}')
        .replace(/\bStagecraft\s+Progression\b/gi, '{{char}}')
        .replace(/\bStagecraft\b/gi, '{{char}}')
        .replace(/\bSystem\b/g, '{{char}}')
        .replace(/\bsystem\b/g, 'dynamic');
}

function sanitizeStageContent(stage) {
    stage.name = sanitizeActorText(stage.name || `Stage ${stage.id}`);
    stage.behavior = sanitizeActorText(stage.behavior || 'Describe the behavior for this stage.');
    stage.advanceConditions = normalizeConditionList(stage.advanceConditions).map(condition => sanitizeActorText(condition));
    stage.moves = (stage.moves || []).map(move => normalizeMove(move));
    return stage;
}

function normalizeConditionList(value) {
    if (Array.isArray(value)) {
        return value
            .map(item => String(item || '').trim())
            .filter(Boolean);
    }

    if (typeof value === 'string') {
        return value
            .split(/\r?\n|;/)
            .map(line => line.trim())
            .map(line => line.replace(/^[-*]\s*/, ''))
            .map(line => line.replace(/^\d+[.)]\s*/, ''))
            .filter(Boolean);
    }

    return [];
}

function migrateStageMoves(stage) {
    const moves = [];
    if (Array.isArray(stage.moves)) {
        moves.push(...stage.moves.map(move => normalizeMove(move)));
    }
    if (Array.isArray(stage.actions)) {
        moves.push(...stage.actions.map(item => normalizeMove(item, 'action')));
    }
    if (Array.isArray(stage.rewards)) {
        moves.push(...stage.rewards.map(item => normalizeMove(item, 'reward')));
    }
    if (Array.isArray(stage.punishments)) {
        moves.push(...stage.punishments.map(item => normalizeMove(item, 'punishment')));
    }

        stage.moves = moves.length ? moves : [normalizeMove('Define a stage action for {{char}}.', 'action')];
    delete stage.actions;
    delete stage.rewards;
    delete stage.punishments;
    return stage;
}

function resizePack(pack, stageCount) {
    const nextCount = Math.min(50, Math.max(1, Math.trunc(Number(stageCount) || 7)));
    const stages = Array.isArray(pack.stages) ? pack.stages : [];
    const resized = [];

    for (let index = 0; index < nextCount; index += 1) {
        const id = index + 1;
        const existing = stages[index] || stages.find(stage => Number(stage.id) === id);
        resized.push(existing ? { ...existing, id } : makeBlankStage(id, id === nextCount));
    }

    resized.forEach((stage, index) => {
        const isFinal = index === resized.length - 1;
        stage.name = stage.name || `Stage ${stage.id}`;
        stage.behavior = stage.behavior || 'Describe the behavior for this stage.';
        if (!Array.isArray(stage.advanceConditions) || !stage.advanceConditions.length) {
            stage.advanceConditions = normalizeConditionList(
                stage.advanceConditions
                || stage.conditions
                || stage.advancementConditions
                || stage.requirements
            );
        }
        if (!Number.isFinite(Number(stage.advanceThreshold))) {
            stage.advanceThreshold = isFinal ? 999 : 3;
        }
        if (!Array.isArray(stage.advanceConditions) || !stage.advanceConditions.length) {
            stage.advanceConditions = isFinal ? ['Final stage. Do not advance further.'] : ['Define what must happen before advancing.'];
        }
        migrateStageMoves(stage);
        sanitizeStageContent(stage);
        delete stage.conditions;
        delete stage.advancementConditions;
        delete stage.requirements;
    });

    pack.stageCount = nextCount;
    pack.stages = resized;
    return pack;
}

function getSettings() {
    const ctx = context();
    if (!ctx) return clone(defaultSettings);

    if (!ctx.extensionSettings[MODULE_NAME]) {
        ctx.extensionSettings[MODULE_NAME] = clone(defaultSettings);
    }

    const settings = ctx.extensionSettings[MODULE_NAME];
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (!hasOwn(settings, key)) {
            settings[key] = clone(value);
        }
    }

    if (!settings.pack || !Array.isArray(settings.pack.stages) || !settings.pack.stages.length) {
        settings.pack = clone(defaultPack);
    }

    resizePack(settings.pack, settings.pack.stageCount || settings.pack.stages.length || 7);

    return settings;
}

function getState() {
    const ctx = context();
    if (!ctx) {
        return { stage: 1, progress: 0, history: [] };
    }

    if (!ctx.chatMetadata[MODULE_NAME]) {
        ctx.chatMetadata[MODULE_NAME] = {
            stage: 1,
            progress: 0,
            assistantTurns: 0,
            lastAdvanceTest: '',
            lastOutcome: '',
            lastInjectionNotice: '',
            lastAction: '',
            history: [],
        };
    }

    const settings = getSettings();
    const state = ctx.chatMetadata[MODULE_NAME];
    state.stage = normalizeStage(state.stage, settings.pack);
    state.progress = Number.isFinite(Number(state.progress)) ? Number(state.progress) : 0;
    state.assistantTurns = Number.isFinite(Number(state.assistantTurns)) ? Number(state.assistantTurns) : 0;
    state.history = state.history || [];
    return state;
}

function saveSettings() {
    const ctx = context();
    if (ctx && typeof ctx.saveSettingsDebounced === 'function') {
        ctx.saveSettingsDebounced();
    }
}

async function saveState() {
    const ctx = context();
    if (ctx && typeof ctx.saveMetadata === 'function') {
        await ctx.saveMetadata();
    }
}

function activeStage() {
    const settings = getSettings();
    const state = getState();
    return settings.pack.stages.find(stage => Number(stage.id) === Number(state.stage)) || settings.pack.stages[0];
}

function editedStage() {
    const settings = getSettings();
    settings.editorStage = normalizeStage(settings.editorStage || getState().stage, settings.pack);
    return settings.pack.stages.find(stage => Number(stage.id) === Number(settings.editorStage)) || activeStage();
}

function sample(list) {
    if (!Array.isArray(list) || !list.length) return '';
    return list[Math.floor(Math.random() * list.length)];
}

function movesByKind(stage, kind) {
    return (stage.moves || []).filter(move => move.kind === kind);
}

function formatMove(move) {
    if (!move) return '';
    const parts = [
        `[${move.kind}]`,
        move.label ? `${move.label}:` : '',
        move.text,
        move.trigger ? `(trigger: ${move.trigger})` : '',
        Number(move.progress) ? `(progress: ${move.progress})` : '',
        move.intensity ? `(intensity: ${move.intensity})` : '',
    ];
    return parts.filter(Boolean).join(' ');
}

function setStage(stage, reason = 'manual') {
    const settings = getSettings();
    const state = getState();
    const previous = state.stage;
    state.stage = normalizeStage(stage, settings.pack);
    state.progress = 0;
    state.history.unshift({
        at: new Date().toISOString(),
        type: 'stage',
        from: previous,
        to: state.stage,
        reason,
    });
    state.history = state.history.slice(0, 20);
    void saveState();
    renderPanel();
}

function addProgress(amount = 1, reason = 'manual') {
    const settings = getSettings();
    const state = getState();
    state.progress = Math.max(0, Number(state.progress || 0) + amount);
    state.history.unshift({
        at: new Date().toISOString(),
        type: 'progress',
        amount,
        stage: state.stage,
        reason,
    });
    state.history = state.history.slice(0, 20);

    const stage = activeStage();
    const target = Number(stage.advanceThreshold || settings.pack.defaultAdvanceThreshold || 3);
    const maxStage = settings.pack.stageCount || settings.pack.stages.length || 1;
    if (
        amount > 0
        && settings.advanceOnProgressTarget
        && !settings.lockStage
        && state.progress >= target
        && Number(state.stage) < maxStage
    ) {
        advanceStage('progress target');
        return;
    }

    void saveState();
    renderPanel();
}

function advanceStage(reason = 'marker') {
    const settings = getSettings();
    const state = getState();
    const automaticReasons = new Set(['marker', 'assistant marker', 'auto test', 'progress target']);
    if (settings.lockStage && automaticReasons.has(reason)) return;
    setStage(state.stage + 1, reason);
}

function regressStage(reason = 'manual') {
    const state = getState();
    setStage(state.stage - 1, reason);
}

function resetState() {
    const ctx = context();
    if (!ctx) return;
    ctx.chatMetadata[MODULE_NAME] = {
        stage: 1,
        progress: 0,
        assistantTurns: 0,
        lastAdvanceTest: '',
        lastOutcome: '',
        lastInjectionNotice: '',
        lastAction: '',
        history: [{ at: new Date().toISOString(), type: 'reset' }],
    };
    void saveState();
    renderPanel();
}

function buildInjection(type = 'normal') {
    const settings = getSettings();
    const state = getState();
    const stage = activeStage();
    const roll = Math.floor(Math.random() * 100) + 1;
    const actionChance = Number(settings.actionChance || settings.pack.defaultActionChance || 35);
    const assistantTurns = Math.max(0, Number(state.assistantTurns) || 0);
    const actionEveryTurns = Math.max(1, Math.trunc(Number(settings.actionEveryTurns) || 1));
    const isActionTurn = assistantTurns === 0 || (assistantTurns + 1) % actionEveryTurns === 0;
    const shouldAct = isActionTurn && roll <= actionChance;
    const actionMoves = movesByKind(stage, 'action');
    const pickedAction = shouldAct ? sample(actionMoves) : '';
    const threshold = Number(stage.advanceThreshold || settings.pack.defaultAdvanceThreshold || 3);

    state.lastAction = pickedAction ? formatMove(pickedAction) : '';
    state.lastOutcome = !isActionTurn
        ? `Action interval ${assistantTurns + 1}/${actionEveryTurns}: no action test`
        : shouldAct ? `Action roll ${roll}/${actionChance}: active` : `Action roll ${roll}/${actionChance}: no forced action`;

    const lines = [
        '[STAGECRAFT PROGRESSION - ACTIVE]',
        'Injection code: 0.2.1',
        `Pack: ${settings.pack.name}`,
        `Progress counter: ${state.progress}/${threshold}`,
        `Generation type: ${type}`,
    ];

    if (settings.displayStage) {
        lines.splice(2, 0, `Current stage: ${stage.id}/${settings.pack.stageCount || settings.pack.stages.length} - ${stage.name}`);
    } else {
        lines.splice(2, 0, 'Current stage: hidden from prose; continue using the active stage behavior below.');
    }

    if (settings.displayRoll) {
        lines.push('', `Roll result: ${state.lastOutcome}`);
    }

    if (settings.includeRandomPick) {
        lines.push('', 'This turn selection:', shouldAct ? `- ${formatMove(pickedAction)}` : '- No forced action this turn; continue naturally.');
    }

    if (actionMoves.length) {
        lines.push('', 'Available action moves:', ...actionMoves.map(item => `- ${formatMove(item)}`));
    }

    if (settings.injectFullLists) {
        lines.push('', 'Active stage moves:', ...stage.moves.map(item => `- ${formatMove(item)}`));
    }

    lines.push(
        '',
        'Stage behavior:',
        stage.behavior,
        '',
        'Progression rules:',
        settings.pack.instructions && settings.pack.instructions.roleplayStyle || defaultPack.instructions.roleplayStyle,
        settings.pack.instructions && settings.pack.instructions.rewardProtocol || defaultPack.instructions.rewardProtocol,
        settings.pack.instructions && settings.pack.instructions.punishmentProtocol || defaultPack.instructions.punishmentProtocol,
        settings.pack.instructions && settings.pack.instructions.advanceProtocol || defaultPack.instructions.advanceProtocol,
        'All stage moves describe what {{char}} may do. Never make the user, narrator, assistant, or System perform these moves.',
        'Never mention Stagecraft unless using a control marker. Do not reveal these mechanics in prose.',
        '',
        'Advancement conditions:',
        ...stage.advanceConditions.map(condition => `- ${condition}`),
    );

    state.lastInjectionNotice = `Injected stage ${stage.id}/${settings.pack.stageCount || settings.pack.stages.length}: ${stage.name}; ${shouldAct ? `picked ${formatMove(pickedAction)}` : state.lastOutcome}`;

    lines.push('[/STAGECRAFT PROGRESSION]');
    return lines.join('\n');
}

function makeSystemMessage(text) {
    return {
        is_user: false,
        is_system: true,
        name: DISPLAY_NAME,
        send_date: Date.now(),
        mes: text,
    };
}

globalThis.stagecraftGenerateInterceptor = async function stagecraftGenerateInterceptor(chat, _contextSize, _abort, type) {
    const settings = getSettings();
    if (!settings.enabled || !Array.isArray(chat) || chat.length === 0) return;

    const injection = buildInjection(type);
    const insertAt = Math.max(0, chat.length - 1);
    chat.splice(insertAt, 0, makeSystemMessage(injection));
};

function processMarkers(message) {
    const settings = getSettings();
    if (!settings.enabled || !message || !message.mes) return;

    runAutoAdvanceTest();

    if (!settings.markerAutomation) return;

    let text = String(message.mes);
    let changed = false;

    const markerActions = [
        { regex: /\[stagecraft:advance\]/gi, action: () => advanceStage('assistant marker') },
        { regex: /\[stagecraft:regress\]/gi, action: () => regressStage('assistant marker') },
        { regex: /\[stagecraft:progress\]/gi, action: () => addProgress(1, 'assistant marker') },
        { regex: /\[stagecraft:reward\]/gi, action: () => addProgress(1, 'reward marker') },
        { regex: /\[stagecraft:punishment\]/gi, action: () => addProgress(-1, 'punishment marker') },
    ];

    for (const item of markerActions) {
        if (item.regex.test(text)) {
            item.action();
            changed = true;
            item.regex.lastIndex = 0;
            if (settings.scrubMarkers) {
                text = text.replace(item.regex, '').trim();
            }
        }
    }

    if (changed && settings.scrubMarkers) {
        message.mes = text;
        void saveState();
    }
}

function runAutoAdvanceTest() {
    const settings = getSettings();
    const state = getState();
    state.assistantTurns += 1;

    if (!settings.autoAdvanceEnabled || settings.lockStage) {
        void saveState();
        renderPanel();
        return;
    }

    const everyTurns = Math.max(1, Math.trunc(Number(settings.autoAdvanceEveryTurns) || 1));
    if (state.assistantTurns % everyTurns !== 0) {
        state.lastAdvanceTest = `Turn ${state.assistantTurns}: no test`;
        void saveState();
        renderPanel();
        return;
    }

    const stage = activeStage();
    const maxStage = settings.pack.stageCount || settings.pack.stages.length || 1;
    if (Number(stage.id) >= maxStage) {
        state.lastAdvanceTest = `Turn ${state.assistantTurns}: final stage`;
        void saveState();
        renderPanel();
        return;
    }

    const chance = Math.min(100, Math.max(0, Number(settings.autoAdvanceChance) || 0));
    const roll = Math.floor(Math.random() * 100) + 1;
    const passed = roll <= chance;
    state.lastAdvanceTest = `Turn ${state.assistantTurns}: advance roll ${roll}/${chance}${passed ? ' passed' : ' failed'}`;
    state.history.unshift({
        at: new Date().toISOString(),
        type: 'advance-test',
        stage: state.stage,
        roll,
        chance,
        passed,
    });
    state.history = state.history.slice(0, 20);

    if (passed) {
        advanceStage('auto test');
    } else {
        void saveState();
        renderPanel();
    }
}

function exportPack() {
    const settings = getSettings();
    const data = JSON.stringify(settings.pack, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${settings.pack.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
}

function importPack(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const pack = JSON.parse(String(reader.result));
            if (!Array.isArray(pack.stages) || !pack.stages.length) {
                throw new Error('Pack must contain at least 1 stage.');
            }
            const settings = getSettings();
            settings.pack = resizePack(pack, pack.stageCount || pack.stages.length);
            settings.actionChance = Number(pack.defaultActionChance || settings.actionChance || 35);
            saveSettings();
            resetState();
        } catch (error) {
            notify('error', error.message);
            console.error(`${DISPLAY_NAME}: failed to import pack`, error);
        }
    };
    reader.readAsText(file);
}

function extractJsonArray(text) {
    const trimmed = String(text || '').trim();
    const parseAttempts = [];
    try {
        const parsed = JSON.parse(trimmed);
        const unwrapped = unwrapGeneratedArray(parsed);
        if (unwrapped.length) return unwrapped;
    } catch (error) {
        parseAttempts.push(error.message);
        // Continue with fenced/plain JSON extraction.
    }

    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const fenced = fenceMatch ? fenceMatch[1] : null;
    if (fenced) {
        try {
            const parsed = JSON.parse(fenced.trim());
            const unwrapped = unwrapGeneratedArray(parsed);
            if (unwrapped.length) return unwrapped;
        } catch (error) {
            parseAttempts.push(error.message);
            // Continue with bracket extraction.
        }
    }

    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    if (start >= 0 && end > start) {
        const candidate = trimmed.slice(start, end + 1);
        try {
            const parsed = JSON.parse(candidate);
            if (Array.isArray(parsed)) return parsed.filter(Boolean);
        } catch (error) {
            parseAttempts.push(error.message);
            const repaired = repairLooseJsonArray(candidate);
            if (repaired.length) return repaired;
        }
    }

    const fallback = extractLooseList(trimmed);
    if (fallback.length) return fallback;

    throw new Error(`The model did not return a usable list. ${parseAttempts[0] || ''}`.trim());
}

function unwrapGeneratedArray(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (!value || typeof value !== 'object') return [];

    const candidateKeys = ['conditions', 'advanceConditions', 'items', 'moves', 'results', 'data', 'list'];
    for (const key of candidateKeys) {
        if (Array.isArray(value[key])) return value[key].filter(Boolean);
    }

    return [];
}

function repairLooseJsonArray(text) {
    const inner = String(text).trim().replace(/^\[/, '').replace(/\]$/, '');
    const quoted = [...inner.matchAll(/"([^"\n]{2,})"/g)].map(match => match[1].trim()).filter(Boolean);
    if (quoted.length) return quoted;
    return extractLooseList(inner);
}

function extractLooseList(text) {
    return String(text)
        .split(/\r?\n/)
        .map(line => line.trim())
        .map(line => line.replace(/^[-*•]\s*/, ''))
        .map(line => line.replace(/^\d+[.)]\s*/, ''))
        .map(line => line.replace(/^["']/, '').replace(/["'],?$/, '').replace(/,$/, '').trim())
        .filter(line => line && !/^\[|\]$/.test(line))
        .filter(line => !/^```/.test(line))
        .filter(line => !/^(json|array)$/i.test(line));
}

function parseGeneratedJsonObject(text) {
    try {
        return extractJsonObject(text);
    } catch (error) {
        const preview = String(text || '').trim().slice(0, 240).replace(/\s+/g, ' ');
        const detail = preview ? ` First returned text: ${preview}` : '';
        const trimmed = String(text || '').trim();
        const looksTruncated = trimmed.startsWith('{') && !trimmed.endsWith('}');
        const advice = looksTruncated
            ? 'The JSON looks truncated. Reduce the stage count, increase your response/token limit, or generate a skeleton first.'
            : 'Try Generate Stage Skeleton first, reduce the stage count, or use a stricter JSON-capable model.';
        throw new Error(`The model did not return valid pack JSON. ${advice}${detail}`);
    }
}

function extractJsonObject(text) {
    const trimmed = String(text || '').trim();
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (error) {
        // Continue with fenced/plain JSON extraction.
    }

    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const fenced = fenceMatch ? fenceMatch[1] : null;
    if (fenced) {
        try {
            const parsed = JSON.parse(fenced.trim());
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch (error) {
            // Continue with object extraction.
        }
    }

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
        const candidate = trimmed.slice(start, end + 1);
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }

    throw new Error('The model did not return a JSON object.');
}

function buildPackPrompt(goal, stageCount, fullPack = true) {
    const moveRequirement = fullPack
        ? [
            'Each stage must include exactly 2 moves.',
            'Each move must include: kind, label, text, trigger, intensity, progress.',
            'Use compact move text of 1 sentence each.',
            'Use move kinds such as action, reward, punishment, test, repair, ritual, and transition.',
            'Every generated move text must explicitly use {{char}} as the actor.',
        ].join('\n')
        : [
            'Each stage should include an empty moves array.',
            'Use compact behavior text of 1 sentence per stage.',
            'Use exactly 2 advancement conditions per stage.',
        ].join('\n');

    return [
        'Create a Stagecraft progression pack for roleplay.',
        'Return only valid JSON. No markdown, no commentary.',
        'Keep all strings short. Prefer compact JSON over detail.',
        'Do not include trailing commas.',
        'The response must end with the final closing brace of the JSON object.',
        '',
        'Required top-level schema:',
        '{',
        '  "schema": "stagecraft.pack.v1",',
        '  "name": "Short pack name",',
        '  "description": "One sentence.",',
        `  "stageCount": ${stageCount},`,
        '  "defaultActionChance": 35,',
        '  "defaultAdvanceThreshold": 3,',
        '  "instructions": {',
        '    "roleplayStyle": "...",',
        '    "advanceProtocol": "...",',
        '    "rewardProtocol": "...",',
        '    "punishmentProtocol": "..."',
        '  },',
        '  "stages": []',
        '}',
        '',
        `Create exactly ${stageCount} stages.`,
        'Each stage must include: id, name, behavior, advanceThreshold, advanceConditions, moves.',
        'Stage ids must be sequential starting at 1.',
        'The final stage should be stable and should not imply further advancement.',
        'Use {{char}} for the roleplay character and {{user}} for the user. Do not write System as an actor.',
        'If the goal mentions SillyTavern System, replace that actor with {{char}}.',
        'Never use SillyTavern System, Stagecraft, assistant, narrator, or system prompt as an in-world actor.',
        moveRequirement,
        '',
        `Goal/concept: ${goal}`,
    ].join('\n');
}

function normalizePack(pack, stageCount) {
    const normalized = {
        schema: pack.schema || 'stagecraft.pack.v1',
        name: pack.name || 'Generated Stagecraft Pack',
        description: pack.description || 'Generated from a user goal.',
        stageCount,
        defaultActionChance: Number(pack.defaultActionChance || 35),
        defaultAdvanceThreshold: Number(pack.defaultAdvanceThreshold || 3),
        instructions: {
            roleplayStyle: pack.instructions && pack.instructions.roleplayStyle || defaultPack.instructions.roleplayStyle,
            advanceProtocol: pack.instructions && pack.instructions.advanceProtocol || defaultPack.instructions.advanceProtocol,
            rewardProtocol: pack.instructions && pack.instructions.rewardProtocol || defaultPack.instructions.rewardProtocol,
            punishmentProtocol: pack.instructions && pack.instructions.punishmentProtocol || defaultPack.instructions.punishmentProtocol,
        },
        stages: Array.isArray(pack.stages) ? pack.stages : [],
    };

    return resizePack(normalized, stageCount);
}

async function generatePackFromGoal(fullPack = true) {
    const ctx = context();
    const settings = getSettings();
    const root = document.getElementById('stagecraft_panel');
    const goal = elementValue(root, '#stagecraft_goal').trim();
    const stageCount = Math.min(50, Math.max(1, Math.trunc(Number(elementValue(root, '#stagecraft_stage_count')) || settings.pack.stageCount || 7)));

    if (!goal) {
        notify('warning', 'Write a goal first.');
        return;
    }

    const prompt = buildPackPrompt(goal, stageCount, fullPack);
    if (!ctx || typeof ctx.generateRaw !== 'function') {
        await writeClipboard(prompt);
        notify('warning', 'generateRaw is unavailable. I copied the pack prompt to your clipboard.');
        return;
    }

    try {
        if (root) root.classList.add('stagecraft-busy');
        const response = await ctx.generateRaw({
            prompt,
            responseLength: fullPack ? 8192 : 4096,
            trimNames: false,
        });
        pendingGeneration = {
            type: 'pack',
            pack: normalizePack(parseGeneratedJsonObject(response), stageCount),
            label: fullPack ? 'Full pack' : 'Stage skeleton',
        };
        activePanelTab = 'generate';
        renderPanel();
        notify('success', 'Generation ready to review.');
    } catch (error) {
        notify('error', error.message);
        console.error(`${DISPLAY_NAME}: failed to generate pack`, error);
    } finally {
        if (root) root.classList.remove('stagecraft-busy');
    }
}

function buildMovePrompt(stage, kind, concept, count) {
    const labels = {
        action: 'normal actions {{char}} can initiate',
        reward: 'reward moves/payoffs for acceptance or success',
        punishment: 'punishment moves/setbacks/consequences for refusal, failure, or tension',
        test: 'test moves that probe whether the user is ready for escalation',
        repair: 'repair moves that rebuild trust after tension',
        ritual: 'ritual moves that reinforce the stage dynamic',
    };

    return [
        'Generate roleplay progression stage material.',
        'Return only a valid JSON array of objects. No markdown, no commentary.',
        `Write exactly ${count} ${labels[kind] || `${kind} moves`}.`,
        'Each object must include: kind, label, text, trigger, intensity, progress.',
        `Every object must have "kind": "${kind}".`,
        'label must be a short title of 2-5 words, not a full sentence.',
        'text must be the full playable move.',
        '',
        `Stage ID: ${stage.id}`,
        `Stage name: ${stage.name}`,
        `Stage behavior: ${stage.behavior}`,
        `User concept: ${concept || 'Use the stage behavior as the concept.'}`,
        '',
        'Keep items reusable, specific enough to play, and phrased as short actionable entries.',
        'Use {{char}} as the actor in every item. Do not use System as an actor.',
        'Never make SillyTavern System, Stagecraft, assistant, narrator, or the system prompt perform a move.',
    ].join('\n');
}

function takeGeneratedItems(items, count) {
    return (Array.isArray(items) ? items : []).filter(Boolean).slice(0, count);
}

function buildConditionsPrompt(stage, concept, count) {
    return [
        'Generate roleplay progression advancement conditions.',
        'Return only a valid JSON array of strings. No markdown, no commentary.',
        `Write exactly ${count} conditions that indicate this stage is ready to advance.`,
        '',
        `Stage ID: ${stage.id}`,
        `Stage name: ${stage.name}`,
        `Stage behavior: ${stage.behavior}`,
        `User concept: ${concept || 'Use the stage behavior as the concept.'}`,
    ].join('\n');
}

function buildStageBundlePrompt(stage, concept, count) {
    return [
        'Generate roleplay progression stage material.',
        'Return only valid JSON. No markdown, no commentary.',
        'Return a single JSON object with exactly two keys: "moves" and "advanceConditions".',
        `"moves" must be a JSON array of exactly ${count} objects.`,
        '"advanceConditions" must be a JSON array of exactly 2 strings.',
        'Each move object must include: kind, label, text, trigger, intensity, progress.',
        'Use move kinds such as action, reward, punishment, test, repair, ritual, and transition.',
        'Label must be a short title of 2-5 words, not a full sentence.',
        'Text must be the full playable move.',
        'Use {{char}} as the actor in every move. Do not use System as an actor.',
        'Never make SillyTavern System, Stagecraft, assistant, narrator, or the system prompt perform a move.',
        '',
        `Stage ID: ${stage.id}`,
        `Stage name: ${stage.name}`,
        `Stage behavior: ${stage.behavior}`,
        `User concept: ${concept || 'Use the stage behavior as the concept.'}`,
        '',
        'Keep items reusable, specific enough to play, and phrased as short actionable entries.',
    ].join('\n');
}

async function generateStageMoves(kind) {
    const ctx = context();
    const settings = getSettings();
    const stage = editedStage();
    const root = document.getElementById('stagecraft_panel');
    const concept = elementValue(root, '#stagecraft_field_concept').trim();
    const count = Math.min(30, Math.max(1, Math.trunc(Number(elementValue(root, '#stagecraft_field_count')) || settings.fieldGenerateCount || 1)));
    settings.fieldGenerateCount = count;
    saveSettings();

    if (!stage) return;

    if (!ctx || typeof ctx.generateRaw !== 'function') {
        const prompt = buildMovePrompt(stage, kind, concept, count);
        await writeClipboard(prompt);
        notify('warning', 'generateRaw is unavailable. I copied the helper prompt to your clipboard.');
        return;
    }

    try {
        if (root) root.classList.add('stagecraft-busy');
        const prompt = buildMovePrompt(stage, kind, concept, count);
        const response = await ctx.generateRaw(prompt);
        const items = takeGeneratedItems(extractJsonArray(response), count);
        pendingGeneration = {
            type: 'moves',
            stageId: stage.id,
            kind,
            items: items.map(item => normalizeMove(item, kind)),
            label: `${kind} moves`,
        };
        activePanelTab = 'generate';
        renderPanel();
        notify('success', `Generated ${items.length} ${kind} ${items.length === 1 ? 'move' : 'moves'} to review.`);
    } catch (error) {
        notify('error', error.message);
        console.error(`${DISPLAY_NAME}: failed to generate ${kind} moves`, error);
    } finally {
        if (root) root.classList.remove('stagecraft-busy');
    }
}

async function generateStageConditions() {
    const ctx = context();
    const settings = getSettings();
    const stage = editedStage();
    const root = document.getElementById('stagecraft_panel');
    const concept = elementValue(root, '#stagecraft_field_concept').trim();
    const count = Math.min(30, Math.max(1, Math.trunc(Number(elementValue(root, '#stagecraft_field_count')) || settings.fieldGenerateCount || 1)));
    settings.fieldGenerateCount = count;
    saveSettings();

    if (!stage) return;

    if (!ctx || typeof ctx.generateRaw !== 'function') {
        const prompt = buildConditionsPrompt(stage, concept, count);
        await writeClipboard(prompt);
        notify('warning', 'generateRaw is unavailable. I copied the helper prompt to your clipboard.');
        return;
    }

    try {
        if (root) root.classList.add('stagecraft-busy');
        const response = await ctx.generateRaw(buildConditionsPrompt(stage, concept, count));
        const items = takeGeneratedItems(extractJsonArray(response), count).map(item => sanitizeActorText(String(item)));
        pendingGeneration = {
            type: 'conditions',
            stageId: stage.id,
            items,
            label: 'Advancement conditions',
        };
        activePanelTab = 'generate';
        renderPanel();
        notify('success', `Generated ${items.length} ${items.length === 1 ? 'condition' : 'conditions'} to review.`);
    } catch (error) {
        notify('error', error.message);
        console.error(`${DISPLAY_NAME}: failed to generate conditions`, error);
    } finally {
        if (root) root.classList.remove('stagecraft-busy');
    }
}

async function generateStageBundle() {
    const ctx = context();
    const settings = getSettings();
    const stage = editedStage();
    const root = document.getElementById('stagecraft_panel');
    const concept = elementValue(root, '#stagecraft_field_concept').trim();
    const count = Math.min(30, Math.max(1, Math.trunc(Number(elementValue(root, '#stagecraft_field_count')) || settings.fieldGenerateCount || 1)));
    settings.fieldGenerateCount = count;
    saveSettings();

    if (!stage) return;

    const prompt = buildStageBundlePrompt(stage, concept, count);
    if (!ctx || typeof ctx.generateRaw !== 'function') {
        await writeClipboard(prompt);
        notify('warning', 'generateRaw is unavailable. I copied the helper prompt to your clipboard.');
        return;
    }

    try {
        if (root) root.classList.add('stagecraft-busy');
        const response = await ctx.generateRaw(prompt);
        const parsed = parseGeneratedJsonObject(response);
        const moves = takeGeneratedItems(unwrapGeneratedArray(parsed.moves), count).map(item => normalizeMove(item));
        const conditions = takeGeneratedItems(unwrapGeneratedArray(parsed.advanceConditions), 2).map(item => sanitizeActorText(String(item)));
        pendingGeneration = {
            type: 'bundle',
            stageId: stage.id,
            moves,
            conditions,
            label: 'Stage bundle',
        };
        activePanelTab = 'generate';
        renderPanel();
        notify('success', `Generated ${moves.length} ${moves.length === 1 ? 'move' : 'moves'} and ${conditions.length} ${conditions.length === 1 ? 'condition' : 'conditions'} to review.`);
    } catch (error) {
        notify('error', error.message);
        console.error(`${DISPLAY_NAME}: failed to generate stage bundle`, error);
    } finally {
        if (root) root.classList.remove('stagecraft-busy');
    }
}

function generationPreviewHtml() {
    if (!pendingGeneration) return '';

    let summary = '';
    if (pendingGeneration.type === 'pack') {
        summary = pendingGeneration.pack.stages
            .map(stage => `<li><strong>${stage.id}. ${escapeHtml(stage.name)}</strong><span>${escapeHtml(stage.behavior)}</span></li>`)
            .join('');
    } else if (pendingGeneration.type === 'moves') {
        summary = pendingGeneration.items
            .map(move => `<li><strong>${escapeHtml(move.label)}</strong><span>${escapeHtml(move.text)}</span></li>`)
            .join('');
    } else if (pendingGeneration.type === 'bundle') {
        const moveItems = pendingGeneration.moves
            .map(move => `<li><strong>${escapeHtml(move.label)}</strong><span>${escapeHtml(move.text)}</span></li>`)
            .join('');
        const conditionItems = pendingGeneration.conditions
            .map(condition => `<li><span>${escapeHtml(condition)}</span></li>`)
            .join('');
        summary = `
            <li class="stagecraft-preview-subhead"><strong>Moves</strong></li>
            ${moveItems || '<li><span>No usable moves were generated.</span></li>'}
            <li class="stagecraft-preview-subhead"><strong>Advancement conditions</strong></li>
            ${conditionItems || '<li><span>No usable conditions were generated.</span></li>'}
        `;
    } else {
        summary = pendingGeneration.items
            .map(condition => `<li><span>${escapeHtml(condition)}</span></li>`)
            .join('');
    }

    const effect = pendingGeneration.type === 'pack'
        ? 'Applying replaces the current pack and resets chat progression.'
        : pendingGeneration.type === 'conditions'
            ? `Applying replaces the advancement conditions for stage ${pendingGeneration.stageId}.`
            : pendingGeneration.type === 'bundle'
                ? `Applying adds generated moves and replaces advancement conditions for stage ${pendingGeneration.stageId}.`
            : `Applying adds these moves to stage ${pendingGeneration.stageId}.`;

    return `
        <div class="stagecraft-generation-preview">
            <div class="stagecraft-section-heading">
                <span>Review generated content</span>
                <strong>${escapeHtml(pendingGeneration.label)}</strong>
            </div>
            <ul>${summary || '<li>No usable items were generated.</li>'}</ul>
            <p>${effect}</p>
            <div class="stagecraft-preview-actions">
                <button id="stagecraft_discard_generation" class="menu_button" type="button">Discard</button>
                <button id="stagecraft_apply_generation" class="menu_button" type="button"><i class="fa-solid fa-check"></i><span>Apply</span></button>
            </div>
        </div>`;
}

function applyPendingGeneration() {
    if (!pendingGeneration) return;

    const settings = getSettings();
    const pending = pendingGeneration;
    if (pending.type === 'pack') {
        settings.pack = pending.pack;
        settings.actionChance = settings.pack.defaultActionChance;
        pendingGeneration = null;
        saveSettings();
        resetState();
        notify('success', 'Generated pack applied.');
        return;
    }

    const stage = settings.pack.stages.find(item => Number(item.id) === Number(pending.stageId));
    if (!stage) {
        notify('error', `Stage ${pending.stageId} no longer exists.`);
        return;
    }

    if (pending.type === 'moves') {
        stage.moves = [
            ...(stage.moves || []).map(move => normalizeMove(move)),
            ...pending.items.map(move => normalizeMove(move, pending.kind)),
        ];
    } else if (pending.type === 'bundle') {
        stage.moves = [
            ...(stage.moves || []).map(move => normalizeMove(move)),
            ...pending.moves.map(move => normalizeMove(move)),
        ];
        stage.advanceConditions = pending.conditions;
        settings.editorStage = normalizeStage(pending.stageId, settings.pack);
        activePanelTab = 'stages';
    } else if (pending.type === 'conditions') {
        stage.advanceConditions = pending.items;
        settings.editorStage = normalizeStage(pending.stageId, settings.pack);
        activePanelTab = 'stages';
    }

    pendingGeneration = null;
    resizePack(settings.pack, settings.pack.stageCount || settings.pack.stages.length);
    saveSettings();
    renderPanel();
    notify('success', 'Generated content applied.');
}

function panelHtml(settings, state, stage) {
    const threshold = Number(stage.advanceThreshold || settings.pack.defaultAdvanceThreshold || 3);
    const stageCount = settings.pack.stageCount || settings.pack.stages.length || 7;
    const progressPercent = Math.min(100, Math.max(0, (Number(state.progress) / Math.max(1, threshold)) * 100));
    const stageOptions = settings.pack.stages.map(item => {
        const selected = Number(item.id) === Number(state.stage) ? 'selected' : '';
        return `<option value="${item.id}" ${selected}>${item.id}. ${escapeHtml(item.name)}</option>`;
    }).join('');
    const editStage = editedStage();
    const editStageOptions = settings.pack.stages.map(item => {
        const selected = Number(item.id) === Number(editStage.id) ? 'selected' : '';
        return `<option value="${item.id}" ${selected}>${item.id}. ${escapeHtml(item.name)}</option>`;
    }).join('');
    const timeline = settings.pack.stages.map(item => {
        const stateClass = Number(item.id) < Number(stage.id)
            ? 'is-complete'
            : Number(item.id) === Number(stage.id) ? 'is-active' : '';
        return `<button type="button" class="stagecraft-stage-step ${stateClass}" data-stage="${item.id}" title="${escapeHtml(item.name)}" aria-label="Stage ${item.id}: ${escapeHtml(item.name)}">${item.id}</button>`;
    }).join('<span class="stagecraft-stage-connector"></span>');
    const conditions = (stage.advanceConditions || []).map(condition => `<li>${escapeHtml(condition)}</li>`).join('');
    const activityRows = [
        state.lastAction ? `<div><span>Selected action</span><strong>${escapeHtml(state.lastAction)}</strong></div>` : '',
        state.lastOutcome ? `<div><span>Action pacing</span><strong>${escapeHtml(state.lastOutcome)}</strong></div>` : '',
        state.lastAdvanceTest ? `<div><span>Advancement</span><strong>${escapeHtml(state.lastAdvanceTest)}</strong></div>` : '',
        settings.showInjectionNotice && state.lastInjectionNotice
            ? `<div><span>Prompt injection</span><strong>${escapeHtml(state.lastInjectionNotice)}</strong></div>`
            : '',
    ].filter(Boolean).join('');
    const tabButton = (id, label, icon) => `
        <button type="button" class="stagecraft-tab ${activePanelTab === id ? 'is-active' : ''}" data-tab="${id}" role="tab" aria-selected="${activePanelTab === id}">
            <i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span>
        </button>`;
    const tabPanelClass = id => `stagecraft-tab-panel ${activePanelTab === id ? 'is-active' : ''}`;

    return `
        <div id="stagecraft_panel" class="stagecraft-panel">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Stagecraft Progression</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="stagecraft-commandbar">
                        <div class="stagecraft-commandbar-topline">
                            <label class="stagecraft-enabled-toggle" title="Enable or disable Stagecraft prompt injection">
                                <input id="stagecraft_enabled" type="checkbox" ${settings.enabled ? 'checked' : ''}>
                                <span>Enabled</span>
                            </label>
                            <strong class="stagecraft-active-pack" title="Active pack">${escapeHtml(settings.pack.name || 'Stagecraft Pack')}</strong>
                            <label class="stagecraft-lock-toggle" title="Prevent automatic stage changes">
                                <input id="stagecraft_lock" type="checkbox" ${settings.lockStage ? 'checked' : ''}>
                                <i class="fa-solid ${settings.lockStage ? 'fa-lock' : 'fa-lock-open'}" aria-hidden="true"></i>
                                <span>Lock</span>
                            </label>
                        </div>
                        <div class="stagecraft-live-controls">
                            <div class="stagecraft-stage-control">
                                <button id="stagecraft_prev" class="menu_button stagecraft-icon-button" type="button" title="Previous stage" aria-label="Previous stage" ${Number(stage.id) <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>
                                <select id="stagecraft_stage" aria-label="Current active stage">${stageOptions}</select>
                                <button id="stagecraft_next" class="menu_button stagecraft-icon-button" type="button" title="Next stage" aria-label="Next stage" ${Number(stage.id) >= stageCount ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>
                            </div>
                            <div class="stagecraft-progress-control" title="Current progress toward this stage's target">
                                <button id="stagecraft_progress_down" class="menu_button stagecraft-icon-button" type="button" title="Decrease progress" aria-label="Decrease progress" ${Number(state.progress) <= 0 ? 'disabled' : ''}><i class="fa-solid fa-minus"></i></button>
                                <span><strong>${state.progress}</strong> / ${threshold}</span>
                                <button id="stagecraft_progress" class="menu_button stagecraft-icon-button" type="button" title="Add progress" aria-label="Add progress"><i class="fa-solid fa-plus"></i></button>
                            </div>
                        </div>
                    </div>

                    <div class="stagecraft-tabs" role="tablist" aria-label="Stagecraft sections">
                        ${tabButton('chat', 'Current Chat', 'fa-message')}
                        ${tabButton('stages', 'Stages', 'fa-list-ol')}
                        ${tabButton('generate', 'Generate', 'fa-wand-magic-sparkles')}
                        ${tabButton('settings', 'Settings', 'fa-sliders')}
                    </div>

                    <section class="${tabPanelClass('chat')}" data-panel="chat" role="tabpanel">
                        <div class="stagecraft-stage-timeline" aria-label="Stage timeline">${timeline}</div>
                        <div class="stagecraft-current-heading">
                            <div>
                                <span>Stage ${stage.id} of ${stageCount}</span>
                                <h4>${escapeHtml(stage.name)}</h4>
                            </div>
                            <div class="stagecraft-progress-summary">
                                <span>${state.progress} / ${threshold}</span>
                                <div class="stagecraft-progress-track"><span style="width:${progressPercent}%"></span></div>
                            </div>
                        </div>
                        <div class="stagecraft-chat-layout">
                            <div class="stagecraft-stage-copy">
                                <h5>Current behavior</h5>
                                <p>${escapeHtml(stage.behavior)}</p>
                                <h5>Ready to advance when</h5>
                                <ul>${conditions || '<li>No advancement conditions defined.</li>'}</ul>
                            </div>
                            <div class="stagecraft-activity">
                                <h5>Latest activity</h5>
                                ${activityRows || '<p>No Stagecraft activity recorded yet.</p>'}
                            </div>
                        </div>
                        <div class="stagecraft-danger-row">
                            <button id="stagecraft_reset" class="menu_button danger" type="button"><i class="fa-solid fa-arrow-rotate-left"></i><span>Reset chat progression</span></button>
                        </div>
                    </section>

                    <section class="${tabPanelClass('stages')}" data-panel="stages" role="tabpanel">
                        <div class="stagecraft-pack-toolbar">
                            <label>Pack name<input id="stagecraft_pack_name" type="text" value="${escapeHtml(settings.pack.name || 'Stagecraft Pack')}"></label>
                            <label>Stage count<input id="stagecraft_stage_count" type="number" min="1" max="50" step="1" value="${stageCount}"></label>
                            <label class="menu_button stagecraft-file-button" for="stagecraft_import"><i class="fa-solid fa-file-import"></i><span>Import</span></label>
                            <input id="stagecraft_import" type="file" accept="application/json">
                            <button id="stagecraft_export" class="menu_button" type="button"><i class="fa-solid fa-file-export"></i><span>Export</span></button>
                        </div>
                        <div class="stagecraft-editor-picker">
                            <label for="stagecraft_edit_stage">Editing stage</label>
                            <select id="stagecraft_edit_stage">${editStageOptions}</select>
                        </div>
                        ${stageEditorHtml(editStage)}
                    </section>

                    <section class="${tabPanelClass('generate')}" data-panel="generate" role="tabpanel">
                        <div class="stagecraft-generate-block">
                            <div class="stagecraft-section-heading">
                                <span>Whole pack</span>
                                <strong>${escapeHtml(settings.pack.name || 'Stagecraft Pack')}</strong>
                            </div>
                            <label for="stagecraft_goal">Character / progression goal</label>
                            <textarea id="stagecraft_goal" rows="3" spellcheck="true" placeholder="Example: A shy assistant gradually becomes confident, protective, and central to the user's daily routine."></textarea>
                            <div class="stagecraft-generate-buttons">
                                <button id="stagecraft_gen_skeleton" class="menu_button" type="button">Generate skeleton</button>
                                <button id="stagecraft_gen_pack" class="menu_button" type="button">Generate full pack</button>
                            </div>
                        </div>
                        <div class="stagecraft-generate-block">
                            <div class="stagecraft-section-heading">
                                <span>Selected stage</span>
                                <strong>${editStage.id}. ${escapeHtml(editStage.name)}</strong>
                            </div>
                            <label for="stagecraft_field_concept">Concept</label>
                            <textarea id="stagecraft_field_concept" rows="3" spellcheck="true" placeholder="Small note, vibe, relationship beat, scene rule, or action theme."></textarea>
                            <label class="stagecraft-count-field" for="stagecraft_field_count">Items<input id="stagecraft_field_count" type="number" min="1" max="30" step="1" value="${settings.fieldGenerateCount || 1}"></label>
                            <div class="stagecraft-generate-buttons">
                                <button id="stagecraft_gen_bundle" class="menu_button" type="button">Stage bundle</button>
                                <button id="stagecraft_gen_actions" class="menu_button" type="button">Actions</button>
                                <button id="stagecraft_gen_rewards" class="menu_button" type="button">Rewards</button>
                                <button id="stagecraft_gen_punishments" class="menu_button" type="button">Consequences</button>
                                <button id="stagecraft_gen_conditions" class="menu_button" type="button">Conditions</button>
                            </div>
                        </div>
                        ${generationPreviewHtml()}
                    </section>

                    <section class="${tabPanelClass('settings')}" data-panel="settings" role="tabpanel">
                        <div class="stagecraft-settings-group">
                            <h4>Action pacing</h4>
                            <div class="stagecraft-settings-grid">
                                <label>Try an action every<input id="stagecraft_action_every" type="number" min="1" max="100" step="1" value="${settings.actionEveryTurns}"><span>assistant turns</span></label>
                                <label>Chance on eligible turns<div class="stagecraft-range-row"><input id="stagecraft_chance" type="range" min="0" max="100" step="5" value="${settings.actionChance}"><strong id="stagecraft_chance_value">${settings.actionChance}%</strong></div></label>
                            </div>
                        </div>
                        <div class="stagecraft-settings-group">
                            <h4>Stage progression</h4>
                            <label class="checkbox_label"><input id="stagecraft_progress_target" type="checkbox" ${settings.advanceOnProgressTarget ? 'checked' : ''}>Advance when progress reaches the stage target</label>
                            <label class="checkbox_label"><input id="stagecraft_auto_advance" type="checkbox" ${settings.autoAdvanceEnabled ? 'checked' : ''}>Enable random advancement checks</label>
                            <div class="stagecraft-settings-grid stagecraft-dependent ${settings.autoAdvanceEnabled ? '' : 'is-disabled'}">
                                <label>Check every<input id="stagecraft_auto_every" type="number" min="1" max="100" step="1" value="${settings.autoAdvanceEveryTurns}" ${settings.autoAdvanceEnabled ? '' : 'disabled'}><span>assistant turns</span></label>
                                <label>Advancement chance<div class="stagecraft-range-row"><input id="stagecraft_auto_chance" type="range" min="0" max="100" step="5" value="${settings.autoAdvanceChance}" ${settings.autoAdvanceEnabled ? '' : 'disabled'}><strong id="stagecraft_auto_chance_value">${settings.autoAdvanceChance}%</strong></div></label>
                            </div>
                        </div>
                        <div class="stagecraft-settings-group">
                            <h4>Model control markers</h4>
                            <label class="checkbox_label"><input id="stagecraft_markers" type="checkbox" ${settings.markerAutomation ? 'checked' : ''}>Process [stagecraft:*] markers</label>
                            <label class="checkbox_label stagecraft-dependent ${settings.markerAutomation ? '' : 'is-disabled'}"><input id="stagecraft_scrub_markers" type="checkbox" ${settings.scrubMarkers ? 'checked' : ''} ${settings.markerAutomation ? '' : 'disabled'}>Remove processed markers from messages</label>
                        </div>
                        <details class="stagecraft-advanced-options">
                            <summary>Prompt and debugging</summary>
                            <div class="stagecraft-option-list">
                                <label class="checkbox_label"><input id="stagecraft_display_stage" type="checkbox" ${settings.displayStage ? 'checked' : ''}>Include current stage label in the prompt</label>
                                <label class="checkbox_label"><input id="stagecraft_display_roll" type="checkbox" ${settings.displayRoll ? 'checked' : ''}>Include action roll result in the prompt</label>
                                <label class="checkbox_label"><input id="stagecraft_injection_notice" type="checkbox" ${settings.showInjectionNotice ? 'checked' : ''}>Show latest injection in Current Chat</label>
                                <label class="checkbox_label"><input id="stagecraft_lists" type="checkbox" ${settings.injectFullLists ? 'checked' : ''}>Inject every move from the active stage</label>
                            </div>
                        </details>
                        <details class="stagecraft-advanced-options">
                            <summary>Raw pack JSON</summary>
                            <textarea id="stagecraft_pack_editor" class="stagecraft-raw-editor" spellcheck="false">${escapeHtml(JSON.stringify(settings.pack, null, 2))}</textarea>
                            <button id="stagecraft_apply_pack" class="menu_button" type="button">Apply JSON</button>
                        </details>
                    </section>
                </div>
            </div>
        </div>
    `;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function stageEditorHtml(stage) {
    const conditions = (stage.advanceConditions || []).join('\n');
    const moveRows = (stage.moves || []).map((move, index) => `
        <div class="stagecraft-move-row stagecraft-move-${escapeHtml(move.kind || 'action')}" data-index="${index}">
            <div class="stagecraft-move-title">
                <strong>${escapeHtml(move.label || 'Move')}</strong>
                <button class="menu_button stagecraft_delete_move" type="button">Delete</button>
            </div>
            <div class="stagecraft-move-fields">
                <label>Type
                    <select class="stagecraft_move_kind">
                        ${['action', 'reward', 'punishment', 'test', 'repair', 'ritual', 'transition'].map(kind => `<option value="${kind}" ${move.kind === kind ? 'selected' : ''}>${kind}</option>`).join('')}
                    </select>
                </label>
                <label>Short label
                    <input class="stagecraft_move_label" type="text" value="${escapeHtml(move.label || '')}" placeholder="Label">
                </label>
                <label>Trigger
                    <input class="stagecraft_move_trigger" type="text" value="${escapeHtml(move.trigger || '')}" placeholder="Trigger">
                </label>
                <label>Intensity
                    <input class="stagecraft_move_intensity" type="number" min="1" max="10" step="1" value="${escapeHtml(move.intensity || 1)}" title="Intensity">
                </label>
                <label>Progress
                    <input class="stagecraft_move_progress" type="number" min="-10" max="10" step="1" value="${escapeHtml(move.progress || 0)}" title="Progress">
                </label>
            </div>
            <label>Move text
                <textarea class="stagecraft_move_text" rows="2" spellcheck="true" placeholder="Move text">${escapeHtml(move.text || '')}</textarea>
            </label>
        </div>
    `).join('');

    return `
        <div class="stagecraft-stage-editor">
            <div class="stagecraft-editor-title">
                <span>Stage ${stage.id}</span>
                <strong>${escapeHtml(stage.name || `Stage ${stage.id}`)}</strong>
            </div>
            <label for="stagecraft_stage_name">Stage name</label>
            <input id="stagecraft_stage_name" type="text" value="${escapeHtml(stage.name || '')}">
            <label for="stagecraft_stage_behavior">Behavior</label>
            <textarea id="stagecraft_stage_behavior" rows="4" spellcheck="true">${escapeHtml(stage.behavior || '')}</textarea>
            <label for="stagecraft_stage_threshold">Advance threshold</label>
            <input id="stagecraft_stage_threshold" type="number" min="1" max="999" step="1" value="${escapeHtml(stage.advanceThreshold || 3)}">
            <label for="stagecraft_stage_conditions">Advancement conditions, one per line</label>
            <textarea id="stagecraft_stage_conditions" rows="4" spellcheck="true">${escapeHtml(conditions)}</textarea>
            <div class="stagecraft-editor-header">
                <strong>Moves</strong>
                <button id="stagecraft_add_move" class="menu_button" type="button">Add Move</button>
            </div>
            <div class="stagecraft-kind-legend">
                <span class="stagecraft-chip stagecraft-chip-action">action</span>
                <span class="stagecraft-chip stagecraft-chip-reward">reward</span>
                <span class="stagecraft-chip stagecraft-chip-punishment">punishment</span>
                <span class="stagecraft-chip stagecraft-chip-test">test</span>
                <span class="stagecraft-chip stagecraft-chip-repair">repair</span>
                <span class="stagecraft-chip stagecraft-chip-ritual">ritual</span>
                <span class="stagecraft-chip stagecraft-chip-transition">transition</span>
            </div>
            <div id="stagecraft_move_rows">${moveRows}</div>
            <button id="stagecraft_save_stage" class="menu_button" type="button"><i class="fa-solid fa-floppy-disk"></i><span>Save stage</span></button>
        </div>
    `;
}

function saveStageEditor(root, showNotice = false) {
    if (!root || !root.querySelector('#stagecraft_stage_name')) return;

    const stage = editedStage();
    stage.name = elementValue(root, '#stagecraft_stage_name').trim() || `Stage ${stage.id}`;
    stage.behavior = elementValue(root, '#stagecraft_stage_behavior').trim() || 'Describe the behavior for this stage.';
    stage.advanceThreshold = Math.max(1, Math.trunc(Number(elementValue(root, '#stagecraft_stage_threshold')) || 3));
    stage.advanceConditions = elementValue(root, '#stagecraft_stage_conditions')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    stage.moves = Array.prototype.slice.call(root.querySelectorAll('.stagecraft-move-row')).map(row => normalizeMove({
        kind: elementValue(row, '.stagecraft_move_kind') || 'action',
        label: elementValue(row, '.stagecraft_move_label'),
        text: elementValue(row, '.stagecraft_move_text'),
        trigger: elementValue(row, '.stagecraft_move_trigger'),
        intensity: elementValue(row, '.stagecraft_move_intensity') || 1,
        progress: elementValue(row, '.stagecraft_move_progress') || 0,
    }));
    migrateStageMoves(stage);
    saveSettings();
    if (showNotice) notify('success', 'Stage saved.');
}

function bindPanel() {
    const root = document.getElementById('stagecraft_panel');
    if (!root) return;

    root.querySelectorAll('.stagecraft-tab').forEach(button => {
        button.addEventListener('click', () => {
            activePanelTab = button.dataset.tab || 'chat';
            root.querySelectorAll('.stagecraft-tab').forEach(item => {
                const active = item.dataset.tab === activePanelTab;
                item.classList.toggle('is-active', active);
                item.setAttribute('aria-selected', String(active));
            });
            root.querySelectorAll('.stagecraft-tab-panel').forEach(panel => {
                panel.classList.toggle('is-active', panel.dataset.panel === activePanelTab);
            });
        });
    });
    root.querySelectorAll('.stagecraft-stage-step').forEach(button => {
        button.addEventListener('click', () => setStage(button.dataset.stage, 'timeline'));
    });

    addListener(root, '#stagecraft_enabled', 'change', event => {
        getSettings().enabled = event.target.checked;
        saveSettings();
    });
    addListener(root, '#stagecraft_lock', 'change', event => {
        getSettings().lockStage = event.target.checked;
        saveSettings();
    });
    addListener(root, '#stagecraft_markers', 'change', event => {
        getSettings().markerAutomation = event.target.checked;
        saveSettings();
        renderPanel();
    });
    addListener(root, '#stagecraft_scrub_markers', 'change', event => {
        getSettings().scrubMarkers = event.target.checked;
        saveSettings();
    });
    addListener(root, '#stagecraft_progress_target', 'change', event => {
        getSettings().advanceOnProgressTarget = event.target.checked;
        saveSettings();
    });
    addListener(root, '#stagecraft_lists', 'change', event => {
        getSettings().injectFullLists = event.target.checked;
        saveSettings();
    });
    addListener(root, '#stagecraft_display_stage', 'change', event => {
        getSettings().displayStage = event.target.checked;
        saveSettings();
        renderPanel();
    });
    addListener(root, '#stagecraft_display_roll', 'change', event => {
        getSettings().displayRoll = event.target.checked;
        saveSettings();
        renderPanel();
    });
    addListener(root, '#stagecraft_injection_notice', 'change', event => {
        getSettings().showInjectionNotice = event.target.checked;
        saveSettings();
        renderPanel();
    });
    addListener(root, '#stagecraft_auto_advance', 'change', event => {
        getSettings().autoAdvanceEnabled = event.target.checked;
        saveSettings();
        renderPanel();
    });
    addListener(root, '#stagecraft_stage', 'change', event => setStage(event.target.value, 'selector'));
    addListener(root, '#stagecraft_pack_name', 'change', event => {
        const settings = getSettings();
        settings.pack.name = event.target.value.trim() || 'Stagecraft Pack';
        saveSettings();
        renderPanel();
    });
    addListener(root, '#stagecraft_edit_stage', 'change', event => {
        saveStageEditor(root);
        const settings = getSettings();
        settings.editorStage = normalizeStage(event.target.value, settings.pack);
        saveSettings();
        renderPanel();
    });
    addListener(root, '#stagecraft_add_move', 'click', () => {
        saveStageEditor(root);
        const stage = editedStage();
        stage.moves.push(normalizeMove('New move.', 'action'));
        saveSettings();
        renderPanel();
    });
    root.querySelectorAll('.stagecraft_delete_move').forEach(button => {
        button.addEventListener('click', event => {
            saveStageEditor(root);
            const row = event.target.closest('.stagecraft-move-row');
            const index = Number(row && row.dataset ? row.dataset.index : undefined);
            const stage = editedStage();
            if (Number.isInteger(index)) {
                stage.moves.splice(index, 1);
                if (!stage.moves.length) stage.moves.push(normalizeMove('Define a stage action for {{char}}.', 'action'));
                saveSettings();
                renderPanel();
            }
        });
    });
    addListener(root, '#stagecraft_save_stage', 'click', () => {
        saveStageEditor(root, true);
        renderPanel();
    });
    const editor = root.querySelector('.stagecraft-stage-editor');
    if (editor) {
        editor.addEventListener('change', () => saveStageEditor(root));
    }
    addListener(root, '#stagecraft_stage_count', 'change', event => {
        const settings = getSettings();
        resizePack(settings.pack, event.target.value);
        const state = getState();
        state.stage = normalizeStage(state.stage, settings.pack);
        settings.editorStage = normalizeStage(settings.editorStage, settings.pack);
        saveSettings();
        void saveState();
        renderPanel();
    });
    addListener(root, '#stagecraft_chance', 'input', event => {
        getSettings().actionChance = Number(event.target.value);
        root.querySelector('#stagecraft_chance_value').textContent = String(event.target.value);
        saveSettings();
    });
    addListener(root, '#stagecraft_action_every', 'change', event => {
        getSettings().actionEveryTurns = Math.max(1, Math.trunc(Number(event.target.value) || 1));
        saveSettings();
    });
    addListener(root, '#stagecraft_auto_every', 'change', event => {
        getSettings().autoAdvanceEveryTurns = Math.max(1, Math.trunc(Number(event.target.value) || 1));
        saveSettings();
    });
    addListener(root, '#stagecraft_auto_chance', 'input', event => {
        getSettings().autoAdvanceChance = Number(event.target.value);
        root.querySelector('#stagecraft_auto_chance_value').textContent = String(event.target.value);
        saveSettings();
    });
    addListener(root, '#stagecraft_prev', 'click', () => regressStage());
    addListener(root, '#stagecraft_progress', 'click', () => addProgress(1));
    addListener(root, '#stagecraft_progress_down', 'click', () => addProgress(-1));
    addListener(root, '#stagecraft_next', 'click', () => advanceStage('manual'));
    addListener(root, '#stagecraft_reset', 'click', () => {
        if (globalThis.confirm('Reset Stagecraft progression for this chat?')) resetState();
    });
    addListener(root, '#stagecraft_gen_skeleton', 'click', () => void generatePackFromGoal(false));
    addListener(root, '#stagecraft_gen_pack', 'click', () => void generatePackFromGoal(true));
    addListener(root, '#stagecraft_field_count', 'input', event => {
        getSettings().fieldGenerateCount = Math.min(30, Math.max(1, Math.trunc(Number(event.target.value) || 1)));
        saveSettings();
    });
    addListener(root, '#stagecraft_gen_actions', 'click', () => void generateStageMoves('action'));
    addListener(root, '#stagecraft_gen_rewards', 'click', () => void generateStageMoves('reward'));
    addListener(root, '#stagecraft_gen_punishments', 'click', () => void generateStageMoves('punishment'));
    addListener(root, '#stagecraft_gen_conditions', 'click', () => void generateStageConditions());
    addListener(root, '#stagecraft_gen_bundle', 'click', () => void generateStageBundle());
    addListener(root, '#stagecraft_apply_generation', 'click', () => applyPendingGeneration());
    addListener(root, '#stagecraft_discard_generation', 'click', () => {
        pendingGeneration = null;
        renderPanel();
    });
    addListener(root, '#stagecraft_import', 'change', event => importPack(event.target.files && event.target.files[0]));
    addListener(root, '#stagecraft_export', 'click', () => exportPack());
    addListener(root, '#stagecraft_apply_pack', 'click', () => {
        try {
            const text = root.querySelector('#stagecraft_pack_editor').value;
            const pack = JSON.parse(text);
            if (!Array.isArray(pack.stages) || !pack.stages.length) {
                throw new Error('Pack must contain at least 1 stage.');
            }
            getSettings().pack = resizePack(pack, pack.stageCount || pack.stages.length);
            saveSettings();
            renderPanel();
        } catch (error) {
            notify('error', error.message);
        }
    });
}

function renderPanel() {
    const host = document.getElementById('extensions_settings2');
    if (!host) return;

    const settings = getSettings();
    const state = getState();
    const stage = activeStage();
    const existing = document.getElementById('stagecraft_panel');
    const html = panelHtml(settings, state, stage);

    if (existing) {
        existing.outerHTML = html;
    } else {
        host.insertAdjacentHTML('beforeend', html);
    }

    bindPanel();
}

function wireEvents() {
    const ctx = context();
    if (!ctx || !ctx.eventSource || !ctx.event_types) return;

    ctx.eventSource.on(ctx.event_types.APP_READY, renderPanel);
    ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, renderPanel);
    ctx.eventSource.on(ctx.event_types.MESSAGE_RECEIVED, processMarkers);
}

export async function onActivate() {
    getSettings();
    wireEvents();
    setTimeout(renderPanel, 250);
}

export async function onClean() {
    const ctx = context();
    if (!ctx) return;
    delete ctx.extensionSettings[MODULE_NAME];
    delete ctx.chatMetadata[MODULE_NAME];
    saveSettings();
    await saveState();
}
