const MODULE_NAME = 'stagecraft_progression';
const DISPLAY_NAME = 'Stagecraft Progression';

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
                label: 'Stage action',
                text: 'Define a stage action.',
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
    injectFullLists: true,
    includeRandomPick: true,
    displayRoll: true,
    displayStage: true,
    autoAdvanceEnabled: false,
    autoAdvanceEveryTurns: 5,
    autoAdvanceChance: 25,
    markerAutomation: true,
    scrubMarkers: true,
    lockStage: false,
    pack: defaultPack,
});

function context() {
    return globalThis.SillyTavern?.getContext?.();
}

function clone(value) {
    return structuredClone(value);
}

function normalizeStage(stage, pack) {
    const maxStage = Math.max(1, Number(pack?.stageCount) || pack?.stages?.length || 7);
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
                label: 'Stage action',
                text: 'Define a stage action.',
                trigger: 'normal',
                intensity: 1,
                progress: 0,
            },
        ],
    };
}

function moveFromText(text, kind = 'action') {
    return {
        kind,
        label: String(text).slice(0, 48),
        text: String(text),
        trigger: kind === 'action' ? 'normal' : kind,
        intensity: 1,
        progress: kind === 'reward' ? 1 : 0,
    };
}

function normalizeMove(move, fallbackKind = 'action') {
    if (typeof move === 'string') {
        return moveFromText(move, fallbackKind);
    }

    return {
        kind: String(move?.kind || fallbackKind || 'action'),
        label: String(move?.label || move?.title || move?.text || 'Stage move').slice(0, 80),
        text: String(move?.text || move?.description || move?.label || 'Define a stage move.'),
        trigger: String(move?.trigger || move?.when || fallbackKind || 'normal'),
        intensity: Math.max(1, Math.min(10, Math.trunc(Number(move?.intensity) || 1))),
        progress: Math.trunc(Number(move?.progress) || 0),
    };
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

    stage.moves = moves.length ? moves : [normalizeMove('Define a stage action.', 'action')];
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
        stage.name ||= `Stage ${stage.id}`;
        stage.behavior ||= 'Describe the behavior for this stage.';
        if (!Number.isFinite(Number(stage.advanceThreshold))) {
            stage.advanceThreshold = isFinal ? 999 : 3;
        }
        if (!Array.isArray(stage.advanceConditions) || !stage.advanceConditions.length) {
            stage.advanceConditions = isFinal ? ['Final stage. Do not advance further.'] : ['Define what must happen before advancing.'];
        }
        migrateStageMoves(stage);
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
        if (!Object.hasOwn(settings, key)) {
            settings[key] = clone(value);
        }
    }

    if (!settings.pack?.stages?.length) {
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
            lastAction: '',
            history: [],
        };
    }

    const settings = getSettings();
    const state = ctx.chatMetadata[MODULE_NAME];
    state.stage = normalizeStage(state.stage, settings.pack);
    state.progress = Number.isFinite(Number(state.progress)) ? Number(state.progress) : 0;
    state.assistantTurns = Number.isFinite(Number(state.assistantTurns)) ? Number(state.assistantTurns) : 0;
    state.history ??= [];
    return state;
}

function saveSettings() {
    context()?.saveSettingsDebounced?.();
}

async function saveState() {
    await context()?.saveMetadata?.();
}

function activeStage() {
    const settings = getSettings();
    const state = getState();
    return settings.pack.stages.find(stage => Number(stage.id) === Number(state.stage)) || settings.pack.stages[0];
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
    void saveState();
    renderPanel();
}

