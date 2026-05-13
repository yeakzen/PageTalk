import { generateUniqueId } from './utils.js';
import { tr as _ } from './utils/i18n.js';
import { getPageContextTextForPrompt, sanitizeContextTextForPrompt } from './context-state.js';
import { extractPartsFromMessage } from './export-utils.js';

export const DEFAULT_FOLLOW_UP_QUESTION_SETTINGS = Object.freeze({
    enabled: false,
    model: '',
    prompt: ''
});

const FOLLOW_UP_STATUS = Object.freeze({
    GENERATING: 'generating',
    READY: 'ready',
    ERROR: 'error'
});

function getDefaultFollowUpPrompt(currentTranslations = {}) {
    return currentTranslations.followUpQuestionsSystemPrompt || '';
}

export function normalizeFollowUpQuestionSettings(rawSettings = {}, currentTranslations = {}) {
    const sourceSettings = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
    const defaults = {
        ...DEFAULT_FOLLOW_UP_QUESTION_SETTINGS,
        prompt: getDefaultFollowUpPrompt(currentTranslations)
    };

    return {
        enabled: typeof sourceSettings.enabled === 'boolean' ? sourceSettings.enabled : defaults.enabled,
        model: typeof sourceSettings.model === 'string' ? sourceSettings.model : defaults.model,
        prompt: typeof sourceSettings.prompt === 'string' && sourceSettings.prompt.trim()
            ? sourceSettings.prompt
            : defaults.prompt
    };
}

export function applyFollowUpQuestionSettingsToElements(settings, elements) {
    if (elements.followUpQuestionsEnabledToggle) {
        elements.followUpQuestionsEnabledToggle.checked = Boolean(settings.enabled);
    }
    if (elements.followUpQuestionsModelSelect) {
        renderCurrentFollowUpModelOption(elements.followUpQuestionsModelSelect, settings.model);
    }
    if (elements.followUpQuestionsPromptTextarea) {
        elements.followUpQuestionsPromptTextarea.value = settings.prompt || '';
    }
}

export function readFollowUpQuestionSettingsFromElements(elements, currentTranslations = {}) {
    return normalizeFollowUpQuestionSettings({
        enabled: Boolean(elements.followUpQuestionsEnabledToggle?.checked),
        model: elements.followUpQuestionsModelSelect?.value?.trim() || '',
        prompt: elements.followUpQuestionsPromptTextarea?.value ?? ''
    }, currentTranslations);
}

export function saveFollowUpQuestionSettings(settings) {
    return chrome.storage.sync.set({ followUpQuestionSettings: settings });
}

export function renderCurrentFollowUpModelOption(selectElement, modelValue) {
    if (!selectElement) return;
    selectElement.innerHTML = '';

    const optionElement = document.createElement('option');
    optionElement.value = modelValue || '';
    optionElement.textContent = createModelSelectLabel(modelValue) || '';
    optionElement.selected = true;
    selectElement.appendChild(optionElement);
    selectElement.value = modelValue || '';
    selectElement.dataset.modelsLoaded = 'false';
}

export function populateFollowUpModelSelectOptions(selectElement, modelOptions, selectedValue, state) {
    if (!selectElement) return;
    selectElement.innerHTML = '';

    const modelsByProvider = {};
    modelOptions.forEach(option => {
        const providerId = option.providerId || 'unknown';
        const providerName = option.providerName || 'Unknown';

        if (!modelsByProvider[providerId]) {
            modelsByProvider[providerId] = {
                name: providerName,
                models: []
            };
        }
        modelsByProvider[providerId].models.push(option);
    });

    Object.entries(modelsByProvider)
        .sort(([, a], [, b]) => a.name.localeCompare(b.name))
        .forEach(([providerId, providerData]) => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = providerData.name;
            optgroup.setAttribute('data-provider-id', providerId);

            providerData.models
                .sort((a, b) => a.text.localeCompare(b.text))
                .forEach(option => {
                    const optionElement = document.createElement('option');
                    optionElement.value = option.value;
                    optionElement.textContent = option.text;
                    if (option.disabled) {
                        optionElement.disabled = true;
                    }
                    optionElement.setAttribute('data-provider-id', option.providerId || '');
                    optionElement.setAttribute('data-provider-name', option.providerName || '');
                    optgroup.appendChild(optionElement);
                });

            selectElement.appendChild(optgroup);
        });

    const nextValue = selectedValue && modelOptions.some(o => o.value === selectedValue)
        ? selectedValue
        : (modelOptions[0]?.value || '');
    selectElement.value = nextValue;
    selectElement.dataset.modelsLoaded = 'true';

    if (state) {
        state.followUpQuestionSettings = normalizeFollowUpQuestionSettings({
            ...state.followUpQuestionSettings,
            model: nextValue
        });
    }
}

