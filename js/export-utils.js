import { tr as _ } from './utils/i18n.js';
import { generateUniqueId } from './utils.js';

function getModelDisplayName(modelId, elements) {
    if (!elements || !elements.chatModelSelection) return modelId;
    const option = elements.chatModelSelection.querySelector(`option[value="${modelId}"]`);
    return option ? option.textContent : modelId;
}

function createHeading(level, text) {
    const safeLevel = Math.min(Math.max(Number(level) || 1, 1), 6);
    return `${'#'.repeat(safeLevel)} ${text}`;
}

export function buildChatMarkdown(state, elements, currentTranslations, options = {}) {
    if (!state.chatHistory || state.chatHistory.length === 0) return '';

    const _tr = (key, rep = {}) => _(key, rep, currentTranslations);
    const headingOffset = Number.isFinite(options.headingOffset) ? options.headingOffset : 0;
    const messageHeadingLevel = Math.min(2 + headingOffset, 6);
    const responseHeadingShift = 2 + headingOffset;

    let markdown = '';

    state.chatHistory.forEach(message => {
        const { text, images } = extractPartsFromMessage(message);

        if (message.role === 'user') {
            const firstSentence = getFirstSentence(text);
            markdown += `${createHeading(messageHeadingLevel, firstSentence || _tr('userLabel'))}\n\n`;

            if (message.sentContextTabsInfo && message.sentContextTabsInfo.length > 0) {
                markdown += `**${_tr('contextPagesLabel')}:**\n`;
                message.sentContextTabsInfo.forEach((tab, index) => {
                    markdown += `${index + 1}. [${tab.title}](${tab.url || tab.id})\n`;
                });
                markdown += '\n';
            }

            if (images.length > 0) {
                images.forEach((img, index) => {
                    markdown += `[${_tr('imageAlt', { index: index + 1 })} - ${img.mimeType}]\n`;
                });
                markdown += '\n';
            }

            if (text) {
                markdown += `${text}\n\n`;
            }
        } else if (message.role === 'model') {
            if (message.multiModelResponses && Object.keys(message.multiModelResponses).length > 0) {
                Object.entries(message.multiModelResponses).forEach(([modelId, responseText]) => {
                    const modelName = getModelDisplayName(modelId, elements);
                    markdown += `${createHeading(messageHeadingLevel, modelName)}\n\n`;
                    if (responseText) {
                        const cleanedText = removeThinkingContent(responseText);
                        markdown += `${adjustMarkdownHeadingLevels(cleanedText, responseHeadingShift)}\n\n`;
                    }
                });
            } else {
                const modelName = getModelDisplayName(state.selectedModels?.[0] || '', elements) || _tr('appName');
                markdown += `${createHeading(messageHeadingLevel, modelName)}\n\n`;
                if (text) {
                    const cleanedText = removeThinkingContent(text);
                    markdown += `${adjustMarkdownHeadingLevels(cleanedText, responseHeadingShift)}\n\n`;
                }
            }
        }
    });

    return markdown;
}

export function buildChatText(state, elements, currentTranslations) {
    if (!state.chatHistory || state.chatHistory.length === 0) return '';

    const _tr = (key, rep = {}) => _(key, rep, currentTranslations);
    const locale = state.language?.toLowerCase() === 'zh-cn' ? 'zh-cn' : 'en';
    if (typeof dayjs !== 'undefined') dayjs.locale(locale);
    const timestamp = typeof dayjs !== 'undefined' ? dayjs().format('YYYY-MM-DD HH:mm:ss') : new Date().toLocaleString();

    let textContent = `${_tr('appName')} ${_tr('chatHistoryLabel')} (${timestamp})\n\n`;

    state.chatHistory.forEach(message => {
        const { text, images } = extractPartsFromMessage(message);

        if (message.role === 'user') {
            textContent += `--- ${_tr('userLabel')} ---\n`;

            if (message.sentContextTabsInfo && message.sentContextTabsInfo.length > 0) {
                textContent += `${_tr('contextPagesLabel')}:\n`;
                message.sentContextTabsInfo.forEach((tab, index) => {
                    textContent += `${index + 1}. ${tab.title}`;
                    if (tab.url) {
                        textContent += ` (${tab.url})`;
                    }
                    textContent += '\n';
                });
                textContent += '\n';
            }

            if (images.length > 0) {
                textContent += `[${_tr('containsNImages', { count: images.length })}]\n`;
            }

            if (text) {
                textContent += `${text}\n`;
            }
            textContent += '\n';
        } else if (message.role === 'model') {
            if (message.multiModelResponses && Object.keys(message.multiModelResponses).length > 0) {
                Object.entries(message.multiModelResponses).forEach(([modelId, responseText]) => {
                    const modelName = getModelDisplayName(modelId, elements);
                    textContent += `--- ${modelName} ---\n`;
                    if (responseText) {
                        const cleanedText = removeThinkingContent(responseText);
                        textContent += `${cleanedText}\n`;
                    }
                    textContent += '\n';
                });
            } else {
                const modelName = getModelDisplayName(state.selectedModels?.[0] || '', elements) || _tr('appName');
                textContent += `--- ${modelName} ---\n`;
                if (text) {
                    const cleanedText = removeThinkingContent(text);
                    textContent += `${cleanedText}\n`;
                }
                textContent += '\n';
            }
        }
    });

    return textContent;
}

