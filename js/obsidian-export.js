import { tr as _ } from './utils/i18n.js';
import { buildChatMarkdown } from './export-utils.js';
import { getPageContextStatus, getPageContextTextForPrompt } from './context-state.js';

const LEGACY_DEFAULT_FRONTMATTER_TEMPLATE = [
    'title: {{title|yaml}}',
    '{% if url %}source: {{url|yaml}}{% endif %}',
    'created: {{isoDatetime|yaml}}',
    'tool: PageTalk',
    'tags:',
    '  - pagetalk',
    '  - pagetalk-export'
].join('\n');

const DEFAULT_FRONTMATTER_TEMPLATE = [
    'title: {{title|yaml}}',
    '{% if url %}source: {{url|yaml}}{% endif %}',
    '{% if author %}author: {{author|yaml}}{% endif %}',
    '{% if published %}published: {{published|yaml}}{% endif %}',
    'created: {{isoDatetime|yaml}}',
    'tool: PageTalk',
    '{% if aiCategory %}category: {{aiCategory|yaml}}{% endif %}',
    'tags:',
    '  - pagetalk',
    '  - pagetalk-export',
    '{% for tag in aiTags %}  - {{tag|yaml}}',
    '{% endfor %}'
].join('\n');

const LEGACY_DEFAULT_BODY_TEMPLATE = [
    '{{content}}',
    '{% if comments %}',
    '',
    '## Comments / Replies',
    '',
    '{{comments}}',
    '{% endif %}',
    '{% if manualArea %}',
    '',
    '## Manually Selected Page Area',
    '',
    '{{manualArea}}',
    '{% endif %}',
    '{% if not context %}',
    '{{contextFallback}}',
    '{% endif %}',
    '{% if chat %}',
    '',
    '# Chat',
    '',
    '{{chat}}',
    '{% endif %}'
].join('\n');

const DEFAULT_BODY_TEMPLATE = [
    '{% if aiSummary %}',
    '# AI Summary',
    '',
    '{{aiSummary}}',
    '',
    '{% endif %}',
    '{{content}}',
    '{% if comments %}',
    '',
    '## Comments / Replies',
    '',
    '{{comments}}',
    '{% endif %}',
    '{% if manualArea %}',
    '',
    '## Manually Selected Page Area',
    '',
    '{{manualArea}}',
    '{% endif %}',
    '{% if not context %}',
    '{{contextFallback}}',
    '{% endif %}',
    '{% if chat %}',
    '',
    '# Chat',
    '',
    '{{chat}}',
    '{% endif %}'
].join('\n');

const DEFAULT_OBSIDIAN_AI_PROMPT = [
    'You are PageTalk\'s Obsidian note organizer.',
    'Generate an AI summary, automatic tags, and an automatic category from the exported page context and chat history.',
    'Return one JSON object only. Do not include Markdown code fences or explanations.',
    'Schema: {"summary":"...","tags":["tag-one","tag-two"],"category":"..."}',
    'The summary must be one concise plain-text sentence. Do not use Markdown.',
    'Tags must not include "#"; keep them short; use hyphens instead of spaces; return at most 8 tags.',
    'The category should be a short topic or path, for example "AI/Agents" or "Reading/Product".'
].join('\n');

const OBSIDIAN_AI_MAX_SECTION_CHARS = 16000;

export const DEFAULT_OBSIDIAN_EXPORT_SETTINGS = Object.freeze({
    vault: '',
    folder: 'PageTalk',
    noteNameTemplate: 'PageTalk - {{title|safe_name}} - {{date}}',
    frontmatterTemplate: DEFAULT_FRONTMATTER_TEMPLATE,
    bodyTemplate: DEFAULT_BODY_TEMPLATE,
    silentOpen: false,
    aiEnabled: false,
    aiModel: '',
    aiPrompt: ''
});

const CONTENT_URI_FALLBACK_LIMIT = 1800;

export function getDefaultObsidianAiPrompt(currentTranslations = {}) {
    return currentTranslations?.obsidianAiSystemPrompt || DEFAULT_OBSIDIAN_AI_PROMPT;
}

export function normalizeObsidianExportSettings(rawSettings = {}, currentTranslations = {}) {
    const sourceSettings = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
    const hasFrontmatterTemplate = typeof sourceSettings.frontmatterTemplate === 'string';
    const hasBodyTemplate = typeof sourceSettings.bodyTemplate === 'string';
    const rawFrontmatterTemplate = hasFrontmatterTemplate ? sourceSettings.frontmatterTemplate : DEFAULT_OBSIDIAN_EXPORT_SETTINGS.frontmatterTemplate;
    const rawBodyTemplate = hasBodyTemplate ? sourceSettings.bodyTemplate : DEFAULT_OBSIDIAN_EXPORT_SETTINGS.bodyTemplate;
    const frontmatterTemplate = hasFrontmatterTemplate && rawFrontmatterTemplate === LEGACY_DEFAULT_FRONTMATTER_TEMPLATE
        ? DEFAULT_OBSIDIAN_EXPORT_SETTINGS.frontmatterTemplate
        : rawFrontmatterTemplate;
    const bodyTemplate = hasBodyTemplate && rawBodyTemplate === LEGACY_DEFAULT_BODY_TEMPLATE
        ? DEFAULT_OBSIDIAN_EXPORT_SETTINGS.bodyTemplate
        : rawBodyTemplate;

    return {
        vault: typeof sourceSettings.vault === 'string' ? sourceSettings.vault : DEFAULT_OBSIDIAN_EXPORT_SETTINGS.vault,
        folder: typeof sourceSettings.folder === 'string' ? sourceSettings.folder : DEFAULT_OBSIDIAN_EXPORT_SETTINGS.folder,
        noteNameTemplate: typeof sourceSettings.noteNameTemplate === 'string' && sourceSettings.noteNameTemplate.trim()
            ? sourceSettings.noteNameTemplate
            : DEFAULT_OBSIDIAN_EXPORT_SETTINGS.noteNameTemplate,
        frontmatterTemplate,
        bodyTemplate,
        silentOpen: sourceSettings.silentOpen === true,
        aiEnabled: sourceSettings.aiEnabled === true,
        aiModel: typeof sourceSettings.aiModel === 'string' ? sourceSettings.aiModel : DEFAULT_OBSIDIAN_EXPORT_SETTINGS.aiModel,
        aiPrompt: typeof sourceSettings.aiPrompt === 'string' && sourceSettings.aiPrompt.trim()
            ? sourceSettings.aiPrompt
            : getDefaultObsidianAiPrompt(currentTranslations)
    };
}