export function initFollowUpQuestionState(state) {
    if (!state.followUpQuestionsByResponseId) {
        state.followUpQuestionsByResponseId = {};
    }
}

export function clearFollowUpQuestions(state, elements) {
    state.followUpQuestionsByResponseId = {};
    elements.chatMessages?.querySelectorAll('.follow-up-questions').forEach(node => node.remove());
}

export function removeFollowUpQuestionsForMessageIds(messageIds, state, elements) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) return;
    const idSet = new Set(messageIds.filter(Boolean));

    Object.entries(state.followUpQuestionsByResponseId || {}).forEach(([responseId, item]) => {
        if (idSet.has(responseId) || idSet.has(item?.sourceUserMessageId) || idSet.has(item?.sourceResponseMessageId)) {
            delete state.followUpQuestionsByResponseId[responseId];
        }
    });

    idSet.forEach(messageId => {
        elements.chatMessages
            ?.querySelectorAll(`.follow-up-questions[data-response-message-id="${cssEscape(messageId)}"]`)
            .forEach(node => node.remove());
    });
}

export function rebindFollowUpQuestionsForResponse({
    oldResponseMessageIds = [],
    newResponseMessageId = '',
    state,
    elements,
    currentTranslations,
    sendMessage
}) {
    if (!state || !newResponseMessageId) return;
    initFollowUpQuestionState(state);

    const oldIds = (Array.isArray(oldResponseMessageIds) ? oldResponseMessageIds : [oldResponseMessageIds])
        .filter(Boolean);
    if (oldIds.length === 0) return;

    const oldIdSet = new Set(oldIds);
    const entries = state.followUpQuestionsByResponseId || {};
    const matchingKey = oldIds.find(id => entries[id])
        || Object.entries(entries).find(([, entry]) => oldIdSet.has(entry?.sourceResponseMessageId))?.[0];
    if (!matchingKey || !entries[matchingKey]) return;

    const reboundEntry = {
        ...entries[matchingKey],
        sourceResponseMessageId: newResponseMessageId
    };

    [...oldIdSet, matchingKey].forEach(id => {
        if (id !== newResponseMessageId) {
            delete entries[id];
        }
    });
    entries[newResponseMessageId] = reboundEntry;

    const containerIds = [...new Set([...oldIds, matchingKey])];
    let keptContainer = null;
    containerIds.forEach(id => {
        elements.chatMessages
            ?.querySelectorAll(`.follow-up-questions[data-response-message-id="${cssEscape(id)}"]`)
            .forEach(node => {
                if (!keptContainer) {
                    keptContainer = node;
                    keptContainer.dataset.responseMessageId = newResponseMessageId;
                } else {
                    node.remove();
                }
            });
    });

    const anchor = findResponseAnchor(newResponseMessageId, elements);
    if (anchor && keptContainer) {
        anchor.insertAdjacentElement('afterend', keptContainer);
    }

    renderFollowUpQuestions(newResponseMessageId, state, elements, currentTranslations, sendMessage);
}