export function extractPartsFromMessage(message) {
    let text = '';
    const images = [];
    if (message && message.parts && Array.isArray(message.parts)) {
        message.parts.forEach(part => {
            if (part.text) {
                text += (text ? '\n' : '') + part.text;
            } else if (part.inlineData && part.inlineData.data && part.inlineData.mimeType) {
                images.push({
                    dataUrl: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
                    mimeType: part.inlineData.mimeType
                });
            }
        });
    }
    return { text, images };
}

export function parseChatMarkdown(markdown, elements, currentTranslations) {
    if (!markdown || typeof markdown !== 'string') return [];

    const normalizedMarkdown = markdown.replace(/\r\n?/g, '\n');
    const messageSections = splitMarkdownMessageSections(normalizedMarkdown);
    if (messageSections.length === 0) return [];

    const userLabels = getUserLabels(currentTranslations);
    const modelLabels = getModelLabels(elements, currentTranslations);
    const chatHistory = [];
    let pendingMultiModelResponse = null;
    let expectingModelResponse = false;

    const flushMultiModelResponse = () => {
        if (!pendingMultiModelResponse) return;
        const modelOrder = [...pendingMultiModelResponse.modelOrder];
        const firstResponse = modelOrder
            .map(modelId => pendingMultiModelResponse.multiModelResponses[modelId])
            .find(response => response && response.trim());

        chatHistory.push({
            role: 'model',
            parts: [{ text: firstResponse || '' }],
            id: generateUniqueId(),
            multiModelResponses: { ...pendingMultiModelResponse.multiModelResponses },
            modelOrder
        });
        pendingMultiModelResponse = null;
    };

    messageSections.forEach(section => {
        const normalizedTitle = normalizeLabel(section.title);
        const explicitModelId = modelLabels.get(normalizedTitle);
        const content = cleanImportedMessageContent(section.content, currentTranslations);
        const isUserSection = userLabels.has(normalizedTitle)
            || (!explicitModelId && headingMatchesImportedContent(section.title, content));
        const modelId = explicitModelId
            || (!isUserSection && (expectingModelResponse || pendingMultiModelResponse) ? section.title : '');

        if (isUserSection || !modelId) {
            flushMultiModelResponse();
            if (!content) return;

            chatHistory.push({
                role: 'user',
                parts: [{ text: content }],
                id: generateUniqueId()
            });
            expectingModelResponse = true;
            return;
        }

        if (!pendingMultiModelResponse) {
            pendingMultiModelResponse = {
                multiModelResponses: {},
                modelOrder: []
            };
        }

        const restoredContent = restoreMarkdownHeadingLevels(content, 2);
        const uniqueModelId = getUniqueModelId(modelId, pendingMultiModelResponse.multiModelResponses);
        pendingMultiModelResponse.multiModelResponses[uniqueModelId] = restoredContent;
        pendingMultiModelResponse.modelOrder.push(uniqueModelId);
        expectingModelResponse = false;
    });

    flushMultiModelResponse();
    return chatHistory;
}