export async function handleExportToObsidian(state, elements, showToastCallback, currentTranslations) {
    const settings = readObsidianExportSettingsFromElements(elements, state, currentTranslations);
    state.obsidianExportSettings = settings;

    try {
        if (getPageContextStatus(state.pageContext) === 'extracting') {
            showToastCallback(_('obsidianContextExtracting', {}, currentTranslations), 'info');
            return;
        }

        let variables = buildObsidianTemplateVariables(state, elements, currentTranslations);
        if (!variables.context && !variables.chat && getPageContextStatus(state.pageContext) !== 'failed') {
            showToastCallback(_('obsidianExportEmptyError', {}, currentTranslations), 'error');
            return;
        }

        if (settings.aiEnabled) {
            if (!settings.aiModel) {
                throw new Error(_('obsidianAiMissingModel', {}, currentTranslations));
            }
            showToastCallback(_('obsidianAiGenerating', {}, currentTranslations), 'info');
            variables = {
                ...variables,
                ...await generateObsidianAiMetadata(settings, variables, currentTranslations)
            };
        }

        const markdown = buildObsidianExportMarkdown(state, elements, currentTranslations, settings, variables);

        if (!markdown.trim()) {
            showToastCallback(_('obsidianExportEmptyError', {}, currentTranslations), 'error');
            return;
        }

        void saveObsidianExportSettings(settings).catch(error => {
            console.warn('[ObsidianExport] Failed to save settings before export:', error);
        });

        const noteName = renderNoteNameTemplate(settings.noteNameTemplate, state, variables);
        await exportMarkdownToObsidian(markdown, {
            noteName,
            folder: settings.folder,
            vault: settings.vault,
            silentOpen: settings.silentOpen
        }, currentTranslations);

        showToastCallback(_('obsidianExportSuccess', {}, currentTranslations), 'success');
    } catch (error) {
        console.error('[ObsidianExport] Export failed:', error);
        showToastCallback(_('obsidianExportError', { error: error.message || String(error) }, currentTranslations), 'error');
    }
}

export function buildObsidianExportMarkdown(state, elements, currentTranslations, settings = DEFAULT_OBSIDIAN_EXPORT_SETTINGS, templateVariables = null) {
    const contextStatus = getPageContextStatus(state.pageContext);
    const variables = templateVariables || buildObsidianTemplateVariables(state, elements, currentTranslations);

    if (!variables.context && !variables.chat && contextStatus !== 'failed') {
        return '';
    }

    const frontmatter = compileObsidianTemplate(settings.frontmatterTemplate, variables).trim();
    const body = compileObsidianTemplate(settings.bodyTemplate, variables).trim();
    const parts = [];
    if (frontmatter) {
        parts.push('---', frontmatter, '---');
    }
    if (body) parts.push(body);

    return `${parts.join('\n').replace(/\n{4,}/g, '\n\n\n').trim()}\n`;
}

export function buildObsidianUrl(options) {
    const noteName = sanitizeObsidianFileName(options.noteName || '');
    const fallbackNoteName = noteName || `PageTalk Export ${formatDateToken(new Date())}`;
    const folder = sanitizeObsidianFolder(options.folder || '');
    const path = folder ? `${folder}/${fallbackNoteName}` : fallbackNoteName;

    const params = [`file=${encodeURIComponent(path)}`];
    if (options.vault) params.push(`vault=${encodeURIComponent(options.vault)}`);
    if (options.silentOpen) params.push('silent=true');
    if (options.useClipboard) {
        params.push('clipboard');
        params.push(`content=${encodeURIComponent(options.fallbackContent || '')}`);
    } else if (options.content) {
        params.push(`content=${encodeURIComponent(options.content)}`);
    }

    return `obsidian://new?${params.join('&')}`;
}