export async function generateFollowUpQuestionsForResponse({
    state,
    elements,
    currentTranslations,
    responseMessageId,
    sourceUserMessageId = '',
    sendMessage,
    force = false
}) {
    initFollowUpQuestionState(state);

    const settings = normalizeFollowUpQuestionSettings(state.followUpQuestionSettings, currentTranslations);
    if (!settings.enabled || !settings.model || !settings.prompt) {
        return;
    }
    if (!responseMessageId) {
        return;
    }

    const responseMessage = findMessageById(state.chatHistory, responseMessageId);
    if (!responseMessage || responseMessage.role !== 'model') {
        return;
    }
    if (!extractResponseText(responseMessage, true).trim()) {
        return;
    }

    const userMessage = sourceUserMessageId
        ? findMessageById(state.chatHistory, sourceUserMessageId)
        : findPreviousUserMessage(state.chatHistory, responseMessageId);

    if (!userMessage || userMessage.role !== 'user') {
        return;
    }

    if (!force && state.followUpQuestionsByResponseId?.[responseMessageId]?.status === FOLLOW_UP_STATUS.READY) {
        return;
    }

    const existing = state.followUpQuestionsByResponseId[responseMessageId];
    const existingQuestions = force ? (existing?.questions || []) : [];
    const entry = {
        status: FOLLOW_UP_STATUS.GENERATING,
        sourceUserMessageId: userMessage.id,
        sourceResponseMessageId: responseMessage.id,
        questions: existingQuestions,
        generatorModel: settings.model,
        promptSnapshot: settings.prompt,
        generatedAt: existing?.generatedAt || 0,
        errorMessage: ''
    };
    state.followUpQuestionsByResponseId[responseMessageId] = entry;
    renderFollowUpQuestions(responseMessageId, state, elements, currentTranslations, sendMessage);

    try {
        const messages = [
            {
                role: 'system',
                content: settings.prompt
            },
            {
                role: 'user',
                content: buildFollowUpPromptPayload({
                    state,
                    userMessage,
                    responseMessage,
                    currentTranslations
                })
            }
        ];

        const rawResponse = await callTextModelOnce(settings.model, messages);
        const questions = parseFollowUpQuestions(rawResponse);
        if (questions.length === 0) {
            throw new Error(_('followUpQuestionsEmptyResponse', {}, currentTranslations));
        }

        state.followUpQuestionsByResponseId[responseMessageId] = {
            ...entry,
            status: FOLLOW_UP_STATUS.READY,
            questions: questions.map(text => ({ id: generateUniqueId(), text, used: false })),
            generatedAt: Date.now(),
            errorMessage: ''
        };
    } catch (error) {
        console.error('[FollowUpQuestions] Failed to generate:', error);
        state.followUpQuestionsByResponseId[responseMessageId] = {
            ...entry,
            status: FOLLOW_UP_STATUS.ERROR,
            errorMessage: error.message || String(error),
            questions: existingQuestions
        };
    }

    renderFollowUpQuestions(responseMessageId, state, elements, currentTranslations, sendMessage);
}

export function renderFollowUpQuestions(responseMessageId, state, elements, currentTranslations, sendMessage) {
    const entry = state.followUpQuestionsByResponseId?.[responseMessageId];
    if (!entry) return;

    const anchor = findResponseAnchor(responseMessageId, elements);
    if (!anchor) return;

    let container = elements.chatMessages?.querySelector(`.follow-up-questions[data-response-message-id="${cssEscape(responseMessageId)}"]`);
    if (!container) {
        container = document.createElement('div');
        container.className = 'follow-up-questions';
        container.dataset.responseMessageId = responseMessageId;
        anchor.insertAdjacentElement('afterend', container);
    }

    container.replaceChildren();

    const header = document.createElement('div');
    header.className = 'follow-up-questions-header';

    const title = document.createElement('span');
    title.className = 'follow-up-questions-title';
    title.textContent = _('followUpQuestionsTitle', {}, currentTranslations);
    header.appendChild(title);

    const refreshButton = document.createElement('button');
    refreshButton.type = 'button';
    refreshButton.className = 'follow-up-refresh-btn';
    if (entry.status === FOLLOW_UP_STATUS.GENERATING) {
        refreshButton.classList.add('is-generating');
    }
    const refreshLabel = entry.status === FOLLOW_UP_STATUS.GENERATING
        ? _('followUpQuestionsGenerating', {}, currentTranslations)
        : _('followUpQuestionsRefresh', {}, currentTranslations);
    refreshButton.title = refreshLabel;
    refreshButton.setAttribute('aria-label', refreshLabel);
    refreshButton.innerHTML = '<i data-lucide="refresh-cw" aria-hidden="true"></i>';
    refreshButton.disabled = entry.status === FOLLOW_UP_STATUS.GENERATING;
    refreshButton.addEventListener('click', () => {
        void generateFollowUpQuestionsForResponse({
            state,
            elements,
            currentTranslations,
            responseMessageId,
            sourceUserMessageId: entry.sourceUserMessageId,
            sendMessage,
            force: true
        });
    });
    header.appendChild(refreshButton);
    container.appendChild(header);
    if (window.lucide?.createIcons) {
        window.lucide.createIcons();
    }

    if (entry.status === FOLLOW_UP_STATUS.GENERATING && entry.questions.length === 0) {
        const loading = document.createElement('div');
        loading.className = 'follow-up-questions-status';
        loading.textContent = _('followUpQuestionsGenerating', {}, currentTranslations);
        container.appendChild(loading);
        return;
    }

    if (entry.status === FOLLOW_UP_STATUS.ERROR) {
        const error = document.createElement('div');
        error.className = 'follow-up-questions-error';
        error.textContent = _('followUpQuestionsError', { error: entry.errorMessage || _('error', {}, currentTranslations) }, currentTranslations);
        container.appendChild(error);
    }

    if (entry.questions.length > 0) {
        const list = document.createElement('div');
        list.className = 'follow-up-questions-list';

        entry.questions.forEach(question => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'follow-up-question-btn';
            if (question.used) {
                button.classList.add('used');
                button.disabled = true;
            }
            button.textContent = question.text;
            button.addEventListener('click', () => {
                if (question.used) return;
                question.used = true;
                button.classList.add('used');
                button.disabled = true;
                if (typeof sendMessage === 'function') {
                    sendMessage(question.text);
                }
            });
            list.appendChild(button);
        });

        container.appendChild(list);
    }
}

