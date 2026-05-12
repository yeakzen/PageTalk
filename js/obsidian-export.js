import { tr as _ } from './utils/i18n.js';
import { buildChatMarkdown } from './export-utils.js';
import { getPageContextStatus, getPageContextTextForPrompt } from './context-state.js';

export const DEFAULT_OBSIDIAN_EXPORT_SETTINGS = Object.freeze({
    vault: '',
    folder: 'PageTalk',
    noteNameTemplate: 'PageTalk - {title} - {date}',
    silentOpen: false
});

const CONTENT_URI_FALLBACK_LIMIT = 1800;

export function normalizeObsidianExportSettings(rawSettings = {}) {
    return {
        vault: typeof rawSettings.vault === 'string' ? rawSettings.vault : DEFAULT_OBSIDIAN_EXPORT_SETTINGS.vault,
        folder: typeof rawSettings.folder === 'string' ? rawSettings.folder : DEFAULT_OBSIDIAN_EXPORT_SETTINGS.folder,
        noteNameTemplate: typeof rawSettings.noteNameTemplate === 'string' && rawSettings.noteNameTemplate.trim()
            ? rawSettings.noteNameTemplate
            : DEFAULT_OBSIDIAN_EXPORT_SETTINGS.noteNameTemplate,
        silentOpen: rawSettings.silentOpen === true
    };
}

export async function handleExportToObsidian(state, elements, showToastCallback, currentTranslations) {
    const settings = readObsidianExportSettingsFromElements(elements, state);
    state.obsidianExportSettings = settings;

    try {
        if (getPageContextStatus(state.pageContext) === 'extracting') {
            showToastCallback(_('obsidianContextExtracting', {}, currentTranslations), 'info');
            return;
        }

        const markdown = buildObsidianExportMarkdown(state, elements, currentTranslations, settings);

        if (!markdown.trim()) {
            showToastCallback(_('obsidianExportEmptyError', {}, currentTranslations), 'error');
            return;
        }

        void saveObsidianExportSettings(settings).catch(error => {
            console.warn('[ObsidianExport] Failed to save settings before export:', error);
        });

        const noteName = renderNoteNameTemplate(settings.noteNameTemplate, state);
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

export function buildObsidianExportMarkdown(state, elements, currentTranslations, settings = DEFAULT_OBSIDIAN_EXPORT_SETTINGS) {
    const _tr = (key, rep = {}) => _(key, rep, currentTranslations);
    const pageTitle = state.pageTitle || _tr('untitledPage');
    const pageUrl = state.pageUrl || '';
    const now = new Date();
    const isoDatetime = now.toISOString();
    const localDatetime = formatLocalDateTime(now, state.language);
    const contextStatus = getPageContextStatus(state.pageContext);
    const contextText = getPageContextTextForPrompt(state);
    const contextSections = splitContextSections(contextText);
    const chatMarkdown = buildChatMarkdown(state, elements, currentTranslations, { headingOffset: 0 }).trim();

    const hasContext = Object.values(contextSections).some(section => section.trim());
    const hasChat = !!chatMarkdown;

    if (!hasContext && !hasChat && contextStatus !== 'failed') {
        return '';
    }

    const title = pageTitle;
    const lines = [
        '---',
        `title: ${yamlString(title)}`
    ];
    if (pageUrl) lines.push(`source: ${yamlString(pageUrl)}`);
    lines.push(
        `created: ${yamlString(isoDatetime)}`,
        'tool: PageTalk',
        'tags:',
        '  - pagetalk',
        '  - pagetalk-export',
        '---',
        ''
    );

    if (contextSections.article.trim()) {
        lines.push(contextSections.article.trim(), '');
    }

    appendContextSection(lines, 'Comments / Replies', contextSections.comments, 2);
    appendContextSection(lines, 'Manually Selected Page Area', contextSections.manual, 2);

    if (!hasContext) {
        const fallbackKey = contextStatus === 'failed' ? 'obsidianContextFailed' : 'obsidianNoContext';
        lines.push(`_${_tr(fallbackKey)}_`, '');
    }

    if (chatMarkdown) {
        lines.push('# Chat', '');
        lines.push(chatMarkdown, '');
    }

    return `${lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim()}\n`;
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

export function readObsidianExportSettingsFromElements(elements, state) {
    const existing = normalizeObsidianExportSettings(state.obsidianExportSettings);
    return normalizeObsidianExportSettings({
        vault: elements.obsidianVaultInput?.value?.trim() ?? existing.vault,
        folder: elements.obsidianFolderInput?.value?.trim() ?? existing.folder,
        noteNameTemplate: elements.obsidianNoteNameInput?.value?.trim() ?? existing.noteNameTemplate,
        silentOpen: elements.obsidianSilentOpenToggle?.checked ?? existing.silentOpen
    });
}

export function applyObsidianExportSettingsToElements(settings, elements) {
    const normalized = normalizeObsidianExportSettings(settings);
    if (elements.obsidianVaultInput) elements.obsidianVaultInput.value = normalized.vault;
    if (elements.obsidianFolderInput) elements.obsidianFolderInput.value = normalized.folder;
    if (elements.obsidianNoteNameInput) elements.obsidianNoteNameInput.value = normalized.noteNameTemplate;
    if (elements.obsidianSilentOpenToggle) elements.obsidianSilentOpenToggle.checked = normalized.silentOpen;
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

function appendContextSection(lines, title, content, level = 3) {
    const cleanContent = String(content || '').trim();
    if (!cleanContent) return;
    const safeLevel = Math.min(Math.max(Number(level) || 1, 1), 6);
    lines.push(`${'#'.repeat(safeLevel)} ${title}`, '', cleanContent, '');
}

function renderNoteNameTemplate(template, state) {
    const now = new Date();
    const title = state.pageTitle || 'Untitled';
    const url = state.pageUrl || '';

    return sanitizeObsidianFileName(
        String(template || DEFAULT_OBSIDIAN_EXPORT_SETTINGS.noteNameTemplate)
            .replace(/\{title\}/g, title)
            .replace(/\{date\}/g, formatDateToken(now))
            .replace(/\{datetime\}/g, formatDateTimeToken(now))
            .replace(/\{url\}/g, url)
    );
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