export function sanitizeObsidianFileName(name) {
    const sanitized = String(name || '')
        .replace(/[\/\\?%*:|"<>+]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
    return sanitized || `PageTalk Export ${formatDateToken(new Date())}`;
}

export function sanitizeObsidianFolder(folder) {
    return String(folder || '')
        .split('/')
        .map(part => sanitizeObsidianFileName(part))
        .filter(Boolean)
        .join('/');
}

export function readObsidianExportSettingsFromElements(elements, state, currentTranslations = {}) {
    const existing = normalizeObsidianExportSettings(state.obsidianExportSettings, currentTranslations);
    return normalizeObsidianExportSettings({
        vault: elements.obsidianVaultInput?.value?.trim() ?? existing.vault,
        folder: elements.obsidianFolderInput?.value?.trim() ?? existing.folder,
        noteNameTemplate: elements.obsidianNoteNameInput?.value?.trim() ?? existing.noteNameTemplate,
        frontmatterTemplate: elements.obsidianFrontmatterTemplateTextarea?.value ?? existing.frontmatterTemplate,
        bodyTemplate: elements.obsidianBodyTemplateTextarea?.value ?? existing.bodyTemplate,
        silentOpen: elements.obsidianSilentOpenToggle?.checked ?? existing.silentOpen,
        aiEnabled: elements.obsidianAiEnabledToggle?.checked ?? existing.aiEnabled,
        aiModel: elements.obsidianAiModelSelect?.value?.trim() ?? existing.aiModel,
        aiPrompt: elements.obsidianAiPromptTextarea?.value ?? existing.aiPrompt
    }, currentTranslations);
}

export function applyObsidianExportSettingsToElements(settings, elements) {
    const normalized = normalizeObsidianExportSettings(settings);
    if (elements.obsidianVaultInput) elements.obsidianVaultInput.value = normalized.vault;
    if (elements.obsidianFolderInput) elements.obsidianFolderInput.value = normalized.folder;
    if (elements.obsidianNoteNameInput) elements.obsidianNoteNameInput.value = normalized.noteNameTemplate;
    if (elements.obsidianFrontmatterTemplateTextarea) elements.obsidianFrontmatterTemplateTextarea.value = normalized.frontmatterTemplate;
    if (elements.obsidianBodyTemplateTextarea) elements.obsidianBodyTemplateTextarea.value = normalized.bodyTemplate;
    if (elements.obsidianSilentOpenToggle) elements.obsidianSilentOpenToggle.checked = normalized.silentOpen;
    if (elements.obsidianAiEnabledToggle) elements.obsidianAiEnabledToggle.checked = normalized.aiEnabled;
    if (elements.obsidianAiModelSelect) elements.obsidianAiModelSelect.value = normalized.aiModel;
    if (elements.obsidianAiPromptTextarea) elements.obsidianAiPromptTextarea.value = normalized.aiPrompt;
}

export function saveObsidianExportSettings(settings) {
    return chrome.storage.sync.set({
        obsidianExportSettings: normalizeObsidianExportSettings(settings)
    });
}

async function exportMarkdownToObsidian(markdown, options, currentTranslations) {
    const clipboardWritten = await writeMarkdownToClipboard(markdown);
    const useClipboard = clipboardWritten;
    const fallbackText = _('obsidianClipboardFallback', {}, currentTranslations);

    if (!clipboardWritten && markdown.length > CONTENT_URI_FALLBACK_LIMIT) {
        throw new Error(_('obsidianClipboardError', {}, currentTranslations));
    }

    const obsidianUrl = buildObsidianUrl({
        ...options,
        useClipboard,
        fallbackContent: fallbackText,
        content: useClipboard ? '' : markdown
    });

    const response = await chrome.runtime.sendMessage({
        action: 'openObsidianUrl',
        url: obsidianUrl
    });

    if (!response || !response.success) {
        throw new Error(response?.error || _('obsidianOpenError', {}, currentTranslations));
    }
}

async function writeMarkdownToClipboard(markdown) {
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(markdown);
            return true;
        } catch (error) {
            console.warn('[ObsidianExport] navigator.clipboard.writeText failed:', error);
        }
    }

    return copyWithTextArea(markdown);
}

function copyWithTextArea(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
        return document.execCommand('copy');
    } catch (error) {
        console.warn('[ObsidianExport] execCommand copy failed:', error);
        return false;
    } finally {
        document.body.removeChild(textarea);
    }
}