export function removeThinkingContent(text) {
    if (!text) return text;
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

export function adjustMarkdownHeadingLevels(text, levels = 2) {
    if (!text) return text;

    return text.replace(/^(#{1,6})\s/gm, (match, hashes) => {
        const currentLevel = hashes.length;
        const newLevel = Math.min(currentLevel + levels, 6);
        return '#'.repeat(newLevel) + ' ';
    });
}

export function restoreMarkdownHeadingLevels(text, levels = 2) {
    if (!text) return text;

    return text.replace(/^(#{1,6})\s/gm, (match, hashes) => {
        const currentLevel = hashes.length;
        const newLevel = Math.max(currentLevel - levels, 1);
        return '#'.repeat(newLevel) + ' ';
    });
}

function getFirstSentence(text, maxLength = 50) {
    if (!text) return '';

    const firstLine = text.trim().split('\n')[0].trim();
    const sentenceMatch = firstLine.match(/^[^。？！.?!]+[。？！.?!]?/);
    let sentence = sentenceMatch ? sentenceMatch[0].trim() : firstLine;

    if (sentence.length > maxLength) {
        sentence = sentence.substring(0, maxLength) + '...';
    }

    return sentence;
}

function splitMarkdownMessageSections(markdown) {
    const lines = markdown.split('\n');
    const sections = [];
    let currentSection = null;

    lines.forEach(line => {
        const headingMatch = line.match(/^(#{2})\s+(.+?)\s*#*\s*$/);
        if (headingMatch) {
            if (currentSection) {
                sections.push({
                    title: currentSection.title,
                    content: currentSection.lines.join('\n').trim()
                });
            }
            currentSection = {
                title: headingMatch[2].trim(),
                lines: []
            };
            return;
        }

        if (currentSection) {
            currentSection.lines.push(line);
        }
    });

    if (currentSection) {
        sections.push({
            title: currentSection.title,
            content: currentSection.lines.join('\n').trim()
        });
    }

    return sections;
}

function getUserLabels(currentTranslations) {
    return new Set([
        normalizeLabel(_('userLabel', {}, currentTranslations)),
        normalizeLabel('我'),
        normalizeLabel('Me')
    ]);
}

function getModelLabels(elements, currentTranslations) {
    const labels = new Map();

    if (elements?.chatModelSelection) {
        elements.chatModelSelection.querySelectorAll('option').forEach(option => {
            if (option.value && option.textContent) {
                labels.set(normalizeLabel(option.textContent), option.value);
                labels.set(normalizeLabel(option.value), option.value);
            }
        });
    }

    const selectedModel = elements?.chatModelSelection?.value || '';
    if (selectedModel) {
        labels.set(normalizeLabel(_('appName', {}, currentTranslations)), selectedModel);
        labels.set(normalizeLabel('PageTalk'), selectedModel);
    }

    return labels;
}

function normalizeLabel(label) {
    return (label || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function headingMatchesImportedContent(heading, content) {
    const normalizedHeading = normalizeLabel(heading).replace(/\.\.\.$/, '');
    const firstSentence = normalizeLabel(getFirstSentence(content)).replace(/\.\.\.$/, '');
    const firstLine = normalizeLabel((content || '').trim().split('\n')[0] || '');

    if (!normalizedHeading || !firstSentence) return false;
    return normalizedHeading === firstSentence || firstLine.startsWith(normalizedHeading);
}

function cleanImportedMessageContent(content, currentTranslations) {
    const contextLabel = escapeRegExp(_('contextPagesLabel', {}, currentTranslations));
    const fallbackContextLabels = ['标签页', 'Tabs']
        .map(escapeRegExp)
        .join('|');
    const contextBlockRe = new RegExp(
        `^\\*\\*(?:${contextLabel}|${fallbackContextLabels}):\\*\\*\\n(?:\\d+\\.\\s+\\[[^\\]]+\\]\\([^\\n]+\\)\\n?)+\\n*`,
        'i'
    );

    return (content || '')
        .replace(contextBlockRe, '')
        .replace(/^\[[^\]\n]+ - image\/[^\]\n]+\]\n*/gim, '')
        .trim();
}

function getUniqueModelId(modelId, responses) {
    if (!Object.prototype.hasOwnProperty.call(responses, modelId)) return modelId;

    let index = 2;
    let nextModelId = `${modelId}#${index}`;
    while (Object.prototype.hasOwnProperty.call(responses, nextModelId)) {
        index += 1;
        nextModelId = `${modelId}#${index}`;
    }
    return nextModelId;
}

function escapeRegExp(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