function advanceStage(reason = 'marker') {
    const settings = getSettings();
    const state = getState();
    if (settings.lockStage) return;
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
    const pickedAction = shouldAct ? sample(movesByKind(stage, 'action')) : '';
    const pickedReward = sample(movesByKind(stage, 'reward'));
    const pickedPunishment = sample(movesByKind(stage, 'punishment'));
    const threshold = Number(stage.advanceThreshold || settings.pack.defaultAdvanceThreshold || 3);

    state.lastAction = pickedAction ? formatMove(pickedAction) : '';
    state.lastOutcome = !isActionTurn
        ? `Action interval ${assistantTurns + 1}/${actionEveryTurns}: no action test`
        : shouldAct ? `Action roll ${roll}/${actionChance}: active` : `Action roll ${roll}/${actionChance}: no forced action`;

    const lines = [
        '[STAGECRAFT PROGRESSION - ACTIVE]',
        `Pack: ${settings.pack.name}`,
        `Progress counter: ${state.progress}/${threshold}`,
        `Generation type: ${type}`,
        '',
        'Stage behavior:',
        stage.behavior,
        '',
        'Progression rules:',
        settings.pack.instructions?.roleplayStyle || defaultPack.instructions.roleplayStyle,
        settings.pack.instructions?.rewardProtocol || defaultPack.instructions.rewardProtocol,
        settings.pack.instructions?.punishmentProtocol || defaultPack.instructions.punishmentProtocol,
        settings.pack.instructions?.advanceProtocol || defaultPack.instructions.advanceProtocol,
        'Never mention Stagecraft unless using a control marker. Do not reveal these mechanics in prose.',
        '',
        'Advancement conditions:',
        ...stage.advanceConditions.map(condition => `- ${condition}`),
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
        if (pickedReward) lines.push(`- Reward move option: ${formatMove(pickedReward)}`);
        if (pickedPunishment) lines.push(`- Punishment move option: ${formatMove(pickedPunishment)}`);
    }

    if (settings.injectFullLists) {
        lines.push('', 'Active stage moves:', ...stage.moves.map(item => `- ${formatMove(item)}`));
    }

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
    if (!settings.enabled || !message?.mes) return;

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
            globalThis.toastr?.error?.(error.message, DISPLAY_NAME);
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
        if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch (error) {
        parseAttempts.push(error.message);
        // Continue with fenced/plain JSON extraction.
    }

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
        try {
            const parsed = JSON.parse(fenced.trim());
            if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
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
            if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
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
    } catch {
        throw new Error('The model did not return valid pack JSON. Try Generate Stage Skeleton first, or reduce the stage count.');
    }
}

function extractJsonObject(text) {
    const trimmed = String(text || '').trim();
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
        // Continue with fenced/plain JSON extraction.
    }

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
        try {
            const parsed = JSON.parse(fenced.trim());
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch {
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
            'Each stage must include 8-12 moves.',
            'Each move must include: kind, label, text, trigger, intensity, progress.',
            'Use move kinds such as action, reward, punishment, test, repair, ritual, and transition.',
        ].join('\n')
        : [
            'Each stage should include an empty moves array.',
            'Focus on clean stage names, behavior, and advancement conditions.',
        ].join('\n');

    return [
        'Create a Stagecraft progression pack for roleplay.',
        'Return only valid JSON. No markdown, no commentary.',
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
            roleplayStyle: pack.instructions?.roleplayStyle || defaultPack.instructions.roleplayStyle,
            advanceProtocol: pack.instructions?.advanceProtocol || defaultPack.instructions.advanceProtocol,
            rewardProtocol: pack.instructions?.rewardProtocol || defaultPack.instructions.rewardProtocol,
            punishmentProtocol: pack.instructions?.punishmentProtocol || defaultPack.instructions.punishmentProtocol,
        },
        stages: Array.isArray(pack.stages) ? pack.stages : [],
    };

    return resizePack(normalized, stageCount);
}

