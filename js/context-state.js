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
    if (stateRef?.removeContextWebLinks === false) return contextText;
    return stripWebLinksFromContextText(contextText);
}

export function stripWebLinksFromContextText(text) {
    if (typeof text !== 'string' || text === '') return '';

    return text
        .replace(/!\[([^\]]*)\]\(\s*https?:\/\/[^)\s]+(?:\s+"[^"]*")?\s*\)/gi, '$1')
        .replace(/!\[([^\]]*)\]\(\s*www\.[^)\s]+(?:\s+"[^"]*")?\s*\)/gi, '$1')
        .replace(/\[([^\]]+)\]\(\s*https?:\/\/[^)\s]+(?:\s+"[^"]*")?\s*\)/gi, '$1')
        .replace(/\[([^\]]+)\]\(\s*www\.[^)\s]+(?:\s+"[^"]*")?\s*\)/gi, '$1')
        .replace(/<https?:\/\/[^>\s]+>/gi, '')
        .replace(/<www\.[^>\s]+>/gi, '')
        .replace(/\bhttps?:\/\/[^\s<>)\]}]+/gi, '')
        .replace(/\bwww\.[^\s<>)\]}]+/gi, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