function buildFollowUpPromptPayload({ state, userMessage, responseMessage, currentTranslations = {} }) {
    const pageContext = getPageContextTextForPrompt(state) || '';
    const currentQuestion = extractPartsFromMessage(userMessage).text || '';
    const currentAnswer = extractResponseText(responseMessage, true);
    const additionalWebContext = buildAdditionalWebContextText(userMessage, state);
    const fullConversation = buildFullConversationText(state.chatHistory || [], currentTranslations);
    const fullChatHistoryJson = JSON.stringify(cleanChatHistoryForFollowUpPrompt(state.chatHistory || [], state), null, 2);

    return [
        `UI language: ${state.language || currentTranslations?.htmlLang || 'en'}`,
        '',
        '# Current Page Context',
        pageContext || '(empty)',
        '',
        '# Current Turn Additional Web Context',
        additionalWebContext || '(empty)',
        '',
        '# Current User Question',
        currentQuestion || '(empty)',
        '',
        '# Current Answer',
        currentAnswer || '(empty)',
        '',
        '# Full Conversation',
        fullConversation || '(empty)',
        '',
        '# Full state.chatHistory JSON',
        fullChatHistoryJson || '[]'
    ].join('\n');
}

function buildAdditionalWebContextText(userMessage, state) {
    const sentTabs = Array.isArray(userMessage?.sentContextTabsInfo)
        ? userMessage.sentContextTabsInfo
        : [];

    return sentTabs
        .map((tab, index) => {
            const title = tab?.title || `Page ${index + 1}`;
            const content = sanitizeContextTextForPrompt(tab?.content || '', state);
            return [
                `## ${title}`,
                content || '(empty)'
            ].filter(Boolean).join('\n');
        })
        .join('\n\n');
}

function cleanChatHistoryForFollowUpPrompt(chatHistory, state) {
    return chatHistory.map(message => {
        if (!message || typeof message !== 'object') return message;
        const cleanedMessage = {
            ...message,
            parts: cleanMessagePartsForFollowUp(message.parts)
        };

        if (message.role === 'model' && message.multiModelResponses && typeof message.multiModelResponses === 'object') {
            cleanedMessage.multiModelResponses = Object.fromEntries(
                Object.entries(message.multiModelResponses).map(([modelId, responseText]) => [
                    modelId,
                    removeThinkingContent(responseText || '')
                ])
            );
        }

        if (message.role === 'user' && Array.isArray(message.sentContextTabsInfo)) {
            cleanedMessage.sentContextTabsInfo = message.sentContextTabsInfo.map(tab => {
                const { url, ...tabWithoutUrl } = tab || {};
                return {
                    ...tabWithoutUrl,
                    content: sanitizeContextTextForPrompt(tab?.content || '', state)
                };
            });
        }

        return cleanedMessage;
    });
}

function cleanMessagePartsForFollowUp(parts) {
    if (!Array.isArray(parts)) return parts;
    return parts.map(part => {
        if (!part || typeof part !== 'object' || typeof part.text !== 'string') {
            return part;
        }
        return {
            ...part,
            text: removeThinkingContent(part.text)
        };
    });
}

function buildFullConversationText(chatHistory, currentTranslations = {}) {
    return chatHistory.map(message => {
        if (message.role === 'user') {
            const text = extractPartsFromMessage(message).text || '';
            return `User:\n${text}`;
        }

        if (message.role === 'model') {
            return `Assistant:\n${extractResponseText(message, true)}`;
        }

        return '';
    }).filter(Boolean).join('\n\n');
}