async function generatePackFromGoal(fullPack = true) {
    const ctx = context();
    const settings = getSettings();
    const root = document.getElementById('stagecraft_panel');
    const goal = root?.querySelector('#stagecraft_goal')?.value?.trim();
    const stageCount = Math.min(50, Math.max(1, Math.trunc(Number(root?.querySelector('#stagecraft_stage_count')?.value) || settings.pack.stageCount || 7)));

    if (!goal) {
        globalThis.toastr?.warning?.('Write a goal first.', DISPLAY_NAME);
        return;
    }

    const prompt = buildPackPrompt(goal, stageCount, fullPack);
    if (typeof ctx?.generateRaw !== 'function') {
        await navigator.clipboard?.writeText?.(prompt);
        globalThis.toastr?.warning?.('generateRaw is unavailable. I copied the pack prompt to your clipboard.', DISPLAY_NAME);
        return;
    }

    try {
        root?.classList.add('stagecraft-busy');
        const response = await ctx.generateRaw(prompt);
        settings.pack = normalizePack(parseGeneratedJsonObject(response), stageCount);
        settings.actionChance = settings.pack.defaultActionChance;
        saveSettings();
        resetState();
        globalThis.toastr?.success?.(fullPack ? 'Generated full pack from goal.' : 'Generated stage skeleton from goal.', DISPLAY_NAME);
    } catch (error) {
        globalThis.toastr?.error?.(error.message, DISPLAY_NAME);
        console.error(`${DISPLAY_NAME}: failed to generate pack`, error);
    } finally {
        root?.classList.remove('stagecraft-busy');
    }
}