function splitContextSections(pageContext) {
    const sections = {
        article: '',
        comments: '',
        manual: ''
    };

    if (typeof pageContext !== 'string' || !pageContext.trim()) {
        return sections;
    }

    const matches = Array.from(pageContext.matchAll(/^# (Page Content|Comments \/ Replies|Manually Selected Page Area)\s*$/gm));
    if (matches.length === 0) {
        sections.article = pageContext.trim();
        return sections;
    }

    matches.forEach((match, index) => {
        const title = match[1];
        const start = match.index + match[0].length;
        const end = index + 1 < matches.length ? matches[index + 1].index : pageContext.length;
        const body = stripSectionDecorators(pageContext.slice(start, end));

        if (title === 'Page Content') {
            sections.article = appendSectionText(sections.article, body);
        } else if (title === 'Comments / Replies') {
            sections.comments = appendSectionText(sections.comments, stripSingleDefaultCommentSectionTitle(body));
        } else if (title === 'Manually Selected Page Area') {
            sections.manual = appendSectionText(sections.manual, body);
        }
    });

    return sections;
}

export function buildObsidianTemplateVariables(state, elements, currentTranslations) {
    const _tr = (key, rep = {}) => _(key, rep, currentTranslations);
    const now = new Date();
    const pageTitle = state.pageTitle || _tr('untitledPage');
    const pageUrl = state.pageUrl || '';
    const contextStatus = getPageContextStatus(state.pageContext);
    const contextText = getPageContextTextForPrompt(state);
    const contextSections = splitContextSections(contextText);
    const chatMarkdown = buildChatMarkdown(state, elements, currentTranslations, { headingOffset: 0 }).trim();
    const hasContext = Object.values(contextSections).some(section => section.trim());
    const contextFallback = contextStatus === 'failed' ? _tr('obsidianContextFailed') : _tr('obsidianNoContext');
    const selectedTabs = collectSelectedTabs(state.chatHistory || []);
    const selectedTabsMarkdown = buildSelectedTabsMarkdown(selectedTabs);
    const pageMeta = state.pageContextMeta && typeof state.pageContextMeta === 'object' ? state.pageContextMeta : {};
    const author = normalizeTemplateMetadataText(pageMeta.author);
    const published = normalizePublishedDateMetadata(pageMeta.published);

    return {
        title: pageTitle,
        url: pageUrl,
        author,
        published,
        domain: getUrlDomain(pageUrl),
        site: getUrlDomain(pageUrl),
        date: formatDateToken(now),
        time: formatTimeToken(now),
        datetime: formatDateTimeToken(now),
        isoDatetime: now.toISOString(),
        localDatetime: formatLocalDateTime(now, state.language),
        noteName: sanitizeObsidianFileName(pageTitle),
        content: contextSections.article.trim(),
        comments: contextSections.comments.trim(),
        manualArea: contextSections.manual.trim(),
        context: hasContext ? contextText.trim() : '',
        contextFallback: `_${contextFallback}_`,
        chat: chatMarkdown,
        selectedTabs: selectedTabsMarkdown,
        selectedTabsMarkdown,
        contextTabs: selectedTabs,
        tabCount: selectedTabs.length,
        words: countWords(contextText),
        contextLinks: state.removeContextWebLinks === false ? 'preserved' : 'removed',
        aiSummary: '',
        aiTags: [],
        aiTagsText: '',
        aiCategory: '',
        aiGeneratedAt: ''
    };
}

export async function generateObsidianAiMetadata(settings, variables, currentTranslations = {}) {
    if (!window.PageTalkAPI?.callApi) {
        throw new Error(_('unifiedApiNotAvailable', {}, currentTranslations));
    }

    const prompt = String(settings.aiPrompt || getDefaultObsidianAiPrompt(currentTranslations)).trim();
    if (!prompt) {
        throw new Error(_('obsidianAiMissingPrompt', {}, currentTranslations));
    }

    const messages = [
        {
            role: 'system',
            content: prompt
        },
        {
            role: 'user',
            content: buildObsidianAiPromptPayload(variables, currentTranslations)
        }
    ];

    const rawResponse = await callObsidianTextModelOnce(settings.aiModel, messages);
    const parsed = parseObsidianAiMetadata(rawResponse);

    return {
        aiSummary: parsed.summary,
        aiTags: parsed.tags,
        aiTagsText: parsed.tags.join(', '),
        aiCategory: parsed.category,
        aiGeneratedAt: new Date().toISOString()
    };
}

export function parseObsidianAiMetadata(rawResponse) {
    const responseText = String(rawResponse || '').trim();
    const jsonCandidate = extractJsonObject(responseText);

    if (jsonCandidate) {
        try {
            const parsed = JSON.parse(jsonCandidate);
            return normalizeObsidianAiMetadata(parsed, responseText);
        } catch (error) {
            console.warn('[ObsidianExport] Failed to parse AI JSON response:', error);
        }
    }

    return normalizeObsidianAiMetadata({ summary: responseText }, responseText);
}

function normalizeObsidianAiMetadata(parsed, fallbackSummary = '') {
    const summary = normalizeAiSummary(parsed?.summary || parsed?.aiSummary || fallbackSummary);
    const tags = normalizeAiTags(parsed?.tags || parsed?.aiTags || parsed?.tag);
    const category = normalizeAiCategory(parsed?.category || parsed?.classification || parsed?.folder || parsed?.aiCategory);

    return { summary, tags, category };
}

function normalizeAiSummary(value) {
    return stripMarkdownForAiSummary(String(value || '').trim());
}

function normalizeAiTags(value) {
    const rawTags = Array.isArray(value)
        ? value
        : String(value || '').split(/[,，\n]/);

    const tags = [];
    const seen = new Set();

    rawTags.forEach(tag => {
        const normalized = normalizeAiTag(tag);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        tags.push(normalized);
    });

    return tags.slice(0, 8);
}

function normalizeAiTag(tag) {
    const normalized = String(tag || '')
        .replace(/^#+/, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[,[\]{}"'`]/g, '')
        .replace(/^-+|-+$/g, '');
    return normalized.slice(0, 48);
}

function normalizeAiCategory(value) {
    return String(value || '')
        .trim()
        .replace(/^#+/, '')
        .replace(/\s*\/\s*/g, '/')
        .replace(/[\n\r\t]/g, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, 120);
}

function stripMarkdownForAiSummary(markdown) {
    return String(markdown || '')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/[*_`>#-]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractJsonObject(text) {
    const cleanText = String(text || '').trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

    if (!cleanText) return '';
    if (cleanText.startsWith('{') && cleanText.endsWith('}')) return cleanText;

    const start = cleanText.indexOf('{');
    const end = cleanText.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return '';

    return cleanText.slice(start, end + 1);
}

function buildObsidianAiPromptPayload(variables, currentTranslations) {
    const selectedTabs = Array.isArray(variables.contextTabs)
        ? variables.contextTabs.map((tab, index) => {
            const title = tab.title || tab.url || tab.id || `Tab ${index + 1}`;
            return `${index + 1}. ${title}${tab.url ? `\n   ${tab.url}` : ''}`;
        }).join('\n')
        : '';

    return [
        `Language: ${currentTranslations?.htmlLang || 'en'}`,
        '',
        '# Page Metadata',
        `Title: ${variables.title || ''}`,
        `URL: ${variables.url || ''}`,
        `Domain: ${variables.domain || ''}`,
        `Author: ${variables.author || ''}`,
        `Published: ${variables.published || ''}`,
        '',
        '# Page Content',
        truncateForAiPrompt(variables.content),
        '',
        '# Comments / Replies',
        truncateForAiPrompt(variables.comments),
        '',
        '# Manually Selected Page Area',
        truncateForAiPrompt(variables.manualArea),
        '',
        '# Selected Context Tabs',
        selectedTabs || '(none)',
        '',
        '# Chat',
        truncateForAiPrompt(variables.chat),
        '',
        'Return JSON only with keys: summary, tags, category.'
    ].join('\n');
}

function truncateForAiPrompt(value) {
    const text = String(value || '').trim();
    if (text.length <= OBSIDIAN_AI_MAX_SECTION_CHARS) return text || '(empty)';
    return `${text.slice(0, OBSIDIAN_AI_MAX_SECTION_CHARS).trim()}\n\n...(truncated)`;
}

function normalizeTemplateMetadataText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizePublishedDateMetadata(value) {
    const text = normalizeTemplateMetadataText(value);
    if (!text) return '';

    const isoLikeMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoLikeMatch) return isoLikeMatch[1];

    if (typeof dayjs !== 'undefined') {
        const parsed = dayjs(text);
        if (parsed.isValid()) return parsed.format('YYYY-MM-DD');
    }

    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) return formatDateToken(date);

    return text;
}

async function callObsidianTextModelOnce(modelId, messages) {
    let accumulatedText = '';
    await window.PageTalkAPI.callApi(modelId, messages, (chunk) => {
        accumulatedText += chunk;
    }, {});
    return accumulatedText.trim();
}

export function compileObsidianTemplate(template, variables = {}) {
    let output = String(template || '');

    output = renderTwigLogicBlocks(output, variables);
    output = renderMustacheSections(output, variables);
    output = renderTemplateVariables(output, variables);

    return output.replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n');
}

function isTruthyTemplateValue(value) {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    return value != null && String(value).trim() !== '';
}

function collectSelectedTabs(chatHistory) {
    const tabs = [];
    const seen = new Set();
    chatHistory.forEach(message => {
        (message.sentContextTabsInfo || []).forEach(tab => {
            const key = tab.url || tab.id || tab.title;
            if (!key || seen.has(key)) return;
            seen.add(key);
            tabs.push(tab);
        });
    });

    return tabs;
}

function buildSelectedTabsMarkdown(tabs) {
    return tabs.map((tab, index) => {
        const title = tab.title || tab.url || tab.id || `Tab ${index + 1}`;
        return `${index + 1}. ${tab.url ? `[${title}](${tab.url})` : title}`;
    }).join('\n');
}

function renderTwigLogicBlocks(template, variables) {
    let output = '';
    let cursor = 0;

    while (cursor < template.length) {
        const startTag = findNextTwigBlockStart(template, cursor);
        if (!startTag) {
            output += template.slice(cursor);
            break;
        }

        output += template.slice(cursor, startTag.index);

        if (startTag.keyword === 'if') {
            const block = findTwigBlock(template, startTag.end, 'if', 'endif', ['elseif', 'else']);
            if (!block) {
                output += startTag.raw;
                cursor = startTag.end;
                continue;
            }
            block.segments[0].condition = startTag.expression;
            output += renderIfSegments(block.segments, variables);
            cursor = block.end;
        } else if (startTag.keyword === 'for') {
            const block = findTwigBlock(template, startTag.end, 'for', 'endfor', []);
            if (!block) {
                output += startTag.raw;
                cursor = startTag.end;
                continue;
            }
            output += renderForSegment(startTag.expression, block.segments[0]?.body || '', variables);
            cursor = block.end;
        }
    }

    return output;
}

function findNextTwigBlockStart(template, startIndex) {
    const tagRegex = /{%-?\s*([\s\S]*?)\s*-?%}/g;
    tagRegex.lastIndex = startIndex;

    let match;
    while ((match = tagRegex.exec(template)) !== null) {
        const content = match[1].trim();
        const keyword = getTwigKeyword(content);
        if (keyword === 'if' || keyword === 'for') {
            return {
                raw: match[0],
                keyword,
                expression: content.slice(keyword.length).trim(),
                index: match.index,
                end: tagRegex.lastIndex
            };
        }
    }

    return null;
}

function findTwigBlock(template, startIndex, openKeyword, closeKeyword, branchKeywords) {
    const tagRegex = /{%-?\s*([\s\S]*?)\s*-?%}/g;
    tagRegex.lastIndex = startIndex;

    const segments = [{ keyword: openKeyword, condition: '', body: '' }];
    let bodyStart = startIndex;
    let depth = 1;
    let match;

    while ((match = tagRegex.exec(template)) !== null) {
        const content = match[1].trim();
        const keyword = getTwigKeyword(content);

        if (keyword === openKeyword) {
            depth += 1;
        } else if (keyword === closeKeyword) {
            depth -= 1;
            if (depth === 0) {
                segments[segments.length - 1].body = template.slice(bodyStart, match.index);
                return {
                    segments,
                    end: tagRegex.lastIndex
                };
            }
        } else if (depth === 1 && branchKeywords.includes(keyword)) {
            segments[segments.length - 1].body = template.slice(bodyStart, match.index);
            segments.push({
                keyword,
                condition: keyword === 'else' ? '' : content.slice(keyword.length).trim(),
                body: ''
            });
            bodyStart = tagRegex.lastIndex;
        }
    }

    return null;
}

function getTwigKeyword(content) {
    const match = String(content || '').trim().match(/^([A-Za-z_][\w-]*)\b/);
    return match ? match[1] : '';
}

function renderIfSegments(segments, variables) {
    for (const segment of segments) {
        if (segment.keyword === 'else' || evaluateTemplateCondition(segment.condition, variables)) {
            return compileObsidianTemplate(segment.body, variables);
        }
    }

    return '';
}

function renderForSegment(expression, body, variables) {
    const match = String(expression || '').trim().match(/^([A-Za-z_]\w*)\s+in\s+([\s\S]+)$/);
    if (!match) return '';

    const iterator = match[1];
    const iterableValue = evaluateTemplateValue(match[2], variables);
    const items = normalizeIterable(iterableValue);

    return items.map((item, index) => {
        const loopVariables = {
            ...variables,
            [iterator]: item,
            [`${iterator}_index`]: index,
            loop: {
                index: index + 1,
                index0: index,
                first: index === 0,
                last: index === items.length - 1,
                length: items.length
            }
        };
        return compileObsidianTemplate(body, loopVariables);
    }).join('');
}

function normalizeIterable(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
        return Object.entries(value).map(([key, item]) => {
            if (item && typeof item === 'object' && !Array.isArray(item)) {
                return { key, ...item };
            }
            return { key, value: item };
        });
    }
    if (typeof value === 'string' && value.trim()) return value.split('\n').filter(Boolean);
    return [];
}

function renderMustacheSections(template, variables) {
    let output = String(template || '');

    output = output.replace(/{{#\s*([\w.]+)\s*}}([\s\S]*?){{\/\s*\1\s*}}/g, (match, key, body) => {
        return isTruthyTemplateValue(resolveTemplatePath(key, variables)) ? compileObsidianTemplate(body, variables) : '';
    });
    output = output.replace(/{{\^\s*([\w.]+)\s*}}([\s\S]*?){{\/\s*\1\s*}}/g, (match, key, body) => {
        return isTruthyTemplateValue(resolveTemplatePath(key, variables)) ? '' : compileObsidianTemplate(body, variables);
    });

    return output;
}

function renderTemplateVariables(template, variables) {
    return String(template || '').replace(/{{-?\s*([\s\S]*?)\s*-?}}/g, (match, expression) => {
        const value = evaluateTemplateValue(expression, variables);
        return valueToTemplateString(value);
    });
}

function evaluateTemplateCondition(expression, variables) {
    const expr = stripOuterParentheses(String(expression || '').trim());
    if (!expr) return false;

    const orParts = splitTopLevelLogical(expr, ['or', '||']);
    if (orParts.length > 1) {
        return orParts.some(part => evaluateTemplateCondition(part, variables));
    }

    const andParts = splitTopLevelLogical(expr, ['and', '&&']);
    if (andParts.length > 1) {
        return andParts.every(part => evaluateTemplateCondition(part, variables));
    }

    if (/^not\s+/i.test(expr)) {
        return !evaluateTemplateCondition(expr.replace(/^not\s+/i, ''), variables);
    }
    if (expr.startsWith('!')) {
        return !evaluateTemplateCondition(expr.slice(1), variables);
    }

    const containsParts = splitTopLevelContains(expr);
    if (containsParts) {
        const left = evaluateTemplateValue(containsParts.left, variables);
        const right = evaluateTemplateValue(containsParts.right, variables);
        if (Array.isArray(left)) return left.some(item => String(item) === String(right));
        return String(left || '').includes(String(right || ''));
    }

    const comparison = findTopLevelComparison(expr);
    if (comparison) {
        const left = evaluateTemplateValue(comparison.left, variables);
        const right = evaluateTemplateValue(comparison.right, variables);
        return compareTemplateValues(left, right, comparison.operator);
    }

    return isTruthyTemplateValue(evaluateTemplateValue(expr, variables));
}

function evaluateTemplateValue(expression, variables) {
    const expr = String(expression || '').trim();
    if (!expr) return '';

    const fallbackParts = splitTopLevelOperator(expr, '??');
    if (fallbackParts.length > 1) {
        for (const part of fallbackParts) {
            const value = evaluateTemplateValue(part, variables);
            if (isTruthyTemplateValue(value)) return value;
        }
        return '';
    }

    const filterParts = splitTopLevelOperator(expr, '|');
    const baseExpression = filterParts.shift();
    let value = evaluateTemplateAtom(baseExpression, variables);

    filterParts.forEach(filterExpression => {
        value = applyTemplateFilter(value, filterExpression, variables);
    });

    return value;
}

function evaluateTemplateAtom(expression, variables) {
    const expr = stripOuterParentheses(String(expression || '').trim());

    if ((expr.startsWith('"') && expr.endsWith('"')) || (expr.startsWith("'") && expr.endsWith("'"))) {
        return unquoteTemplateString(expr);
    }
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    if (/^true$/i.test(expr)) return true;
    if (/^false$/i.test(expr)) return false;
    if (/^null$/i.test(expr) || /^undefined$/i.test(expr)) return '';

    return resolveTemplatePath(expr, variables);
}

function applyTemplateFilter(value, filterExpression, variables) {
    const { name, args } = parseTemplateFilter(filterExpression, variables);

    switch (name) {
        case 'trim':
            return String(value ?? '').trim();
        case 'lower':
            return String(value ?? '').toLowerCase();
        case 'upper':
            return String(value ?? '').toUpperCase();
        case 'capitalize':
            return capitalizeText(String(value ?? ''));
        case 'title':
            return titleCase(String(value ?? ''));
        case 'safe_name':
        case 'safeName':
            return sanitizeObsidianFileName(value);
        case 'yaml':
            return formatYamlValue(value);
        case 'json':
            return JSON.stringify(value ?? '');
        case 'date':
            return formatDateFilter(value, args[0]);
        case 'replace':
            return replaceFilter(value, args[0], args[1]);
        case 'length':
            return getTemplateLength(value);
        case 'join':
            return Array.isArray(value) ? value.map(valueToTemplateString).join(args[0] ?? ', ') : String(value ?? '');
        case 'split':
            return String(value ?? '').split(args[0] ?? ',');
        case 'first':
            return Array.isArray(value) ? (value[0] ?? '') : String(value ?? '').charAt(0);
        case 'last':
            return Array.isArray(value) ? (value[value.length - 1] ?? '') : String(value ?? '').charAt(String(value ?? '').length - 1);
        case 'blockquote':
            return String(value ?? '').split('\n').map(line => line ? `> ${line}` : '>').join('\n');
        case 'list':
            return listFilter(value, args[0]);
        case 'link':
            return linkFilter(value, args[0]);
        case 'wikilink':
            return wikilinkFilter(value, args[0]);
        case 'default':
            return isTruthyTemplateValue(value) ? value : (args[0] ?? '');
        default:
            return value;
    }
}

function parseTemplateFilter(filterExpression, variables) {
    const spec = String(filterExpression || '').trim();
    const separatorIndex = findTopLevelChar(spec, ':');
    if (separatorIndex === -1) {
        return { name: spec, args: [] };
    }

    const name = spec.slice(0, separatorIndex).trim();
    const argString = spec.slice(separatorIndex + 1).trim();
    const args = splitTopLevelArguments(argString)
        .map(arg => evaluateTemplateValue(arg, variables));
    return { name, args };
}

function resolveTemplatePath(path, variables) {
    const cleanPath = String(path || '').trim();
    if (!cleanPath) return '';
    if (Object.prototype.hasOwnProperty.call(variables, cleanPath)) return variables[cleanPath];

    const tokens = tokenizeTemplatePath(cleanPath);
    if (tokens.length === 0) return '';

    let current = variables;
    for (const token of tokens) {
        if (current == null) return '';
        current = current[token];
    }

    return current == null ? '' : current;
}

function tokenizeTemplatePath(path) {
    const tokens = [];
    const tokenRegex = /([A-Za-z_]\w*)|\[(?:"([^"]+)"|'([^']+)'|(\d+)|([A-Za-z_]\w*))\]/g;
    let match;
    while ((match = tokenRegex.exec(path)) !== null) {
        tokens.push(match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5]);
    }
    return tokens;
}

function valueToTemplateString(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(valueToTemplateString).join('\n');
    if (typeof value === 'object') return value.title || value.url || value.value || JSON.stringify(value);
    return String(value);
}

function splitTopLevelLogical(expression, operators) {
    for (const operator of operators) {
        const parts = splitTopLevelWordOrSymbol(expression, operator);
        if (parts.length > 1) return parts;
    }
    return [expression];
}

function splitTopLevelContains(expression) {
    const parts = splitTopLevelWordOrSymbol(expression, 'contains');
    if (parts.length !== 2) return null;
    return { left: parts[0], right: parts[1] };
}

function splitTopLevelWordOrSymbol(expression, operator) {
    const expr = String(expression || '');
    const parts = [];
    let cursor = 0;
    let quote = '';
    let depth = 0;

    for (let index = 0; index < expr.length; index += 1) {
        const char = expr[index];
        const prev = expr[index - 1];
        if (quote) {
            if (char === quote && prev !== '\\') quote = '';
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (char === '(' || char === '[' || char === '{') {
            depth += 1;
            continue;
        }
        if (char === ')' || char === ']' || char === '}') {
            depth = Math.max(0, depth - 1);
            continue;
        }
        if (depth !== 0) continue;

        if (operator === '&&' || operator === '||') {
            if (expr.slice(index, index + operator.length) === operator) {
                parts.push(expr.slice(cursor, index).trim());
                cursor = index + operator.length;
                index = cursor - 1;
            }
            continue;
        }

        if (isWordOperatorAt(expr, index, operator)) {
            parts.push(expr.slice(cursor, index).trim());
            cursor = index + operator.length;
            index = cursor - 1;
        }
    }

    if (parts.length === 0) return [expression];
    parts.push(expr.slice(cursor).trim());
    return parts.filter(part => part !== '');
}

function splitTopLevelOperator(expression, operator) {
    const expr = String(expression || '');
    const parts = [];
    let cursor = 0;
    let quote = '';
    let depth = 0;

    for (let index = 0; index < expr.length; index += 1) {
        const char = expr[index];
        const prev = expr[index - 1];
        if (quote) {
            if (char === quote && prev !== '\\') quote = '';
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (char === '(' || char === '[' || char === '{') {
            depth += 1;
            continue;
        }
        if (char === ')' || char === ']' || char === '}') {
            depth = Math.max(0, depth - 1);
            continue;
        }
        if (depth === 0 && expr.slice(index, index + operator.length) === operator) {
            parts.push(expr.slice(cursor, index).trim());
            cursor = index + operator.length;
            index = cursor - 1;
        }
    }

    if (parts.length === 0) return [expression];
    parts.push(expr.slice(cursor).trim());
    return parts;
}

function splitTopLevelArguments(args) {
    const commaParts = splitTopLevelOperator(args, ',');
    if (commaParts.length > 1) return commaParts;

    const colonIndex = findTopLevelChar(args, ':');
    if (colonIndex === -1) return args ? [args] : [];
    return [
        args.slice(0, colonIndex).trim(),
        args.slice(colonIndex + 1).trim()
    ];
}

function findTopLevelChar(expression, charToFind) {
    const expr = String(expression || '');
    let quote = '';
    let depth = 0;

    for (let index = 0; index < expr.length; index += 1) {
        const char = expr[index];
        const prev = expr[index - 1];
        if (quote) {
            if (char === quote && prev !== '\\') quote = '';
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (char === '(' || char === '[' || char === '{') {
            depth += 1;
            continue;
        }
        if (char === ')' || char === ']' || char === '}') {
            depth = Math.max(0, depth - 1);
            continue;
        }
        if (depth === 0 && char === charToFind) return index;
    }

    return -1;
}

function findTopLevelComparison(expression) {
    const operators = ['==', '!=', '>=', '<=', '>', '<'];
    const expr = String(expression || '');
    let quote = '';
    let depth = 0;

    for (let index = 0; index < expr.length; index += 1) {
        const char = expr[index];
        const prev = expr[index - 1];
        if (quote) {
            if (char === quote && prev !== '\\') quote = '';
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (char === '(' || char === '[' || char === '{') {
            depth += 1;
            continue;
        }
        if (char === ')' || char === ']' || char === '}') {
            depth = Math.max(0, depth - 1);
            continue;
        }
        if (depth !== 0) continue;

        const operator = operators.find(op => expr.slice(index, index + op.length) === op);
        if (operator) {
            return {
                left: expr.slice(0, index).trim(),
                operator,
                right: expr.slice(index + operator.length).trim()
            };
        }
    }

    return null;
}

function compareTemplateValues(left, right, operator) {
    if (operator === '==' || operator === '!=') {
        const equal = String(left ?? '') === String(right ?? '');
        return operator === '==' ? equal : !equal;
    }

    const leftNumber = Number(left);
    const rightNumber = Number(right);
    const useNumbers = !Number.isNaN(leftNumber) && !Number.isNaN(rightNumber);
    const a = useNumbers ? leftNumber : String(left ?? '');
    const b = useNumbers ? rightNumber : String(right ?? '');

    if (operator === '>') return a > b;
    if (operator === '<') return a < b;
    if (operator === '>=') return a >= b;
    if (operator === '<=') return a <= b;
    return false;
}

function isWordOperatorAt(expression, index, operator) {
    const before = expression[index - 1];
    const after = expression[index + operator.length];
    return expression.slice(index, index + operator.length).toLowerCase() === operator.toLowerCase()
        && (!before || /\s|\(/.test(before))
        && (!after || /\s|\)/.test(after));
}

function stripOuterParentheses(expression) {
    let expr = String(expression || '').trim();
    while (expr.startsWith('(') && expr.endsWith(')') && hasBalancedOuterParentheses(expr)) {
        expr = expr.slice(1, -1).trim();
    }
    return expr;
}

function hasBalancedOuterParentheses(expression) {
    let quote = '';
    let depth = 0;
    for (let index = 0; index < expression.length; index += 1) {
        const char = expression[index];
        const prev = expression[index - 1];
        if (quote) {
            if (char === quote && prev !== '\\') quote = '';
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (char === '(') depth += 1;
        if (char === ')') depth -= 1;
        if (depth === 0 && index < expression.length - 1) return false;
    }
    return depth === 0;
}

function unquoteTemplateString(value) {
    const quote = value[0];
    return value.slice(1, -1)
        .replace(new RegExp(`\\\\${quote}`, 'g'), quote)
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\');
}

function formatYamlValue(value) {
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        return `\n${value.map(item => `  - ${JSON.stringify(String(item ?? ''))}`).join('\n')}`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value == null || value === '') return '""';
    return JSON.stringify(String(value));
}

function formatDateFilter(value, format = 'YYYY-MM-DD') {
    const source = value || new Date();
    if (typeof dayjs !== 'undefined') {
        const parsed = dayjs(source);
        return parsed.isValid() ? parsed.format(format) : String(value ?? '');
    }
    const date = source instanceof Date ? source : new Date(source);
    if (Number.isNaN(date.getTime())) return String(value ?? '');
    if (format === 'YYYY-MM-DD') return formatDateToken(date);
    if (format === 'HH:mm:ss') return `${formatTimeToken(date)}:${String(date.getSeconds()).padStart(2, '0')}`;
    return date.toISOString();
}

function replaceFilter(value, searchValue = '', replacement = '') {
    const source = String(value ?? '');
    const search = String(searchValue ?? '');
    const replaceWith = String(replacement ?? '');
    if (!search) return source;
    const regexMatch = search.match(/^\/([\s\S]+)\/([gimsuy]*)$/);
    if (regexMatch) {
        try {
            return source.replace(new RegExp(regexMatch[1], regexMatch[2]), replaceWith);
        } catch (_) {
            return source;
        }
    }
    return source.split(search).join(replaceWith);
}

function listFilter(value, mode = '') {
    const items = Array.isArray(value) ? value : String(value ?? '').split('\n').filter(Boolean);
    const numbered = String(mode || '').includes('numbered');
    const task = String(mode || '').includes('task');
    return items.map((item, index) => {
        const prefix = numbered ? `${index + 1}.` : '-';
        const checkbox = task ? ' [ ]' : '';
        return `${prefix}${checkbox} ${valueToTemplateString(item)}`;
    }).join('\n');
}

function linkFilter(value, label = '') {
    const url = String(value ?? '').trim();
    if (!url) return '';
    return `[${label || url}](${url})`;
}

function wikilinkFilter(value, alias = '') {
    const page = String(value ?? '').trim();
    if (!page) return '';
    return alias ? `[[${page}|${alias}]]` : `[[${page}]]`;
}

function getTemplateLength(value) {
    if (Array.isArray(value) || typeof value === 'string') return value.length;
    if (value && typeof value === 'object') return Object.keys(value).length;
    return 0;
}

function capitalizeText(value) {
    return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : '';
}

function titleCase(value) {
    return value.replace(/\S+/g, word => capitalizeText(word));
}

function countWords(text) {
    const value = String(text || '').trim();
    if (!value) return 0;
    const cjkMatches = value.match(/[\u4e00-\u9fff]/g) || [];
    const wordMatches = value.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9_]+/g) || [];
    return cjkMatches.length + wordMatches.length;
}

function getUrlDomain(url) {
    try {
        return url ? new URL(url).hostname.replace(/^www\./i, '') : '';
    } catch (_) {
        return '';
    }
}

function stripSectionDecorators(text) {
    return String(text || '')
        .replace(/^\s*---\s*$/gm, '')
        .replace(/^_Source:[^\n]*_\s*/gmi, '')
        .trim();
}

function stripSingleDefaultCommentSectionTitle(text) {
    const cleanText = String(text || '').trim();
    const sectionHeadings = Array.from(cleanText.matchAll(/^##\s+Comment Section\s+\d+\s*$/gmi));
    if (sectionHeadings.length !== 1) return cleanText;
    if (!/^##\s+Comment Section\s+1\s*$/i.test(sectionHeadings[0][0])) return cleanText;
    return cleanText.replace(/^##\s+Comment Section\s+1\s*\n+/i, '').trim();
}

function appendSectionText(existing, next) {
    const cleanNext = String(next || '').trim();
    if (!cleanNext) return existing || '';
    return existing ? `${existing}\n\n---\n\n${cleanNext}` : cleanNext;
}

function renderNoteNameTemplate(template, state, variables = null) {
    const now = new Date();
    const title = state.pageTitle || 'Untitled';
    const url = state.pageUrl || '';
    const noteVariables = variables || {
        title,
        url,
        domain: getUrlDomain(url),
        site: getUrlDomain(url),
        date: formatDateToken(now),
        time: formatTimeToken(now),
        datetime: formatDateTimeToken(now),
        isoDatetime: now.toISOString(),
        localDatetime: formatLocalDateTime(now, state.language),
        noteName: sanitizeObsidianFileName(title)
    };
    const rawTemplate = String(template || DEFAULT_OBSIDIAN_EXPORT_SETTINGS.noteNameTemplate);
    const legacyCompatibleTemplate = replaceLegacyNoteNameTokens(rawTemplate, {
        title,
        date: formatDateToken(now),
        time: formatTimeToken(now),
        datetime: formatDateTimeToken(now),
        url
    });
    const rendered = rawTemplate.includes('{{') || rawTemplate.includes('{%')
        ? compileObsidianTemplate(legacyCompatibleTemplate, noteVariables)
        : legacyCompatibleTemplate;

    return sanitizeObsidianFileName(rendered);
}

function replaceLegacyNoteNameTokens(template, values) {
    let output = String(template || '');
    Object.entries(values).forEach(([key, value]) => {
        const pattern = new RegExp(`(^|[^\\{])\\{${key}\\}(?!\\})`, 'g');
        output = output.replace(pattern, (match, prefix) => `${prefix}${value}`);
    });
    return output;
}

function formatDateToken(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

function formatDateTimeToken(date) {
    return `${formatDateToken(date)} ${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatTimeToken(date) {
    return `${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatLocalDateTime(date, language) {
    if (typeof dayjs !== 'undefined') {
        const locale = language?.toLowerCase() === 'zh-cn' ? 'zh-cn' : 'en';
        dayjs.locale(locale);
        return dayjs(date).format('YYYY-MM-DD HH:mm:ss');
    }
    return date.toLocaleString();
}

function yamlString(value) {
    return JSON.stringify(String(value || ''));
}
