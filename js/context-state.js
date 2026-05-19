export function hasUsablePageContext(pageContext) {
    return typeof pageContext === 'string' && pageContext.trim() !== '' && pageContext !== 'error';
}

export function getPageContextStatus(pageContext) {
    if (pageContext === null) return 'extracting';
    if (pageContext === 'error') return 'failed';
    if (hasUsablePageContext(pageContext)) return 'ready';
    return 'none';
}

export function getPageContextTextForPrompt(stateRef) {
    return sanitizeContextTextForPrompt(stateRef?.pageContext, stateRef);
}

export function getPageContextCharCount(pageContext) {
    return hasUsablePageContext(pageContext) ? pageContext.length : 0;
}

export function sanitizeContextTextForPrompt(contextText, stateRef) {
    if (typeof contextText !== 'string' || contextText.trim() === '' || contextText === 'error') return '';
    let sanitized = contextText;
    if (stateRef?.removeContextWebLinks !== false) {
        sanitized = stripWebLinksFromContextText(sanitized);
    }
    if (stateRef?.removeContextSitePaths !== false) {
        sanitized = stripSitePathsFromContextText(sanitized);
    }
    return sanitized;
}

export function stripWebLinksFromContextText(text) {
    if (typeof text !== 'string' || text === '') return '';

    const stripped = text
        .replace(/!\[([^\]]*)\]\(\s*https?:\/\/[^)\s]+(?:\s+"[^"]*")?\s*\)/gi, '$1')
        .replace(/!\[([^\]]*)\]\(\s*www\.[^)\s]+(?:\s+"[^"]*")?\s*\)/gi, '$1')
        .replace(/\[\s*\]\(\s*https?:\/\/[^)\s]+(?:\s+"[^"]*")?\s*\)/gi, '')
        .replace(/\[\s*\]\(\s*www\.[^)\s]+(?:\s+"[^"]*")?\s*\)/gi, '')
        .replace(/\[([^\]]+)\]\(\s*https?:\/\/[^)\s]+(?:\s+"[^"]*")?\s*\)/gi, '$1')
        .replace(/\[([^\]]+)\]\(\s*www\.[^)\s]+(?:\s+"[^"]*")?\s*\)/gi, '$1')
        .replace(/<https?:\/\/[^>\s]+>/gi, '')
        .replace(/<www\.[^>\s]+>/gi, '')
        .replace(/\bhttps?:\/\/[^\s<>)\]}]+/gi, '')
        .replace(/\bwww\.[^\s<>)\]}]+/gi, '')
        .replace(/\[\s*\]/g, '')
        .replace(/【\s*】/g, '');

    return cleanupLinkRemovalResidue(stripped);
}

export function stripSitePathsFromContextText(text) {
    if (typeof text !== 'string' || text === '') return '';

    const stripped = text
        .replace(/!\[([^\]]*)\]\(\s*\/[^)\s]+(?:\s+"[^"]*")?\s*\)/g, '$1')
        .replace(/\[([^\]]+)\]\(\s*\/[^)\s]+(?:\s+"[^"]*")?\s*\)/g, '$1')
        .replace(/\(\s*\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+\s*\)/g, '')
        .replace(/(?<!\S)\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/g, '');

    return cleanupLinkRemovalResidue(stripped);
}

function cleanupLinkRemovalResidue(text) {
    return text
        .replace(/^[ \t]*[\[\]【】]+[ \t]*$/gm, '')
        .replace(/^[ \t]*\d[\d,，.]*[ \t]*$/gm, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