function buildMovePrompt(stage, kind, concept, count) {
    const labels = {
        action: 'normal actions the character can initiate',
        reward: 'reward moves/payoffs for acceptance or success',
        punishment: 'punishment moves/setbacks/consequences for refusal, failure, or tension',
        test: 'test moves that probe whether the user is ready for escalation',
        repair: 'repair moves that rebuild trust after tension',
        ritual: 'ritual moves that reinforce the stage dynamic',
    };

    return [
        'Generate roleplay progression stage material.',
        'Return only a valid JSON array of strings. No markdown, no commentary.',
        `Write exactly ${count} ${labels[kind] || `${kind} moves`}.`,
        'Each string must be a concise playable move.',
        '',
        `Stage ID: ${stage.id}`,
        `Stage name: ${stage.name}`,
        `Stage behavior: ${stage.behavior}`,
        `User concept: ${concept || 'Use the stage behavior as the concept.'}`,
        '',
        'Keep items reusable, specific enough to play, and phrased as short actionable entries.',
    ].join('\n');
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

async function generateStageMoves(kind) {
    const ctx = context();
    const settings = getSettings();
    const state = getState();
    const stage = settings.pack.stages.find(item => Number(item.id) === Number(state.stage));
    const root = document.getElementById('stagecraft_panel');
    const concept = root?.querySelector('#stagecraft_field_concept')?.value?.trim() || '';
    const count = Math.min(30, Math.max(1, Math.trunc(Number(root?.querySelector('#stagecraft_field_count')?.value) || 8)));

    if (!stage) return;

    if (typeof ctx?.generateRaw !== 'function') {
        const prompt = buildMovePrompt(stage, kind, concept, count);
        await navigator.clipboard?.writeText?.(prompt);
        globalThis.toastr?.warning?.('generateRaw is unavailable. I copied the helper prompt to your clipboard.', DISPLAY_NAME);
        return;
    }

    try {
        root?.classList.add('stagecraft-busy');
        const prompt = buildMovePrompt(stage, kind, concept, count);
        const response = await ctx.generateRaw(prompt);
        const items = extractJsonArray(response);
        const otherMoves = (stage.moves || []).filter(move => move.kind !== kind);
        stage.moves = [
            ...otherMoves,
            ...items.map(item => normalizeMove(item, kind)),
        ];
        resizePack(settings.pack, settings.pack.stageCount || settings.pack.stages.length);
        saveSettings();
        renderPanel();
        globalThis.toastr?.success?.(`Generated ${items.length} ${kind} moves.`, DISPLAY_NAME);
    } catch (error) {
        globalThis.toastr?.error?.(error.message, DISPLAY_NAME);
        console.error(`${DISPLAY_NAME}: failed to generate ${kind} moves`, error);
    } finally {
        root?.classList.remove('stagecraft-busy');
    }
}

async function generateStageConditions() {
    const ctx = context();
    const settings = getSettings();
    const state = getState();
    const stage = settings.pack.stages.find(item => Number(item.id) === Number(state.stage));
    const root = document.getElementById('stagecraft_panel');
    const concept = root?.querySelector('#stagecraft_field_concept')?.value?.trim() || '';
    const count = Math.min(30, Math.max(1, Math.trunc(Number(root?.querySelector('#stagecraft_field_count')?.value) || 8)));

    if (!stage) return;

    if (typeof ctx?.generateRaw !== 'function') {
        const prompt = buildConditionsPrompt(stage, concept, count);
        await navigator.clipboard?.writeText?.(prompt);
        globalThis.toastr?.warning?.('generateRaw is unavailable. I copied the helper prompt to your clipboard.', DISPLAY_NAME);
        return;
    }

    try {
        root?.classList.add('stagecraft-busy');
        const response = await ctx.generateRaw(buildConditionsPrompt(stage, concept, count));
        stage.advanceConditions = extractJsonArray(response);
        saveSettings();
        renderPanel();
        globalThis.toastr?.success?.(`Generated ${stage.advanceConditions.length} conditions.`, DISPLAY_NAME);
    } catch (error) {
        globalThis.toastr?.error?.(error.message, DISPLAY_NAME);
        console.error(`${DISPLAY_NAME}: failed to generate conditions`, error);
    } finally {
        root?.classList.remove('stagecraft-busy');
    }
}

function panelHtml(settings, state, stage) {
    const threshold = Number(stage.advanceThreshold || settings.pack.defaultAdvanceThreshold || 3);
    const stageCount = settings.pack.stageCount || settings.pack.stages.length || 7;
    const statusStage = settings.displayStage
        ? `<strong>Stage ${stage.id}/${stageCount}</strong><span>${escapeHtml(stage.name)}</span>`
        : '<strong>Stage Hidden</strong><span>State is still active</span>';
    const statusRoll = settings.displayRoll && state.lastOutcome
        ? `<div class="stagecraft-roll">${escapeHtml(state.lastOutcome)}</div>`
        : '';
    const advanceTest = state.lastAdvanceTest
        ? `<div class="stagecraft-roll">${escapeHtml(state.lastAdvanceTest)}</div>`
        : '';
    const stageOptions = settings.pack.stages.map(item => {
        const selected = Number(item.id) === Number(state.stage) ? 'selected' : '';
        return `<option value="${item.id}" ${selected}>${item.id}. ${escapeHtml(item.name)}</option>`;
    }).join('');

    return `
        <div id="stagecraft_panel" class="stagecraft-panel">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Stagecraft Progression</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="stagecraft-status">
                        <div>
                            ${statusStage}
                            ${statusRoll}
                            ${advanceTest}
                        </div>
                        <div>${state.progress}/${threshold}</div>
                    </div>
                    <label class="checkbox_label">
                        <input id="stagecraft_enabled" type="checkbox" ${settings.enabled ? 'checked' : ''}>
                        Enabled
                    </label>
                    <label class="checkbox_label">
                        <input id="stagecraft_lock" type="checkbox" ${settings.lockStage ? 'checked' : ''}>
                        Lock current stage
                    </label>
                    <label class="checkbox_label">
                        <input id="stagecraft_markers" type="checkbox" ${settings.markerAutomation ? 'checked' : ''}>
                        React to [stagecraft:*] markers
                    </label>
                    <label class="checkbox_label">
                        <input id="stagecraft_lists" type="checkbox" ${settings.injectFullLists ? 'checked' : ''}>
                        Inject full move list
                    </label>
                    <label class="checkbox_label">
                        <input id="stagecraft_display_stage" type="checkbox" ${settings.displayStage ? 'checked' : ''}>
                        Display stage
                    </label>
                    <label class="checkbox_label">
                        <input id="stagecraft_display_roll" type="checkbox" ${settings.displayRoll ? 'checked' : ''}>
                        Display roll
                    </label>
                    <label class="checkbox_label">
                        <input id="stagecraft_auto_advance" type="checkbox" ${settings.autoAdvanceEnabled ? 'checked' : ''}>
                        Auto-test stage advancement
                    </label>
                    <label for="stagecraft_stage">Current stage</label>
                    <select id="stagecraft_stage">${stageOptions}</select>
                    <label for="stagecraft_stage_count">Number of stages</label>
                    <input id="stagecraft_stage_count" type="number" min="1" max="50" step="1" value="${stageCount}">
                    <label for="stagecraft_auto_every">Test every X assistant turns</label>
                    <input id="stagecraft_auto_every" type="number" min="1" max="100" step="1" value="${settings.autoAdvanceEveryTurns}">
                    <label for="stagecraft_auto_chance">Advance threshold: <span id="stagecraft_auto_chance_value">${settings.autoAdvanceChance}</span>%</label>
                    <input id="stagecraft_auto_chance" type="range" min="0" max="100" step="5" value="${settings.autoAdvanceChance}">
                    <label for="stagecraft_chance">Action chance: <span id="stagecraft_chance_value">${settings.actionChance}</span>%</label>
                    <input id="stagecraft_chance" type="range" min="0" max="100" step="5" value="${settings.actionChance}">
                    <label for="stagecraft_action_every">Pick action every X assistant turns</label>
                    <input id="stagecraft_action_every" type="number" min="1" max="100" step="1" value="${settings.actionEveryTurns}">
                    ${stageEditorHtml(stage)}
                    <div class="stagecraft-buttons">
                        <button id="stagecraft_prev" class="menu_button">Back</button>
                        <button id="stagecraft_progress" class="menu_button">+ Progress</button>
                        <button id="stagecraft_next" class="menu_button">Advance</button>
                        <button id="stagecraft_reset" class="menu_button danger">Reset</button>
                    </div>
                    <div class="stagecraft-generator">
                        <label for="stagecraft_goal">Character / progression goal</label>
                        <textarea id="stagecraft_goal" rows="3" spellcheck="true" placeholder="Example: A shy assistant gradually becomes confident, protective, and central to the user's daily routine."></textarea>
                        <div class="stagecraft-generate-buttons">
                            <button id="stagecraft_gen_skeleton" class="menu_button">Generate Stage Skeleton</button>
                            <button id="stagecraft_gen_pack" class="menu_button">Generate Full Pack</button>
                        </div>
                    </div>
                    <div class="stagecraft-generator">
                        <label for="stagecraft_field_concept">Stage field concept</label>
                        <textarea id="stagecraft_field_concept" rows="3" spellcheck="true" placeholder="Small note, vibe, kink, relationship beat, scene rule, or action theme."></textarea>
                        <label for="stagecraft_field_count">Items to generate</label>
                        <input id="stagecraft_field_count" type="number" min="1" max="30" step="1" value="8">
                        <div class="stagecraft-generate-buttons">
                            <button id="stagecraft_gen_actions" class="menu_button">Generate Actions</button>
                            <button id="stagecraft_gen_rewards" class="menu_button">Generate Reward Moves</button>
                            <button id="stagecraft_gen_punishments" class="menu_button">Generate Punishment Moves</button>
                            <button id="stagecraft_gen_conditions" class="menu_button">Generate Conditions</button>
                        </div>
                    </div>
                    <div class="stagecraft-pack-row">
                        <label class="menu_button" for="stagecraft_import">Import Pack</label>
                        <input id="stagecraft_import" type="file" accept="application/json">
                        <button id="stagecraft_export" class="menu_button">Export Pack</button>
                    </div>
                    <textarea id="stagecraft_pack_editor" spellcheck="false">${escapeHtml(JSON.stringify(settings.pack, null, 2))}</textarea>
                    <button id="stagecraft_apply_pack" class="menu_button">Apply Edited Pack</button>
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
        <div class="stagecraft-move-row" data-index="${index}">
            <select class="stagecraft_move_kind">
                ${['action', 'reward', 'punishment', 'test', 'repair', 'ritual', 'transition'].map(kind => `<option value="${kind}" ${move.kind === kind ? 'selected' : ''}>${kind}</option>`).join('')}
            </select>
            <input class="stagecraft_move_label" type="text" value="${escapeHtml(move.label || '')}" placeholder="Label">
            <textarea class="stagecraft_move_text" rows="2" spellcheck="true" placeholder="Move text">${escapeHtml(move.text || '')}</textarea>
            <input class="stagecraft_move_trigger" type="text" value="${escapeHtml(move.trigger || '')}" placeholder="Trigger">
            <input class="stagecraft_move_intensity" type="number" min="1" max="10" step="1" value="${escapeHtml(move.intensity || 1)}" title="Intensity">
            <input class="stagecraft_move_progress" type="number" min="-10" max="10" step="1" value="${escapeHtml(move.progress || 0)}" title="Progress">
            <button class="menu_button stagecraft_delete_move" type="button">Delete</button>
        </div>
    `).join('');

    return `
        <div class="stagecraft-stage-editor">
            <h4>Stage Editor</h4>
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
            <div id="stagecraft_move_rows">${moveRows}</div>
            <button id="stagecraft_save_stage" class="menu_button" type="button">Save Stage</button>
        </div>
    `;
}

