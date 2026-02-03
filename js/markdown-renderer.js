/**
 * Markdown渲染器 - 使用markdown-it库
 */

// 防止重复初始化
if (window.markdownRendererInitialized) {
    console.log('[MarkdownRenderer] Already initialized, skipping...');
} else {
    window.markdownRendererInitialized = true;

// 初始化markdown-it实例
let markdownRenderer = window.markdownRenderer || null;

// 初始化渲染器
function initMarkdownRenderer() {
    // 确保markdown-it已加载
    if (typeof window.markdownit === 'undefined') {
        console.error('markdown-it 库未加载');
        return false;
    }

    // 创建markdown-it实例，使用更适合聊天应用的配置
    markdownRenderer = window.markdownit({
        html: false,        // 禁用HTML标签，更安全
        xhtmlOut: false,    // 禁用XHTML输出
        breaks: true,       // 将\n转换为<br>，适合聊天应用
        linkify: true,      // 自动转换URL为链接
        typographer: true,  // 启用一些语言中性的替换和引号美化
        highlight: function(str, lang) {
            // --- Mermaid ---
            if (lang && lang.toLowerCase() === 'mermaid') {
                // Don't highlight mermaid code blocks, just wrap them for Mermaid library
                // We still escape the content just in case, though Mermaid might handle it.
                // Let's return the raw string as Mermaid expects it.
                return `<pre class="mermaid">${str}</pre>`;
            }
            // --- End Mermaid ---

            const code = str; // Keep original code reference
            const encodedCode = btoa(encodeURIComponent(code)); // Encode for data-code

            // Determine language class first, default to plaintext
            const langClass = lang ? `language-${lang}` : 'language-plaintext';
            let highlightedCode = escapeHtml(code); // Default to escaped code

            // Attempt highlighting only if hljs is available AND language is supported
            if (lang && typeof window.hljs !== 'undefined' && hljs.getLanguage(lang)) {
                try {
                    highlightedCode = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
                } catch (e) {
                    console.error(`Highlight.js error for language ${lang}:`, e);
                    // highlightedCode remains the escaped version
                }
            } else if (lang && typeof window.hljs !== 'undefined' && !hljs.getLanguage(lang)) {
                 // hljs is loaded, but language is not supported (like mermaid)
                 // Keep highlightedCode as escaped version, langClass is already set correctly
                 // console.warn(`Highlight.js language "${lang}" not loaded or supported. Rendering as plain text within language block.`);
            } else if (typeof window.hljs === 'undefined') {
                 // hljs not loaded at all
                 // console.warn('Highlight.js not loaded. Rendering code blocks as plain text.');
                 // highlightedCode remains escaped, langClass is set based on lang presence
            }

            // Return the structure with data-code and highlighted (or escaped) code
            // Ensure the class includes 'hljs' for potential styling hooks if needed,
            // and keep the original 'code-block' for existing styles/JS.
            return `<pre class="code-block hljs ${langClass}" data-code="${encodedCode}"><code>${highlightedCode}</code></pre>`;
        }
    });

    // 自定义渲染器设置
    customizeRenderer();
    
    return true;
}

// 自定义markdown-it渲染器
function customizeRenderer() {
    if (!markdownRenderer) return;
    
    // 获取默认链接渲染器
    const defaultLinkRender = markdownRenderer.renderer.rules.link_open || function(tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
    };

    // 自定义链接渲染，添加target="_blank"和安全属性
    markdownRenderer.renderer.rules.link_open = function(tokens, idx, options, env, self) {
        // 添加target="_blank"到所有链接
        const aIndex = tokens[idx].attrIndex('target');
        if (aIndex < 0) {
            tokens[idx].attrPush(['target', '_blank']);
            tokens[idx].attrPush(['rel', 'noopener noreferrer']);
        } else {
            tokens[idx].attrs[aIndex][1] = '_blank';
        }

        // 默认渲染
        return defaultLinkRender(tokens, idx, options, env, self);
    };
    
    // 自定义表格渲染器，添加表格容器
    const defaultTableRender = markdownRenderer.renderer.rules.table_open || function(tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
    };
    
    markdownRenderer.renderer.rules.table_open = function(tokens, idx, options, env, self) {
        // 在表格外层添加容器div
        return '<div class="table-container">' + defaultTableRender(tokens, idx, options, env, self);
    };
    
    // 自定义表格关闭标签渲染器
    const defaultTableCloseRender = markdownRenderer.renderer.rules.table_close || function(tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
    };
    
    markdownRenderer.renderer.rules.table_close = function(tokens, idx, options, env, self) {
        // 关闭表格容器div
        return defaultTableCloseRender(tokens, idx, options, env, self) + '</div>';
    };
}

// 渲染Markdown为HTML
function renderMarkdown(content) {
    // 确保渲染器已初始化
    if (!markdownRenderer && !initMarkdownRenderer()) {
        // 如果无法初始化渲染器，使用简单的HTML转义
        return `<p>${escapeHtml(content)}</p>`;
    }

    // 预处理内容，确保空行被正确处理
    const processedContent = preprocessContent(content);

    // 使用markdown-it渲染
    let html = markdownRenderer.render(processedContent);

    // 对渲染后的HTML进行后处理
    html = postprocessHtml(html);

    return html;
}

// 临时存储数学公式的映射表
let mathFormulasMap = new Map();
let mathFormulaCounter = 0;
// 临时存储代码块的映射表
let codeBlocksMap = new Map();
let codeBlockCounter = 0;
// 临时存储思考块的映射表
let thinkBlocksMap = new Map();
let thinkBlockCounter = 0;

// 对内容进行预处理，处理特殊情况
function preprocessContent(content) {
    // 规范化换行符
    let processedContent = content.replace(/\r\n/g, '\n');

    // 处理连续的三个或更多换行符，避免过多空白
    processedContent = processedContent.replace(/\n{3,}/g, '\n\n');

    // 第零步：保护 <think>...</think> 标签，防止被 markdown-it 处理
    // 支持跨行匹配
    processedContent = processedContent.replace(/<think>([\s\S]*?)<\/think>/gi, (match, thinkContent) => {
        const placeholder = `%%THINK_BLOCK_${thinkBlockCounter}%%`;
        thinkBlocksMap.set(placeholder, thinkContent);
        thinkBlockCounter++;
        return placeholder;
    });

    // 第一步：先保护代码块，防止其中的 $ 被误匹配为数学公式
    // 保护围栏代码块 ```...```
    processedContent = processedContent.replace(/```[\s\S]*?```/g, (match) => {
        const placeholder = `%%CODE_FENCE_${codeBlockCounter}%%`;
        codeBlocksMap.set(placeholder, match);
        codeBlockCounter++;
        return placeholder;
    });
    // 保护行内代码 `...`
    processedContent = processedContent.replace(/`[^`\n]+`/g, (match) => {
        const placeholder = `%%CODE_INLINE_${codeBlockCounter}%%`;
        codeBlocksMap.set(placeholder, match);
        codeBlockCounter++;
        return placeholder;
    });
    
    // 第二步：保护数学公式，防止 markdown-it 的 breaks:true 插入 <br> 破坏公式结构
    // 先处理块级公式 $$...$$（可能跨多行）
    processedContent = processedContent.replace(/\$\$([\s\S]*?)\$\$/g, (match) => {
        const placeholder = `%%MATH_BLOCK_${mathFormulaCounter}%%`;
        mathFormulasMap.set(placeholder, match);
        mathFormulaCounter++;
        return placeholder;
    });
    
    // 再处理行内公式 $...$（不跨行）
    processedContent = processedContent.replace(/\$([^\$\n]+?)\$/g, (match) => {
        const placeholder = `%%MATH_INLINE_${mathFormulaCounter}%%`;
        mathFormulasMap.set(placeholder, match);
        mathFormulaCounter++;
        return placeholder;
    });
    
    // 第三步：恢复代码块（在 markdown-it 处理之前恢复，让 markdown-it 正常处理代码块）
    codeBlocksMap.forEach((code, placeholder) => {
        processedContent = processedContent.split(placeholder).join(code);
    });
    codeBlocksMap.clear();
    codeBlockCounter = 0;
    
    return processedContent;
}

// 恢复被保护的数学公式，同时尝试直接渲染成 KaTeX HTML
function restoreMathFormulas(html) {
    let result = html;
    mathFormulasMap.forEach((formula, placeholder) => {
        let replacement = formula; // 默认恢复原始公式

        // 尝试直接渲染 LaTeX
        if (typeof window.katex !== 'undefined') {
            try {
                // 提取公式内容和类型
                let latex = '';
                let displayMode = false;

                if (formula.startsWith('$$') && formula.endsWith('$$')) {
                    // 块级公式
                    latex = formula.slice(2, -2).trim();
                    displayMode = true;
                } else if (formula.startsWith('$') && formula.endsWith('$')) {
                    // 行内公式
                    latex = formula.slice(1, -1).trim();
                    displayMode = false;
                }

                if (latex) {
                    // 使用 KaTeX 渲染
                    const rendered = window.katex.renderToString(latex, {
                        displayMode: displayMode,
                        throwOnError: false,
                        output: 'html'
                    });
                    // 包装在 span 中，添加适当的类
                    const wrapperClass = displayMode ? 'katex-display' : 'katex-inline';
                    replacement = `<span class="${wrapperClass}">${rendered}</span>`;
                }
            } catch (e) {
                // 渲染失败时保留原始公式，让后续的 renderMathInElement 处理
                replacement = formula;
            }
        }

        result = result.split(placeholder).join(replacement);
    });
    // 清空映射表准备下次使用
    mathFormulasMap.clear();
    mathFormulaCounter = 0;
    return result;
}

// 恢复被保护的思考块，包装成可折叠的 UI 组件
function restoreThinkBlocks(html) {
    let result = html;
    thinkBlocksMap.forEach((thinkContent, placeholder) => {
        // 对思考内容进行 Markdown 渲染（递归调用，但不会再匹配到 think 标签）
        let renderedThinkContent = thinkContent.trim();

        // 如果 markdownRenderer 可用，渲染思考内容
        if (markdownRenderer) {
            try {
                renderedThinkContent = markdownRenderer.render(renderedThinkContent);
            } catch (e) {
                // 渲染失败时使用转义后的原始内容
                renderedThinkContent = `<p>${escapeHtml(thinkContent)}</p>`;
            }
        } else {
            renderedThinkContent = `<p>${escapeHtml(thinkContent)}</p>`;
        }

        // 包装成可折叠的 HTML 结构
        const thinkBlockHtml = `<div class="thinking-block collapsed">
  <div class="thinking-header">
    <svg class="thinking-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
    </svg>
    <span class="thinking-label" data-i18n="thinkingProcess">思考过程</span>
    <svg class="thinking-toggle-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  </div>
  <div class="thinking-content">${renderedThinkContent}</div>
</div>`;

        result = result.split(placeholder).join(thinkBlockHtml);
    });
    // 清空映射表准备下次使用
    thinkBlocksMap.clear();
    thinkBlockCounter = 0;
    return result;
}

// 对渲染后的HTML进行后处理
function postprocessHtml(html) {
    // 恢复被保护的思考块
    html = restoreThinkBlocks(html);

    // 恢复被保护的数学公式
    html = restoreMathFormulas(html);

    // 为代码块添加复制按钮的位置
    html = html.replace(/<pre class="code-block/g,
                         '<pre class="code-block code-block-with-copy');

    // 添加markdown-rendered类，方便CSS选择器定位
    html = '<div class="markdown-rendered">' + html + '</div>';

    return html;
}

// 仅渲染行内Markdown（不包含段落标签）
function renderMarkdownInline(content) {
    // 确保渲染器已初始化
    if (!markdownRenderer && !initMarkdownRenderer()) {
        return escapeHtml(content);
    }

    return markdownRenderer.renderInline(content);
}

// HTML转义辅助函数
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// 导出函数
window.MarkdownRenderer = {
    render: renderMarkdown,
    renderInline: renderMarkdownInline,
    escapeHtml: escapeHtml
};

// 保存markdownRenderer实例到window对象，防止重复声明
window.markdownRenderer = markdownRenderer;

} // 结束防重复初始化检查
