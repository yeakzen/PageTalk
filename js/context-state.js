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
    return hasUsablePageContext(stateRef?.pageContext) ? stateRef.pageContext : '';
}

export function getPageContextCharCount(pageContext) {
    return hasUsablePageContext(pageContext) ? pageContext.length : 0;
}
