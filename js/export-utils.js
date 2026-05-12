import { tr as _ } from './utils/i18n.js';

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