function extractResponseText(message, includeAllModels = false) {
    if (includeAllModels && message?.multiModelResponses && Object.keys(message.multiModelResponses).length > 0) {
        const orderedModelIds = message.modelOrder || Object.keys(message.multiModelResponses);
        return orderedModelIds
            .filter(modelId => message.multiModelResponses[modelId] !== undefined)
            .map(modelId => `## ${modelId}\n${removeThinkingContent(message.multiModelResponses[modelId] || '')}`)
            .join('\n\n');
    }

    return removeThinkingContent(extractPartsFromMessage(message).text || '');
}

function removeThinkingContent(text) {
    return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function parseFollowUpQuestions(rawResponse) {
    const responseText = String(rawResponse || '').trim();
    const parsedQuestions = parseQuestionsFromJson(responseText);
    const questions = parsedQuestions.length > 0
        ? parsedQuestions
        : parseQuestionsFromList(responseText);

    const seen = new Set();
    return questions
        .map(question => String(question || '').trim())
        .map(question => question.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim())
        .filter(question => question.length > 0)
        .filter(question => {
            const normalized = question.replace(/\s+/g, ' ').toLowerCase();
            if (seen.has(normalized)) return false;
            seen.add(normalized);
            return true;
        });
}

function parseQuestionsFromJson(text) {
    const jsonCandidate = extractJsonObject(text);
    if (!jsonCandidate) return [];

    try {
        const parsed = JSON.parse(jsonCandidate);
        if (Array.isArray(parsed)) return parsed;
        if (Array.isArray(parsed?.questions)) return parsed.questions;
        if (Array.isArray(parsed?.followUps)) return parsed.followUps;
        if (Array.isArray(parsed?.follow_up_questions)) return parsed.follow_up_questions;
    } catch (error) {
        console.warn('[FollowUpQuestions] Failed to parse JSON:', error);
    }

    return [];
}

function parseQuestionsFromList(text) {
    return String(text || '')
        .split(/\n+/)
        .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)、]|[一二三四五六七八九十]+[、.])\s*/, '').trim())
        .filter(Boolean);
}

function extractJsonObject(text) {
    const cleanText = String(text || '').trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

    if (!cleanText) return '';
    if (cleanText.startsWith('{') && cleanText.endsWith('}')) return cleanText;
    if (cleanText.startsWith('[') && cleanText.endsWith(']')) return cleanText;

    const objectStart = cleanText.indexOf('{');
    const objectEnd = cleanText.lastIndexOf('}');
    if (objectStart !== -1 && objectEnd > objectStart) {
        return cleanText.slice(objectStart, objectEnd + 1);
    }

    const arrayStart = cleanText.indexOf('[');
    const arrayEnd = cleanText.lastIndexOf(']');
    if (arrayStart !== -1 && arrayEnd > arrayStart) {
        return cleanText.slice(arrayStart, arrayEnd + 1);
    }

    return '';
}

async function callTextModelOnce(modelId, messages) {
    if (!window.PageTalkAPI?.callApi) {
        throw new Error('PageTalkAPI is not available');
    }

    let accumulatedText = '';
    await window.PageTalkAPI.callApi(modelId, messages, (chunk) => {
        accumulatedText += chunk || '';
    }, {});
    return accumulatedText.trim();
}

function findResponseAnchor(responseMessageId, elements) {
    if (!elements.chatMessages) return null;
    return elements.chatMessages.querySelector(`.multi-model-response-container[data-message-id="${cssEscape(responseMessageId)}"]`)
        || elements.chatMessages.querySelector(`.message.bot-message[data-message-id="${cssEscape(responseMessageId)}"]`);
}

function findMessageById(chatHistory = [], messageId) {
    return chatHistory.find(message => message?.id === messageId) || null;
}

function findPreviousUserMessage(chatHistory = [], responseMessageId) {
    const responseIndex = chatHistory.findIndex(message => message?.id === responseMessageId);
    if (responseIndex <= 0) return null;

    for (let index = responseIndex - 1; index >= 0; index -= 1) {
        if (chatHistory[index]?.role === 'user') {
            return chatHistory[index];
        }
    }

    return null;
}

function createModelSelectLabel(modelValue) {
    if (!modelValue) return '';
    const [, modelName = modelValue] = modelValue.split('::');
    return modelName;
}

function cssEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(String(value));
    return String(value).replace(/["\\]/g, '\\$&');
}