function bindPanel() {
    const root = document.getElementById('stagecraft_panel');
    if (!root) return;

    root.querySelector('#stagecraft_enabled')?.addEventListener('change', event => {
        getSettings().enabled = event.target.checked;
        saveSettings();
    });
    root.querySelector('#stagecraft_lock')?.addEventListener('change', event => {
        getSettings().lockStage = event.target.checked;
        saveSettings();
    });
    root.querySelector('#stagecraft_markers')?.addEventListener('change', event => {
        getSettings().markerAutomation = event.target.checked;
        saveSettings();
    });
    root.querySelector('#stagecraft_lists')?.addEventListener('change', event => {
        getSettings().injectFullLists = event.target.checked;
        saveSettings();
    });
    root.querySelector('#stagecraft_display_stage')?.addEventListener('change', event => {
        getSettings().displayStage = event.target.checked;
        saveSettings();
        renderPanel();
    });
    root.querySelector('#stagecraft_display_roll')?.addEventListener('change', event => {
        getSettings().displayRoll = event.target.checked;
        saveSettings();
        renderPanel();
    });
    root.querySelector('#stagecraft_auto_advance')?.addEventListener('change', event => {
        getSettings().autoAdvanceEnabled = event.target.checked;
        saveSettings();
        renderPanel();
    });
    root.querySelector('#stagecraft_stage')?.addEventListener('change', event => setStage(event.target.value, 'selector'));
    root.querySelector('#stagecraft_add_move')?.addEventListener('click', () => {
        const stage = activeStage();
        stage.moves.push(normalizeMove('New move.', 'action'));
        saveSettings();
        renderPanel();
    });
    root.querySelectorAll('.stagecraft_delete_move').forEach(button => {
        button.addEventListener('click', event => {
            const row = event.target.closest('.stagecraft-move-row');
            const index = Number(row?.dataset?.index);
            const stage = activeStage();
            if (Number.isInteger(index)) {
                stage.moves.splice(index, 1);
                if (!stage.moves.length) stage.moves.push(normalizeMove('Define a stage action.', 'action'));
                saveSettings();
                renderPanel();
            }
        });
    });
    root.querySelector('#stagecraft_save_stage')?.addEventListener('click', () => {
        const stage = activeStage();
        stage.name = root.querySelector('#stagecraft_stage_name')?.value?.trim() || `Stage ${stage.id}`;
        stage.behavior = root.querySelector('#stagecraft_stage_behavior')?.value?.trim() || 'Describe the behavior for this stage.';
        stage.advanceThreshold = Math.max(1, Math.trunc(Number(root.querySelector('#stagecraft_stage_threshold')?.value) || 3));
        stage.advanceConditions = (root.querySelector('#stagecraft_stage_conditions')?.value || '')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);
        stage.moves = [...root.querySelectorAll('.stagecraft-move-row')].map(row => normalizeMove({
            kind: row.querySelector('.stagecraft_move_kind')?.value || 'action',
            label: row.querySelector('.stagecraft_move_label')?.value || '',
            text: row.querySelector('.stagecraft_move_text')?.value || '',
            trigger: row.querySelector('.stagecraft_move_trigger')?.value || '',
            intensity: row.querySelector('.stagecraft_move_intensity')?.value || 1,
            progress: row.querySelector('.stagecraft_move_progress')?.value || 0,
        }));
        migrateStageMoves(stage);
        saveSettings();
        renderPanel();
        globalThis.toastr?.success?.('Stage saved.', DISPLAY_NAME);
    });
    root.querySelector('#stagecraft_stage_count')?.addEventListener('change', event => {
        const settings = getSettings();
        resizePack(settings.pack, event.target.value);
        const state = getState();
        state.stage = normalizeStage(state.stage, settings.pack);
        saveSettings();
        void saveState();
        renderPanel();
    });
    root.querySelector('#stagecraft_chance')?.addEventListener('input', event => {
        getSettings().actionChance = Number(event.target.value);
        root.querySelector('#stagecraft_chance_value').textContent = String(event.target.value);
        saveSettings();
    });
    root.querySelector('#stagecraft_action_every')?.addEventListener('change', event => {
        getSettings().actionEveryTurns = Math.max(1, Math.trunc(Number(event.target.value) || 1));
        saveSettings();
    });
    root.querySelector('#stagecraft_auto_every')?.addEventListener('change', event => {
        getSettings().autoAdvanceEveryTurns = Math.max(1, Math.trunc(Number(event.target.value) || 1));
        saveSettings();
    });
    root.querySelector('#stagecraft_auto_chance')?.addEventListener('input', event => {
        getSettings().autoAdvanceChance = Number(event.target.value);
        root.querySelector('#stagecraft_auto_chance_value').textContent = String(event.target.value);
        saveSettings();
    });
    root.querySelector('#stagecraft_prev')?.addEventListener('click', () => regressStage());
    root.querySelector('#stagecraft_progress')?.addEventListener('click', () => addProgress(1));
    root.querySelector('#stagecraft_next')?.addEventListener('click', () => advanceStage('manual'));
    root.querySelector('#stagecraft_reset')?.addEventListener('click', () => resetState());
    root.querySelector('#stagecraft_gen_skeleton')?.addEventListener('click', () => void generatePackFromGoal(false));
    root.querySelector('#stagecraft_gen_pack')?.addEventListener('click', () => void generatePackFromGoal(true));
    root.querySelector('#stagecraft_gen_actions')?.addEventListener('click', () => void generateStageMoves('action'));
    root.querySelector('#stagecraft_gen_rewards')?.addEventListener('click', () => void generateStageMoves('reward'));
    root.querySelector('#stagecraft_gen_punishments')?.addEventListener('click', () => void generateStageMoves('punishment'));
    root.querySelector('#stagecraft_gen_conditions')?.addEventListener('click', () => void generateStageConditions());
    root.querySelector('#stagecraft_import')?.addEventListener('change', event => importPack(event.target.files?.[0]));
    root.querySelector('#stagecraft_export')?.addEventListener('click', () => exportPack());
    root.querySelector('#stagecraft_apply_pack')?.addEventListener('click', () => {
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
            globalThis.toastr?.error?.(error.message, DISPLAY_NAME);
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
    if (!ctx?.eventSource || !ctx?.event_types) return;

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
