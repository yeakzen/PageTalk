/**
 * Pagetalk - Chat Core Logic
 */
import { generateUniqueId } from './utils.js';
import { tr as _ } from './utils/i18n.js';
import { resetBotMessageHeadingColors, updateBotMessageTopHeading, postProcessBotMessageContent, applyBotMessageHeadingColor } from './ui.js';

// 使用 utils/i18n.js 提供的 tr 作为翻译函数

const MULTI_MODEL_STREAM_RENDER_INTERVAL_MS = 120;

// 供应商图标映射
const providerIconMap = {
    'Google': 'Gemini.svg',
    'Anthropic': 'Claude.svg',
    'OpenAI': 'OpenAI.svg',
    'DeepSeek': 'DeepSeek.svg',
    'OpenRouter': 'OpenRouter.svg',
    'SiliconFlow': 'SiliconFlow.svg',
    'Groq': 'groq.svg',
    'Cerebras': 'cerebras.svg',
    'Ollama': 'ollama.svg',
    'LMStudio': 'lmstudio.svg',
    'ChatGLM': 'ChatGLM.svg',
    'ModelScope': 'modelscope.svg',
    'Vercel': 'vercel.svg'
};

function isMultiModelRenderDebugEnabled() {
    return typeof window !== 'undefined' && window.PageTalkDebugMultiModelRender === true;
}

function getPerformanceNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function logMultiModelRenderMetric(label, details) {
    if (!isMultiModelRenderDebugEnabled()) return;
    const suffix = Object.entries(details)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ');
    console.debug(`[${label}] ${suffix}`);
}

function createMultiModelStreamRenderScheduler({ modelId, messageContent, elements, state, label }) {
    let pendingContent = null;
    let lastRenderedContent = null;
    let lastRenderAt = 0;
    let timeoutId = null;
    let animationFrameId = null;
    let renderCount = 0;
    let totalDuration = 0;
    let disposed = false;

    function clearScheduledRender() {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        if (animationFrameId !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    }

    function scrollIfNeeded() {
        if (!state.userScrolledUpDuringStream) {
            elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
        }
    }

    function renderContent(content, phase) {
        if (disposed || content === null || content === undefined) return;
        if (content === lastRenderedContent && phase !== 'final') return;

        const start = getPerformanceNow();
        const formattedContent = window.MarkdownRenderer.render(content);
        messageContent.innerHTML = formattedContent;
        updateBotMessageTopHeading(messageContent);
        scrollIfNeeded();

        const duration = getPerformanceNow() - start;
        renderCount++;
        totalDuration += duration;
        lastRenderAt = getPerformanceNow();
        lastRenderedContent = content;
        pendingContent = null;

        logMultiModelRenderMetric(label, {
            modelId,
            phase,
            renderCount,
            duration: duration.toFixed(1),
            totalDuration: totalDuration.toFixed(1),
            chars: content.length
        });
    }

    function renderPending(phase) {
        const content = pendingContent;
        if (content === null || content === undefined) return;
        renderContent(content, phase);
    }

    function scheduleTimer(delay) {
        if (timeoutId !== null || animationFrameId !== null) return;
        timeoutId = setTimeout(() => {
            timeoutId = null;
            if (typeof requestAnimationFrame === 'function') {
                animationFrameId = requestAnimationFrame(() => {
                    animationFrameId = null;
                    renderPending('stream');
                });
            } else {
                renderPending('stream');
            }
        }, delay);
    }

    return {
        schedule(content) {
            if (disposed) return;
            pendingContent = content;

            if (!lastRenderAt) {
                renderPending('stream');
                return;
            }

            const elapsed = getPerformanceNow() - lastRenderAt;
            const delay = Math.max(0, MULTI_MODEL_STREAM_RENDER_INTERVAL_MS - elapsed);
            scheduleTimer(delay);
        },
        flush(content, phase = 'final') {
            if (disposed) return;
            if (content !== undefined && content !== '') {
                pendingContent = content;
            }
            clearScheduledRender();
            renderPending(phase);
        },
        cancel() {
            clearScheduledRender();
            pendingContent = null;
            disposed = true;
            logMultiModelRenderMetric(label, {
                modelId,
                phase: 'cancel',
                renderCount,
                totalDuration: totalDuration.toFixed(1)
            });
        }
    };
}

function normalizeTabId(tabId) {
    if (tabId === undefined || tabId === null || tabId === '') return null;
    const numericId = Number(tabId);
    return Number.isFinite(numericId) ? numericId : tabId;
}

function normalizeUrlForCompare(url) {
    if (!url || typeof url !== 'string') return '';
    try {
        const parsedUrl = new URL(url);
        parsedUrl.hash = '';
        return parsedUrl.href;
    } catch (_) {
        return url.split('#')[0];
    }
}

function isRestrictedTabUrl(url) {
    if (!url || typeof url !== 'string') return true;
    return url.startsWith('chrome://')
        || url.startsWith('about:')
        || url.startsWith('edge://')
        || url.startsWith(`chrome-extension://${chrome.runtime.id}`);
}

function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                resolve({ error: chrome.runtime.lastError.message });
                return;
            }
            resolve(response || {});
        });
    });
}

async function findOpenTabForSavedContext(savedTab) {
    const savedTabId = normalizeTabId(savedTab?.id);
    if (savedTabId !== null) {
        try {
            const tab = await chrome.tabs.get(savedTabId);
            if (tab?.id && !isRestrictedTabUrl(tab.url)) {
                return tab;
            }
        } catch (_) {
            // original tab may be gone, fall back to URL match
        }
    }

    const targetUrl = normalizeUrlForCompare(savedTab?.url);
    if (!targetUrl) return null;

    try {
        const tabs = await chrome.tabs.query({});
        return tabs.find(tab => (
            tab?.id
            && !isRestrictedTabUrl(tab.url)
            && normalizeUrlForCompare(tab.url) === targetUrl
        )) || null;
    } catch (error) {
        console.warn('[ContextHydration] Failed to query tabs:', error);
        return null;
    }
}

async function extractContextFromTab(tabId) {
    const response = await sendRuntimeMessage({ action: 'extractTabContent', tabId });
    if (response?.content && !response.error) {
        return response;
    }
    return null;
}

async function hydrateContextTabsForApi(contextTabs, showToastCallback, currentTranslations) {
    if (!Array.isArray(contextTabs) || contextTabs.length === 0) {
        return [];
    }

    const hydrateOneContextTab = async (tab) => {
        if (tab?.content) {
            return { tab, failed: false };
        }

        const openTab = await findOpenTabForSavedContext(tab);
        if (!openTab?.id) {
            console.warn('[ContextHydration] Could not find open tab for saved context:', tab);
            return { tab: null, failed: true };
        }

        const extracted = await extractContextFromTab(openTab.id);
        if (!extracted?.content) {
            console.warn('[ContextHydration] Could not extract context from tab:', openTab.id, extracted);
            return { tab: null, failed: true };
        }

        return {
            failed: false,
            tab: {
                ...tab,
                id: openTab.id,
                title: tab.title || extracted.pageTitle || openTab.title || '',
                url: tab.url || extracted.pageUrl || openTab.url || '',
                favIconUrl: tab.favIconUrl || openTab.favIconUrl || '',
                content: extracted.content
            }
        };
    };

    const results = await Promise.all(contextTabs.map(hydrateOneContextTab));
    const hydratedTabs = results
        .map(result => result.tab)
        .filter(Boolean);
    const failedCount = results.filter(result => result.failed).length;

    if (failedCount > 0 && typeof showToastCallback === 'function') {
        showToastCallback(`有 ${failedCount} 个历史 @ 页面未打开或无法重新读取，将跳过这些上下文。`, 'warning');
    }

    return hydratedTabs;
}

/**
 * 获取模型信息
 * @param {string} modelValue - 模型值
 * @param {object} elements - DOM elements
 * @returns {object|null} 模型信息
 */
function getModelInfo(modelValue, elements) {
    const select = elements.chatModelSelection;
    if (!select) return null;

    const option = select.querySelector(`option[value="${modelValue}"]`);
    if (!option) return null;

    const optgroup = option.parentElement;
    const providerName = optgroup && optgroup.tagName === 'OPTGROUP' ? optgroup.label : '';
    const iconFile = providerIconMap[providerName];

    return {
        modelId: modelValue,
        displayName: option.textContent,
        providerName,
        iconFile
    };
}

/**
 * Sends a user message and initiates the AI response process.
 * @param {object} state - Global state reference
 * @param {object} elements - DOM elements reference
 * @param {object} currentTranslations - Translations object
 * @param {function} showConnectionStatusCallback - Callback for model settings status
 * @param {function} addMessageToChatCallback - Callback (this is main.js#addMessageToChatUI)
 * @param {function} addThinkingAnimationCallback - Callback (this is a lambda from main.js calling ui.js#addThinkingAnimation with live isUserNearBottom)
 * @param {function} resizeTextareaCallback - Callback
 * @param {function} clearImagesCallback - Callback
 * @param {function} clearVideosCallback - Callback
 * @param {function} showToastCallback - Callback
 * @param {function} restoreSendButtonAndInputCallback - Callback
 * @param {function} [updateSelectedTabsBarCallback] - Optional callback to update selected tabs bar UI
 */
export async function sendUserMessage(state, elements, currentTranslations, showConnectionStatusCallback, addMessageToChatCallback, addThinkingAnimationCallback, resizeTextareaCallback, clearImagesCallback, clearVideosCallback, showToastCallback, restoreSendButtonAndInputCallback, updateSelectedTabsBarCallback) {
    const userMessage = elements.userInput.value.trim();

    if (state.isStreaming) {
        console.warn("Cannot send message while streaming.");
        // if (showToastCallback) showToastCallback(_('streamingInProgress', {}, currentTranslations), 'warning'); // Commented out as per task
        return;
    }
    if (!userMessage && state.images.length === 0 && state.videos.length === 0 && state.selectedContextTabs.filter(t => t.content && !t.isLoading && !t.isContextSent).length === 0) return;

    // 检查是否有任何供应商配置了 API Key
    let hasValidApiKey = false;
    if (window.ModelManager?.instance) {
        try {
            await window.ModelManager.instance.initialize();
            const modelConfig = window.ModelManager.instance.getModelApiConfig(state.model);
            const providerId = modelConfig.providerId;
            hasValidApiKey = window.ModelManager.instance.isProviderConfigured(providerId);
        } catch (error) {
            console.warn('[Chat] Failed to check provider configuration:', error);
        }
    }

    if (!hasValidApiKey) {
        // Show API key missing error as a toast on the chat page (首页下方)
        if (showToastCallback) showToastCallback(_('apiKeyMissingError', {}, currentTranslations), 'error');
        return;
    }

    // --- Start Streaming State ---
    state.isStreaming = true;
    state.userScrolledUpDuringStream = false; // 重置滚动标记
    elements.sendMessage.classList.add('stop-streaming');
    const stopTitle = _('stopStreamingTitle', {}, currentTranslations);
    elements.sendMessage.title = stopTitle;
    elements.sendMessage.setAttribute('aria-label', stopTitle);
    // --- End Streaming State ---

    const currentImages = [...state.images]; // Copy images for this message
    const currentVideos = [...state.videos]; // Copy videos for this message

    // 准备在用户消息气泡中显示的标签页信息
    const tabsForBubbleDisplay = state.selectedContextTabs
        .filter(tab => tab.content && !tab.isLoading && !tab.isContextSent)
        .map(tab => ({
            id: tab.id,
            title: tab.title,
            favIconUrl: tab.favIconUrl
        }));

    // Add user message UI (force scroll ensures it's visible before thinking anim)
    // addMessageToChatCallback (main.js#addMessageToChatUI) handles isUserNearBottom internally
    const userMessageElement = addMessageToChatCallback(userMessage, 'user', { images: currentImages, videos: currentVideos, forceScroll: true, sentContextTabs: tabsForBubbleDisplay });
    const userMessageId = userMessageElement.dataset.messageId;

    elements.userInput.value = '';
    resizeTextareaCallback(); // Adjust textarea height
    
    // Update custom caret position after programmatic value change
    if (window.updateCometCaret) window.updateCometCaret();

    // --- 立即标记已选标签页为已发送并更新UI ---
    let contextTabsForApi = [];
    if (state.selectedContextTabs && state.selectedContextTabs.length > 0) {
        const tabsToSendNow = state.selectedContextTabs.filter(
            tab => tab.content && !tab.isLoading && !tab.isContextSent
        );

        if (tabsToSendNow.length > 0) {
            // Ensure contextTabsForApi includes id, title, and content
            contextTabsForApi = tabsToSendNow.map(tab => ({ id: tab.id, title: tab.title, url: tab.url, content: tab.content }));

            tabsToSendNow.forEach(tabSent => {
                const originalTab = state.selectedContextTabs.find(t => t.id === tabSent.id);
                if (originalTab) {
                    originalTab.isContextSent = true;
                }
            });

            state.selectedContextTabs = state.selectedContextTabs.filter(tab => !tab.isContextSent);
            
            if (updateSelectedTabsBarCallback) {
                updateSelectedTabsBarCallback(); // 立即更新UI
            }
        }
    }
    // --- 结束处理标签页逻辑 ---

    // Build message parts
    const currentParts = [];
    if (userMessage) currentParts.push({ text: userMessage });
    currentImages.forEach(image => {
        const base64data = image.dataUrl.split(',')[1];
        currentParts.push({ inlineData: { mimeType: image.mimeType, data: base64data } });
    });
    currentVideos.forEach(video => {
        if (video.type === 'youtube') {
            currentParts.push({ fileData: { fileUri: video.url } });
        }
        // 移除本地视频文件处理，只支持 YouTube 视频
    });

    // 准备用户消息对象，但暂时不添加到历史记录中
    // 将在API调用成功后通过onHistoryUpdate回调添加
    const userMessageForHistory = currentParts.length > 0 ? {
        role: 'user',
        parts: currentParts,
        id: userMessageId,
        // 新增：存储随此用户消息发送的上下文标签页
        // contextTabsForApi 包含了 { id, title, content }
        sentContextTabsInfo: contextTabsForApi.length > 0 ? contextTabsForApi : null
    } : null;

    if (!userMessageForHistory) {
        // Should not happen due to initial check, but as a safeguard:
        // Check if thinkingElement exists before trying to remove it
        // This block is before thinkingElement is defined, so this check is not needed here.
        // It's more relevant in the catch block.
        if (userMessageElement && userMessageElement.parentNode) userMessageElement.remove();
        restoreSendButtonAndInputCallback(); // Restore button if nothing was sent
        return;
    }

    if (currentImages.length > 0) {
        clearImagesCallback(); // This callback clears state.images and updates the UI
    }
    if (currentVideos.length > 0) {
        clearVideosCallback(); // This callback clears state.videos and updates the UI
    }

    // 获取选中的模型列表
    const selectedModels = state.selectedModels && state.selectedModels.length > 0
        ? state.selectedModels
        : [state.model];

    // 判断是单模型还是多模型
    const isMultiModel = selectedModels.length > 1;

    if (isMultiModel) {
        // ========== 多模型并行调用 ==========
        await sendMultiModelMessage(
            userMessage,
            currentImages,
            currentVideos,
            userMessageForHistory,
            contextTabsForApi,
            selectedModels,
            state,
            elements,
            currentTranslations,
            addMessageToChatCallback,
            showToastCallback,
            restoreSendButtonAndInputCallback
        );
    } else {
        // ========== 单模型调用（保持原有逻辑） ==========
        // Call the addThinkingAnimationCallback passed from main.js.
        // It uses elements from main.js's scope and captures the live isUserNearBottom.
        // It expects only the element to insert after (or null).
        const thinkingElement = addThinkingAnimationCallback(null);

        try {
            // Prepare API callbacks object
            const apiUiCallbacks = {
                // addMessageToChatCallback is main.js#addMessageToChatUI, which correctly uses live isUserNearBottom
                addMessageToChat: addMessageToChatCallback,
                // These now call the wrappers on `window` (defined in main.js) which use live isUserNearBottom from main.js
                updateStreamingMessage: (el, content) => window.updateStreamingMessage(el, content),
                finalizeBotMessage: (el, content) => {
                    window.finalizeBotMessage(el, content);
                    // 此处不再需要处理 selectedContextTabs 的逻辑，已提前处理
                },
                showToast: showToastCallback,
                restoreSendButtonAndInput: restoreSendButtonAndInputCallback // Add this callback
            };

            // Call API，传递用户消息对象以便API模块添加到历史记录
            await window.GeminiAPI.callGeminiAPIWithImages(
                userMessage,
                currentImages, // Use the copied currentImages
                currentVideos, // Use the copied currentVideos
                thinkingElement,
                state, // Pass full state reference
                apiUiCallbacks, // Pass callbacks object
                contextTabsForApi, // <--- Pass the prepared context tabs
                userMessageForHistory // <--- Pass user message object for history
            );
            // finalizeBotMessage (called by API module on success) will restore button state

        } catch (error) {
            console.error('Error during sendUserMessage API call:', error);
            if (thinkingElement && thinkingElement.parentNode) thinkingElement.remove();

            // 如果API调用失败，需要从历史记录中移除刚刚添加的用户消息
            if (userMessageForHistory) {
                const messageIndex = state.chatHistory.findIndex(msg => msg.id === userMessageForHistory.id);
                if (messageIndex !== -1) {
                    state.chatHistory.splice(messageIndex, 1);
                    console.log(`Removed failed user message from history`);
                }
            }

            // Add error message to chat (don't force scroll)
            // addMessageToChatCallback already handles isUserNearBottom correctly
            // addMessageToChatCallback(_('apiCallFailed', { error: error.message }, currentTranslations), 'bot', {}); // Commented out as per task
            restoreSendButtonAndInputCallback(); // Restore button on error
        }
    }
}

/**
 * 多模型并行调用
 */
async function sendMultiModelMessage(
    userMessage,
    currentImages,
    currentVideos,
    userMessageForHistory,
    contextTabsForApi,
    selectedModels,
    state,
    elements,
    currentTranslations,
    addMessageToChatCallback,
    showToastCallback,
    restoreSendButtonAndInputCallback
) {
    // 获取模型信息
    let modelInfos = selectedModels
        .map(modelId => getModelInfo(modelId, elements))
        .filter(info => info !== null);

    // 按历史多模型响应的顺序重新排列，保持展示顺序一致
    modelInfos = reorderModelInfosByHistory(modelInfos, state.chatHistory);

    if (modelInfos.length === 0) {
        console.error('[MultiModel] No valid model info found');
        restoreSendButtonAndInputCallback();
        return;
    }

    // 先显示统一的 thinking 动画
    const thinkingElement = document.createElement('div');
    thinkingElement.classList.add('message', 'bot-message', 'thinking');
    const thinkingDots = document.createElement('div');
    thinkingDots.classList.add('thinking-dots');
    for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        thinkingDots.appendChild(dot);
    }
    thinkingElement.appendChild(thinkingDots);
    elements.chatMessages.appendChild(thinkingElement);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;

    // 创建多模型响应容器（但先不添加到 DOM）
    const container = document.createElement('div');
    container.className = 'multi-model-response-container';
    container.dataset.messageId = generateUniqueId();

    modelInfos.forEach((modelInfo, modelIndex) => {
        const column = document.createElement('div');
        column.className = 'bot-message-column';
        column.dataset.modelId = modelInfo.modelId;

        // 模型名称标签
        const modelLabel = document.createElement('div');
        modelLabel.className = 'model-response-label';

        // 供应商图标
        if (modelInfo.iconFile) {
            const icon = document.createElement('img');
            icon.src = `../icons/${modelInfo.iconFile}`;
            icon.alt = modelInfo.providerName;
            icon.className = 'provider-icon-img';
            modelLabel.appendChild(icon);
        }

        // 模型名称
        const nameSpan = document.createElement('span');
        nameSpan.className = 'model-name';
        nameSpan.textContent = modelInfo.displayName;
        nameSpan.title = modelInfo.displayName;
        modelLabel.appendChild(nameSpan);

        column.appendChild(modelLabel);

        // 消息内容区域（初始为空）
        const messageContent = document.createElement('div');
        messageContent.className = 'bot-message';
        messageContent.dataset.modelId = modelInfo.modelId;
        applyBotMessageHeadingColor(messageContent, modelIndex);

        column.appendChild(messageContent);
        container.appendChild(column);
    });

    // 添加用户消息到历史记录
    if (userMessageForHistory) {
        state.chatHistory.push(userMessageForHistory);
    }

    // 跟踪完成的模型数量
    let completedCount = 0;
    const totalModels = modelInfos.length;

    // 存储每个模型的响应内容
    const modelResponses = {};

    // 标记是否已显示容器
    let containerShown = false;

    // 显示多模型容器（移除 thinking 动画）
    function showContainer() {
        if (!containerShown) {
            containerShown = true;
            // 移除 thinking 动画
            if (thinkingElement && thinkingElement.parentNode) {
                thinkingElement.remove();
            }
            // 添加多模型容器
            elements.chatMessages.appendChild(container);
            elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
        }
    }

    // 并行调用所有模型
    const promises = modelInfos.map(async (modelInfo, modelIndex) => {
        const modelId = modelInfo.modelId;
        let renderScheduler = null;

        try {
            // 创建临时状态，使用当前模型
            const allSelectedModelIds = modelInfos.map(info => info.modelId);
            const tempState = {
                ...state,
                model: modelId,
                chatHistory: buildModelSpecificHistory(state.chatHistory, modelId, allSelectedModelIds)
            };

            // 获取对应列的消息内容区域
            const column = container.querySelector(`.bot-message-column[data-model-id="${modelId}"]`);
            const messageContent = column?.querySelector('.bot-message');

            if (!messageContent) {
                throw new Error('Message content element not found');
            }

            // 为 messageContent 添加 messageId（API 需要）
            const messageId = generateUniqueId();
            messageContent.dataset.messageId = messageId;
            applyBotMessageHeadingColor(messageContent, modelIndex);

            // 累积的响应内容
            let accumulatedContent = '';
            let hasReceivedFirstChunk = false;
            let modelSettled = false;
            renderScheduler = createMultiModelStreamRenderScheduler({
                modelId,
                messageContent,
                elements,
                state,
                label: 'MultiModelRender'
            });

            // 创建针对该模型的 UI 回调
            const modelUiCallbacks = {
                addMessageToChat: (content, sender, options) => {
                    // 返回已创建的元素，API 会用这个元素来更新内容
                    return messageContent;
                },
                updateStreamingMessage: (el, content) => {
                    accumulatedContent = content;

                    // 第一次收到内容时显示多模型容器
                    if (!hasReceivedFirstChunk) {
                        hasReceivedFirstChunk = true;
                        showContainer(); // 显示容器，移除统一的 thinking 动画
                    }

                    renderScheduler.schedule(content);
                },
                finalizeBotMessage: (el, content) => {
                    if (modelSettled) return;
                    modelSettled = true;
                    accumulatedContent = content || accumulatedContent;
                    modelResponses[modelId] = accumulatedContent;

                    // 确保容器已显示
                    showContainer();

                    renderScheduler.flush(accumulatedContent, 'final');

                    // 添加消息操作按钮（复制、重新生成、删除）
                    if (window.addMessageActionButtons) {
                        window.addMessageActionButtons(messageContent, accumulatedContent);
                    }
                    if (window.addCopyButtonToCodeBlockCallback) {
                        postProcessBotMessageContent(messageContent, window.addCopyButtonToCodeBlockCallback, elements, messageContent.dataset.messageId || messageContent.dataset.modelId);
                    }

                    completedCount++;
                    console.log(`[MultiModel] ${modelId} completed (${completedCount}/${totalModels})`);

                    // 所有模型都完成后恢复按钮状态并添加历史记录
                    if (completedCount >= totalModels) {
                        state.isStreaming = false;
                        restoreSendButtonAndInputCallback();

                        // 将响应添加到历史记录（用于后续对话）
                        // 优先使用第一个成功的模型响应，如果都失败则使用空字符串
                        const firstSuccessfulResponse = modelInfos
                            .map(info => modelResponses[info.modelId])
                            .find(response => response && response.trim() !== '');

                        state.chatHistory.push({
                            role: 'model',
                            parts: [{ text: firstSuccessfulResponse || '' }],
                            id: container.dataset.messageId, // 使用容器的 messageId，确保与 DOM 一致
                            multiModelResponses: modelResponses, // 存储所有模型的响应
                            modelOrder: modelInfos.map(info => info.modelId) // 保存模型顺序
                        });
                        if (userMessageForHistory?.id && typeof window.refreshMessageActionButtonsByMessageId === 'function') {
                            window.refreshMessageActionButtonsByMessageId(userMessageForHistory.id);
                        }
                        if (typeof window.generateFollowUpQuestionsForResponse === 'function') {
                            window.generateFollowUpQuestionsForResponse({
                                userMessageId: userMessageForHistory?.id || '',
                                responseMessageId: container.dataset.messageId
                            });
                        }
                    }
                },
                showToast: showToastCallback,
                restoreSendButtonAndInput: () => {
                    if (modelSettled) return;
                    modelSettled = true;
                    // API 层面发生错误时会调用这个回调
                    renderScheduler.flush(accumulatedContent, 'restore');
                    // 增加完成计数并检查是否所有模型都完成
                    completedCount++;
                    console.log(`[MultiModel] ${modelId} failed/aborted (${completedCount}/${totalModels})`);

                    // 检查 messageContent 是否需要添加操作按钮（错误情况）
                    // 如果 messageContent 存在且没有 message-actions，添加操作按钮
                    if (messageContent && !messageContent.querySelector('.message-actions')) {
                        // 确保 messageContent 有 messageId
                        if (!messageContent.dataset.messageId) {
                            messageContent.dataset.messageId = generateUniqueId();
                        }
                        // 添加操作按钮（重试和删除）
                        if (window.addMessageActionButtons) {
                            window.addMessageActionButtons(messageContent, '');
                        }
                    }

                    if (completedCount >= totalModels) {
                        state.isStreaming = false;
                        restoreSendButtonAndInputCallback();

                        // 检查历史记录是否已添加（可能由 finalizeBotMessage 添加）
                        const historyExists = state.chatHistory.some(msg => msg.id === container.dataset.messageId);
                        if (!historyExists) {
                            // 将响应添加到历史记录
                            const firstSuccessfulResponse = modelInfos
                                .map(info => modelResponses[info.modelId])
                                .find(response => response && response.trim() !== '');

                            state.chatHistory.push({
                                role: 'model',
                                parts: [{ text: firstSuccessfulResponse || '' }],
                                id: container.dataset.messageId,
                                multiModelResponses: modelResponses,
                                modelOrder: modelInfos.map(info => info.modelId)
                            });
                            if (userMessageForHistory?.id && typeof window.refreshMessageActionButtonsByMessageId === 'function') {
                                window.refreshMessageActionButtonsByMessageId(userMessageForHistory.id);
                            }
                            if (typeof window.generateFollowUpQuestionsForResponse === 'function') {
                                window.generateFollowUpQuestionsForResponse({
                                    userMessageId: userMessageForHistory?.id || '',
                                    responseMessageId: container.dataset.messageId
                                });
                            }
                        }
                    }
                }
            };

            // 调用 API
            await window.GeminiAPI.callGeminiAPIWithImages(
                userMessage,
                currentImages,
                currentVideos,
                null, // thinkingElement - 我们已经在容器中创建了
                tempState,
                modelUiCallbacks,
                contextTabsForApi,
                null // 不再传递 userMessageForHistory，已手动添加
            );

        } catch (error) {
            if (renderScheduler) {
                renderScheduler.cancel();
            }
            console.error(`[MultiModel] Error calling ${modelId}:`, error);

            // 确保容器已显示
            showContainer();

            // 显示错误
            const column = container.querySelector(`.bot-message-column[data-model-id="${modelId}"]`);
            const messageContent = column?.querySelector('.bot-message');

            if (messageContent) {
                // 确保 messageContent 有 messageId
                if (!messageContent.dataset.messageId) {
                    messageContent.dataset.messageId = generateUniqueId();
                }

                messageContent.innerHTML = `<div class="error-message" style="color: var(--error-color); padding: 12px;">Error: ${error.message || 'Unknown error'}</div>`;

                // 添加操作按钮（重试和删除）
                if (window.addMessageActionButtons) {
                    window.addMessageActionButtons(messageContent, '');
                }
            }

            // 注意：completedCount 已经在 restoreSendButtonAndInput 回调中增加了
            // 这里不需要再增加，也不需要再检查是否完成
        }
    });

    // 等待所有调用完成
    await Promise.allSettled(promises);

    // 最终清理：确保 thinking 动画被移除，状态被恢复
    if (thinkingElement && thinkingElement.parentNode) {
        thinkingElement.remove();
    }
    // 如果所有模型都失败了（容器从未显示），也需要恢复状态
    if (!containerShown) {
        state.isStreaming = false;
        restoreSendButtonAndInputCallback();
    }
}


/**
 * 多模型并行重新生成
 */
async function regenerateMultiModelMessage(
    userMessageText,
    userImages,
    userVideos,
    contextTabsForApi,
    historyForApi,
    userIndex,
    userMessageElement,
    selectedModels,
    state,
    elements,
    currentTranslations,
    addMessageToChatCallback,
    showToastCallback,
    restoreSendButtonAndInputCallback,
    oldResponseMessageIds = []
) {
    // 获取模型信息
    let modelInfos = selectedModels
        .map(modelId => getModelInfo(modelId, elements))
        .filter(info => info !== null);

    // 按历史多模型响应的顺序重新排列，保持展示顺序一致
    modelInfos = reorderModelInfosByHistory(modelInfos, historyForApi);

    if (modelInfos.length === 0) {
        console.error('[MultiModel Regen] No valid model info found');
        restoreSendButtonAndInputCallback();
        return;
    }

    // 先显示统一的 thinking 动画（插入到用户消息后面）
    const thinkingElement = document.createElement('div');
    thinkingElement.classList.add('message', 'bot-message', 'thinking');
    const thinkingDots = document.createElement('div');
    thinkingDots.classList.add('thinking-dots');
    for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        thinkingDots.appendChild(dot);
    }
    thinkingElement.appendChild(thinkingDots);
    userMessageElement.insertAdjacentElement('afterend', thinkingElement);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;

    // 创建多模型响应容器（但先不添加到 DOM）
    const container = document.createElement('div');
    container.className = 'multi-model-response-container';
    container.dataset.messageId = generateUniqueId();

    modelInfos.forEach((modelInfo, modelIndex) => {
        const column = document.createElement('div');
        column.className = 'bot-message-column';
        column.dataset.modelId = modelInfo.modelId;

        // 模型名称标签
        const modelLabel = document.createElement('div');
        modelLabel.className = 'model-response-label';

        // 供应商图标
        if (modelInfo.iconFile) {
            const icon = document.createElement('img');
            icon.src = `../icons/${modelInfo.iconFile}`;
            icon.alt = modelInfo.providerName;
            icon.className = 'provider-icon-img';
            modelLabel.appendChild(icon);
        }

        // 模型名称
        const nameSpan = document.createElement('span');
        nameSpan.className = 'model-name';
        nameSpan.textContent = modelInfo.displayName;
        nameSpan.title = modelInfo.displayName;
        modelLabel.appendChild(nameSpan);

        column.appendChild(modelLabel);

        // 消息内容区域（初始为空）
        const messageContent = document.createElement('div');
        messageContent.className = 'bot-message';
        messageContent.dataset.modelId = modelInfo.modelId;
        applyBotMessageHeadingColor(messageContent, modelIndex);

        column.appendChild(messageContent);
        container.appendChild(column);
    });

    // 跟踪完成的模型数量
    let completedCount = 0;
    const totalModels = modelInfos.length;

    // 存储每个模型的响应内容
    const modelResponses = {};

    // 标记是否已显示容器
    let containerShown = false;

    // 显示多模型容器（移除 thinking 动画，插入到用户消息后面）
    function showContainer() {
        if (!containerShown) {
            containerShown = true;
            // 移除 thinking 动画
            if (thinkingElement && thinkingElement.parentNode) {
                thinkingElement.remove();
            }
            // 插入多模型容器到用户消息后面
            userMessageElement.insertAdjacentElement('afterend', container);
            elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
        }
    }

    // 并行调用所有模型
    const promises = modelInfos.map(async (modelInfo, modelIndex) => {
        const modelId = modelInfo.modelId;
        let renderScheduler = null;

        try {
            // 创建临时状态，使用当前模型和提供的历史记录
            const allSelectedModelIds = modelInfos.map(info => info.modelId);
            const tempState = {
                ...state,
                model: modelId,
                chatHistory: buildModelSpecificHistory(historyForApi, modelId, allSelectedModelIds)
            };

            // 获取对应列的消息内容区域
            const column = container.querySelector(`.bot-message-column[data-model-id="${modelId}"]`);
            const messageContent = column?.querySelector('.bot-message');

            if (!messageContent) {
                throw new Error('Message content element not found');
            }

            // 为 messageContent 添加 messageId（API 需要）
            const messageId = generateUniqueId();
            messageContent.dataset.messageId = messageId;
            applyBotMessageHeadingColor(messageContent, modelIndex);

            // 累积的响应内容
            let accumulatedContent = '';
            let hasReceivedFirstChunk = false;
            let modelSettled = false;
            renderScheduler = createMultiModelStreamRenderScheduler({
                modelId,
                messageContent,
                elements,
                state,
                label: 'MultiModelRegenRender'
            });

            // 创建针对该模型的 UI 回调
            const modelUiCallbacks = {
                addMessageToChat: (content, sender, options) => {
                    // 返回已创建的元素，API 会用这个元素来更新内容
                    return messageContent;
                },
                updateStreamingMessage: (el, content) => {
                    accumulatedContent = content;

                    // 第一次收到内容时显示多模型容器
                    if (!hasReceivedFirstChunk) {
                        hasReceivedFirstChunk = true;
                        showContainer();
                    }

                    renderScheduler.schedule(content);
                },
                finalizeBotMessage: (el, content) => {
                    if (modelSettled) return;
                    modelSettled = true;
                    accumulatedContent = content || accumulatedContent;
                    modelResponses[modelId] = accumulatedContent;

                    // 确保容器已显示
                    showContainer();

                    renderScheduler.flush(accumulatedContent, 'final');

                    // 添加消息操作按钮（复制、重新生成、删除）
                    if (window.addMessageActionButtons) {
                        window.addMessageActionButtons(messageContent, accumulatedContent);
                    }
                    if (window.addCopyButtonToCodeBlockCallback) {
                        postProcessBotMessageContent(messageContent, window.addCopyButtonToCodeBlockCallback, elements, messageContent.dataset.messageId || messageContent.dataset.modelId);
                    }

                    completedCount++;
                    console.log(`[MultiModel Regen] ${modelId} completed (${completedCount}/${totalModels})`);

                    // 所有模型都完成后恢复按钮状态并添加历史记录
                    if (completedCount >= totalModels) {
                        state.isStreaming = false;
                        restoreSendButtonAndInputCallback();

                        // 将响应添加到历史记录（用于后续对话）
                        // 优先使用第一个成功的模型响应，如果都失败则使用空字符串
                        const firstSuccessfulResponse = modelInfos
                            .map(info => modelResponses[info.modelId])
                            .find(response => response && response.trim() !== '');

                        state.chatHistory.push({
                            role: 'model',
                            parts: [{ text: firstSuccessfulResponse || '' }],
                            id: container.dataset.messageId, // 使用容器的 messageId，确保与 DOM 一致
                            multiModelResponses: modelResponses, // 存储所有模型的响应
                            modelOrder: modelInfos.map(info => info.modelId)
                        });
                        if (userMessageElement?.dataset?.messageId && typeof window.refreshMessageActionButtonsByMessageId === 'function') {
                            window.refreshMessageActionButtonsByMessageId(userMessageElement.dataset.messageId);
                        }
                        if (typeof window.rebindFollowUpQuestionsForResponse === 'function') {
                            window.rebindFollowUpQuestionsForResponse({
                                oldResponseMessageIds,
                                newResponseMessageId: container.dataset.messageId
                            });
                        }
                    }
                },
                showToast: showToastCallback,
                restoreSendButtonAndInput: () => {
                    if (modelSettled) return;
                    modelSettled = true;
                    // API 层面发生错误时会调用这个回调
                    renderScheduler.flush(accumulatedContent, 'restore');
                    // 增加完成计数并检查是否所有模型都完成
                    completedCount++;
                    console.log(`[MultiModel Regen] ${modelId} failed/aborted (${completedCount}/${totalModels})`);

                    // 检查 messageContent 是否需要添加操作按钮（错误情况）
                    // 如果 messageContent 存在且没有 message-actions，添加操作按钮
                    if (messageContent && !messageContent.querySelector('.message-actions')) {
                        // 确保 messageContent 有 messageId
                        if (!messageContent.dataset.messageId) {
                            messageContent.dataset.messageId = generateUniqueId();
                        }
                        // 添加操作按钮（重试和删除）
                        if (window.addMessageActionButtons) {
                            window.addMessageActionButtons(messageContent, '');
                        }
                    }

                    if (completedCount >= totalModels) {
                        state.isStreaming = false;
                        restoreSendButtonAndInputCallback();

                        // 检查历史记录是否已添加（可能由 finalizeBotMessage 添加）
                        const historyExists = state.chatHistory.some(msg => msg.id === container.dataset.messageId);
                        if (!historyExists) {
                            // 将响应添加到历史记录
                            const firstSuccessfulResponse = modelInfos
                                .map(info => modelResponses[info.modelId])
                                .find(response => response && response.trim() !== '');

                            state.chatHistory.push({
                                role: 'model',
                                parts: [{ text: firstSuccessfulResponse || '' }],
                                id: container.dataset.messageId,
                                multiModelResponses: modelResponses,
                                modelOrder: modelInfos.map(info => info.modelId)
                            });
                            if (userMessageElement?.dataset?.messageId && typeof window.refreshMessageActionButtonsByMessageId === 'function') {
                                window.refreshMessageActionButtonsByMessageId(userMessageElement.dataset.messageId);
                            }
                            if (typeof window.rebindFollowUpQuestionsForResponse === 'function') {
                                window.rebindFollowUpQuestionsForResponse({
                                    oldResponseMessageIds,
                                    newResponseMessageId: container.dataset.messageId
                                });
                            }
                        }
                    }
                }
            };

            // 调用 API（使用 callGeminiAPIWithImages，传入历史记录）
            await window.GeminiAPI.callGeminiAPIWithImages(
                userMessageText,
                userImages,
                userVideos,
                null, // thinkingElement - 我们已经在容器中创建了
                tempState,
                modelUiCallbacks,
                contextTabsForApi,
                null // 不传递 userMessageForHistory，重新生成不需要再添加用户消息
            );

        } catch (error) {
            if (renderScheduler) {
                renderScheduler.cancel();
            }
            console.error(`[MultiModel Regen] Error calling ${modelId}:`, error);

            // 确保容器已显示
            showContainer();

            // 显示错误
            const column = container.querySelector(`.bot-message-column[data-model-id="${modelId}"]`);
            const messageContent = column?.querySelector('.bot-message');

            if (messageContent) {
                // 确保 messageContent 有 messageId
                if (!messageContent.dataset.messageId) {
                    messageContent.dataset.messageId = generateUniqueId();
                }

                messageContent.innerHTML = `<div class="error-message" style="color: var(--error-color); padding: 12px;">Error: ${error.message || 'Unknown error'}</div>`;

                // 添加操作按钮（重试和删除）
                if (window.addMessageActionButtons) {
                    window.addMessageActionButtons(messageContent, '');
                }
            }

            // 注意：completedCount 已经在 restoreSendButtonAndInput 回调中增加了
            // 这里不需要再增加，也不需要再检查是否完成
        }
    });

    // 等待所有调用完成
    await Promise.allSettled(promises);

    // 最终清理：确保 thinking 动画被移除，状态被恢复
    if (thinkingElement && thinkingElement.parentNode) {
        thinkingElement.remove();
    }
    // 如果所有模型都失败了（容器从未显示），也需要恢复状态
    if (!containerShown) {
        state.isStreaming = false;
        restoreSendButtonAndInputCallback();
    }
}

/**
 * 在多模型容器中重新生成单个模型的响应
 * @param {object} regenInfo - { container, modelId, messageElement, historyIndex }
 * @param {object} state - Global state reference
 * @param {object} elements - DOM elements reference
 * @param {object} currentTranslations - Translations object
 * @param {function} showToastCallback - Callback to show toast notifications
 * @param {function} restoreSendButtonAndInputCallback - Callback to restore button state
 */
async function regenerateSingleModelInContainer(
    regenInfo,
    state,
    elements,
    currentTranslations,
    showToastCallback,
    restoreSendButtonAndInputCallback
) {
    const { container, modelId, messageElement, historyIndex } = regenInfo;

    // 获取历史记录中的 AI 消息和对应的用户消息
    const aiMessage = state.chatHistory[historyIndex];
    const userIndex = historyIndex - 1;

    if (userIndex < 0 || state.chatHistory[userIndex].role !== 'user') {
        console.error('[SingleModelRegen] Could not find preceding user message.');
        if (showToastCallback) showToastCallback(_('regenerateFailedNoUserMessage', {}, currentTranslations), 'error');
        return;
    }

    const userMessageData = state.chatHistory[userIndex];
    if (userMessageData?.role === 'user' && typeof window.resetMermaidOverviewForUserMessage === 'function') {
        window.resetMermaidOverviewForUserMessage(userMessageData.id);
    }
    const { text: userMessageText, images: userImages, videos: userVideos } = extractPartsFromMessage(userMessageData);

    // 提取上下文标签页；保存的历史记录可能只保留元信息，重生前再按 id/url 重新读取正文。
    const contextTabsForApi = await hydrateContextTabsForApi(
        userMessageData.sentContextTabsInfo || [],
        showToastCallback,
        currentTranslations
    );

    // 准备历史记录（不包括当前轮次）
    const historyForApi = state.chatHistory.slice(0, userIndex);

    // 获取模型信息
    const modelInfo = getModelInfo(modelId, elements);
    if (!modelInfo) {
        console.error(`[SingleModelRegen] Model info not found for ${modelId}`);
        if (showToastCallback) showToastCallback(_('regenerateFailedNotFound', {}, currentTranslations), 'error');
        return;
    }

    // 设置流式状态
    state.isStreaming = true;
    state.userScrolledUpDuringStream = false;
    elements.sendMessage.classList.add('stop-streaming');
    const stopTitle = _('stopStreamingTitle', {}, currentTranslations);
    elements.sendMessage.title = stopTitle;
    elements.sendMessage.setAttribute('aria-label', stopTitle);

    // 在消息元素中显示 thinking 动画
    messageElement.innerHTML = `
        <div class="thinking-animation">
            <div class="thinking-dot"></div>
            <div class="thinking-dot"></div>
            <div class="thinking-dot"></div>
        </div>
    `;

    // 移除旧的 message-actions
    const oldActions = messageElement.querySelector('.message-actions');
    if (oldActions) oldActions.remove();

    try {
        // 创建临时状态，使用指定的模型
        const allSelectedModelIds = state.selectedModels && state.selectedModels.length > 0
            ? state.selectedModels
            : [modelId];
        const tempState = {
            ...state,
            model: modelId,
            chatHistory: buildModelSpecificHistory(historyForApi, modelId, allSelectedModelIds)
        };

        // 累积的响应内容
        let accumulatedContent = '';

        // 创建 UI 回调
        const modelUiCallbacks = {
            addMessageToChat: () => messageElement,
            updateStreamingMessage: (el, content) => {
                accumulatedContent = content;
                const formattedContent = window.MarkdownRenderer.render(content);
                messageElement.innerHTML = formattedContent;

                if (!state.userScrolledUpDuringStream) {
                    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
                }
            },
            finalizeBotMessage: (el, content) => {
                accumulatedContent = content || accumulatedContent;

                // 渲染最终内容
                if (accumulatedContent) {
                    const formattedContent = window.MarkdownRenderer.render(accumulatedContent);
                    messageElement.innerHTML = formattedContent;
                }

                // 添加代码块复制按钮
                if (window.addCopyButtonToCodeBlockCallback) {
                    messageElement.querySelectorAll('.code-block').forEach(block => {
                        window.addCopyButtonToCodeBlockCallback(block);
                    });
                }

                // 添加消息操作按钮
                if (window.addMessageActionButtons) {
                    window.addMessageActionButtons(messageElement, accumulatedContent);
                }

                // 更新历史记录中的 multiModelResponses
                if (aiMessage.multiModelResponses) {
                    aiMessage.multiModelResponses[modelId] = accumulatedContent;

                    // 如果重新生成的是第一个模型，也更新主要的 parts
                    const firstModelId = Object.keys(aiMessage.multiModelResponses)[0];
                    if (modelId === firstModelId) {
                        aiMessage.parts = [{ text: accumulatedContent }];
                    }
                }

                state.isStreaming = false;
                restoreSendButtonAndInputCallback();

                console.log(`[SingleModelRegen] ${modelId} completed`);
            },
            showToast: showToastCallback,
            restoreSendButtonAndInput: () => {
                // API 层面发生错误时会调用这个回调
                // 检查 messageElement 是否需要添加操作按钮（错误情况）
                if (messageElement && !messageElement.querySelector('.message-actions')) {
                    // 清除 thinking 动画，显示错误信息
                    const thinkingAnim = messageElement.querySelector('.thinking-animation');
                    if (thinkingAnim) {
                        messageElement.innerHTML = `<div class="error-message" style="color: var(--error-color); padding: 12px;">Request failed</div>`;
                    }
                    // 添加操作按钮（重试和删除）
                    if (window.addMessageActionButtons) {
                        window.addMessageActionButtons(messageElement, '');
                    }
                }

                state.isStreaming = false;
                restoreSendButtonAndInputCallback();
            }
        };

        // 调用 API
        await window.GeminiAPI.callGeminiAPIWithImages(
            userMessageText,
            userImages,
            userVideos,
            null,
            tempState,
            modelUiCallbacks,
            contextTabsForApi,
            null
        );

    } catch (error) {
        console.error(`[SingleModelRegen] Error:`, error);
        messageElement.innerHTML = `<div class="error-message" style="color: var(--error-color); padding: 12px;">Error: ${error.message || 'Unknown error'}</div>`;

        // 添加操作按钮（重试和删除）
        if (window.addMessageActionButtons) {
            window.addMessageActionButtons(messageElement, '');
        }

        state.isStreaming = false;
        restoreSendButtonAndInputCallback();
    }
}

/**
 * Clears the chat context and history.
 * @param {object} state - Global state reference
 * @param {object} elements - DOM elements reference
 * @param {function} clearImagesCallback - Callback
 * @param {function} clearVideosCallback - Callback
 * @param {function} showToastCallback - Callback
 * @param {object} currentTranslations - Translations object
 * @param {boolean} [showToast=true] - Whether to show the "Cleared" toast
 */
export async function clearContext(state, elements, clearImagesCallback, clearVideosCallback, showToastCallback, currentTranslations, showToast = true) {
    state.chatHistory = [];
    state.locallyIgnoredTabs = {}; // 清空已忽略标签页的状态
    elements.chatMessages.innerHTML = ''; // Clear UI
    resetBotMessageHeadingColors();

    // Re-add welcome message with dynamic quick actions
    const welcomeMessage = await createWelcomeMessage(currentTranslations);
    elements.chatMessages.appendChild(welcomeMessage);

    clearImagesCallback(); // Clear images using callback
    clearVideosCallback(); // Clear videos using callback
    if (showToast) {
        showToastCallback(_('contextClearedSuccess', {}, currentTranslations), 'success');
    }
}

function removeMessageDomById(messageId) {
    if (!messageId) return false;

    const messageElement = document.querySelector(`.message[data-message-id="${messageId}"]`);
    const multiModelContainer = document.querySelector(`.multi-model-response-container[data-message-id="${messageId}"]`);
    const targetElement = messageElement || multiModelContainer;

    if (!targetElement) {
        return false;
    }

    let prevSibling = targetElement.previousElementSibling;
    while (prevSibling && prevSibling.dataset.messageIdRef === messageId) {
        const siblingToRemove = prevSibling;
        prevSibling = siblingToRemove.previousElementSibling;
        siblingToRemove.remove();
    }

    targetElement.remove();
    return true;
}

/**
 * Deletes a specific message from chat history and UI.
 * @param {string} messageId - The ID of the message to delete.
 * @param {object} state - Global state reference
 */
export function deleteMessage(messageId, state) {
    const messageIndex = state.chatHistory.findIndex(msg => msg.id === messageId);

    if (messageIndex !== -1 && state.chatHistory[messageIndex]?.role === 'user') {
        const deletedMessages = [state.chatHistory[messageIndex]];
        let nextIndex = messageIndex + 1;

        while (nextIndex < state.chatHistory.length && state.chatHistory[nextIndex]?.role === 'model') {
            deletedMessages.push(state.chatHistory[nextIndex]);
            nextIndex++;
        }

        deletedMessages.forEach((message) => {
            if (message?.role === 'user' && typeof window.resetMermaidOverviewForUserMessage === 'function') {
                window.resetMermaidOverviewForUserMessage(message.id);
            }

            removeMessageDomById(message.id);

            if (state.locallyIgnoredTabs && state.locallyIgnoredTabs[message.id]) {
                delete state.locallyIgnoredTabs[message.id];
                console.log(`Cleaned up ignored tabs for deleted message ${message.id}`);
            }
        });

        state.chatHistory.splice(messageIndex, deletedMessages.length);
        console.log(`Deleted user turn starting at ${messageId}, removed ${deletedMessages.length} history item(s)`);
        return;
    }

    // 首先尝试查找普通消息
    let domRemoved = removeMessageDomById(messageId);

    if (!domRemoved) {
        // 检查是否是多模型容器中的单个模型消息
        const botMessageElement = document.querySelector(`.bot-message[data-message-id="${messageId}"]`);
        if (botMessageElement) {
            const multiModelContainer = botMessageElement.closest('.multi-model-response-container');
            if (multiModelContainer) {
                const column = botMessageElement.closest('.bot-message-column');
                const modelId = column?.dataset.modelId;

                if (column && modelId) {
                    // 获取容器的 messageId 来查找历史记录
                    const containerMessageId = multiModelContainer.dataset.messageId;
                    const historyIndex = state.chatHistory.findIndex(msg => msg.id === containerMessageId);

                    if (historyIndex !== -1) {
                        const aiMessage = state.chatHistory[historyIndex];

                        // 从 multiModelResponses 中删除该模型的响应
                        if (aiMessage.multiModelResponses && aiMessage.multiModelResponses[modelId]) {
                            delete aiMessage.multiModelResponses[modelId];
                            console.log(`[DeleteSingleModel] Removed ${modelId} from multiModelResponses`);

                            const userMessage = state.chatHistory[historyIndex - 1];
                            if (userMessage?.role === 'user' && typeof window.resetMermaidOverviewForUserMessage === 'function') {
                                window.resetMermaidOverviewForUserMessage(userMessage.id);
                            }

                            // 如果删除后还有其他模型的响应，更新 parts 为第一个剩余模型的响应
                            const remainingModelIds = Object.keys(aiMessage.multiModelResponses);
                            if (remainingModelIds.length > 0) {
                                const firstRemainingResponse = aiMessage.multiModelResponses[remainingModelIds[0]];
                                aiMessage.parts = [{ text: firstRemainingResponse }];
                            }
                        }

                        // 从 DOM 中移除该列
                        column.remove();
                        domRemoved = true;

                        // 检查容器中是否还有其他列，如果没有则删除整个容器和历史记录
                        const remainingColumns = multiModelContainer.querySelectorAll('.bot-message-column');
                        if (remainingColumns.length === 0) {
                            multiModelContainer.remove();
                            state.chatHistory.splice(historyIndex, 1);
                            console.log(`[DeleteSingleModel] Removed entire multi-model container and history`);
                        }

                        console.log(`Message ${messageId} (model: ${modelId}) deleted from multi-model container`);
                        return; // 提前返回，不执行后续的普通删除逻辑
                    }
                }
            }
        }
    }

    let historyRemoved = false;
    if (messageIndex !== -1) {
        const deletedMessage = state.chatHistory[messageIndex];
        if (deletedMessage?.role === 'user' && typeof window.resetMermaidOverviewForUserMessage === 'function') {
            window.resetMermaidOverviewForUserMessage(deletedMessage.id);
        }
        if (deletedMessage?.role === 'model') {
            const previousMessage = state.chatHistory[messageIndex - 1];
            if (previousMessage?.role === 'user' && typeof window.resetMermaidOverviewForUserMessage === 'function') {
                window.resetMermaidOverviewForUserMessage(previousMessage.id);
            }
        }
        state.chatHistory.splice(messageIndex, 1);
        historyRemoved = true;
    }

    // Clean up from locallyIgnoredTabs
    if (state.locallyIgnoredTabs && state.locallyIgnoredTabs[messageId]) {
        delete state.locallyIgnoredTabs[messageId];
        console.log(`Cleaned up ignored tabs for deleted message ${messageId}`);
    }

    if (domRemoved || historyRemoved) {
        console.log(`Message ${messageId} deleted (DOM: ${domRemoved}, History: ${historyRemoved})`);
        // Optional: Save history if persistent storage is used
    } else {
        console.warn(`Delete failed: Message ${messageId} not found.`);
    }
}

/**
 * Regenerates the AI response for a specific turn.
 * @param {string} messageId - The ID of the message (user or bot) triggering regeneration.
 * @param {object} state - Global state reference
 * @param {object} elements - DOM elements reference
 * @param {object} currentTranslations - Translations object
 * @param {function} addMessageToChatCallback - Callback (main.js#addMessageToChatUI)
 * @param {function} addThinkingAnimationCallback - Callback (lambda from main.js for ui.js#addThinkingAnimation)
 * @param {function} restoreSendButtonAndInputCallback - Callback
 * @param {function} showToastCallback - Callback to show toast notifications
 * @param {function} [updateSelectedTabsBarCallback] - Optional callback to update selected tabs bar UI
 */
export async function regenerateMessage(messageId, state, elements, currentTranslations, addMessageToChatCallback, addThinkingAnimationCallback, restoreSendButtonAndInputCallback, showToastCallback, updateSelectedTabsBarCallback) {
    if (state.isStreaming) {
        console.warn("Cannot regenerate while streaming.");
        // if (showToastCallback) showToastCallback(_('streamingInProgress', {}, currentTranslations), 'warning'); // Commented out as per task
        return;
    }

    let clickedMessageIndex = state.chatHistory.findIndex(msg => msg.id === messageId);

    // 检查是否是多模型响应中的某个消息需要单独重新生成
    let singleModelRegenInfo = null; // { container, modelId, messageElement, historyIndex }

    if (clickedMessageIndex === -1) {
        // 查找包含该 messageId 的多模型容器
        const messageElement = document.querySelector(`.bot-message[data-message-id="${messageId}"]`);
        if (messageElement) {
            const multiModelContainer = messageElement.closest('.multi-model-response-container');
            if (multiModelContainer) {
                // 找到多模型容器，获取模型ID
                const column = messageElement.closest('.bot-message-column');
                const modelId = column?.dataset.modelId;

                // 使用容器的 messageId 查找历史记录
                const containerMessageId = multiModelContainer.dataset.messageId;
                clickedMessageIndex = state.chatHistory.findIndex(msg => msg.id === containerMessageId);

                if (clickedMessageIndex !== -1 && modelId) {
                    // 标记为单模型重新生成
                    singleModelRegenInfo = {
                        container: multiModelContainer,
                        modelId: modelId,
                        messageElement: messageElement,
                        historyIndex: clickedMessageIndex
                    };
                }
            }
        }
    }

    if (clickedMessageIndex === -1) {
        console.error("Regenerate failed: Message not found in history.");
        if (showToastCallback) showToastCallback(_('regenerateFailedNotFound', {}, currentTranslations), 'error');
        return;
    }

    // 如果是多模型容器中的单个模型重新生成
    if (singleModelRegenInfo) {
        await regenerateSingleModelInContainer(
            singleModelRegenInfo,
            state,
            elements,
            currentTranslations,
            showToastCallback,
            restoreSendButtonAndInputCallback
        );
        return;
    }

    const clickedMessage = state.chatHistory[clickedMessageIndex];
    let userIndex = -1;
    let aiIndex = -1;
    let userMessageElement = null;

    // Find the user message and the AI message of the turn
    if (clickedMessage.role === 'user') {
        userIndex = clickedMessageIndex;
        if (userIndex + 1 < state.chatHistory.length && state.chatHistory[userIndex + 1].role === 'model') {
            aiIndex = userIndex + 1;
        }
    } else { // clickedMessage.role === 'model'
        aiIndex = clickedMessageIndex;
        userIndex = aiIndex - 1; // Assume user message is directly before
        if (userIndex < 0 || state.chatHistory[userIndex].role !== 'user') {
            console.error("Regenerate failed: Could not find preceding user message.");
            if (showToastCallback) showToastCallback(_('regenerateFailedNoUserMessage', {}, currentTranslations), 'error');
            return; // Cannot regenerate if user message isn't directly before
        }
    }

    userMessageElement = document.querySelector(`.message[data-message-id="${state.chatHistory[userIndex].id}"]`);
    if (!userMessageElement) {
        console.error("Regenerate failed: Could not find user message DOM element.");
        if (showToastCallback) showToastCallback(_('regenerateFailedUIDiscrepancy', {}, currentTranslations), 'error');
        return;
    }

    // Extract user input parts
    const userMessageData = state.chatHistory[userIndex];
    if (userMessageData?.role === 'user' && typeof window.resetMermaidOverviewForUserMessage === 'function') {
        window.resetMermaidOverviewForUserMessage(userMessageData.id);
    }
    const { text: userMessageText, images: userImages, videos: userVideos } = extractPartsFromMessage(userMessageData); // Use helper

    // 新增：提取该用户轮次最初发送的上下文标签页
    const previouslySentContextTabsFromHistory = userMessageData.sentContextTabsInfo || []; // 确保是数组 [{id, title, content}]

    // Prepare history up to (but not including) the user message of the turn
    const historyForApi = state.chatHistory.slice(0, userIndex);

    // Remove old AI response(s) following the user message
    const removedAIMessageIds = [];
    let removedAICount = 0;
    while (state.chatHistory[userIndex + 1]?.role === 'model') {
        const oldAiMessageId = state.chatHistory[userIndex + 1].id;
        if (oldAiMessageId) {
            removedAIMessageIds.push(oldAiMessageId);
        }
        // 尝试移除单模型响应
        const oldAiElement = document.querySelector(`.message[data-message-id="${oldAiMessageId}"]`);
        if (oldAiElement) oldAiElement.remove();
        // 尝试移除多模型响应容器
        const oldMultiModelContainer = document.querySelector(`.multi-model-response-container[data-message-id="${oldAiMessageId}"]`);
        if (oldMultiModelContainer) oldMultiModelContainer.remove();
        state.chatHistory.splice(userIndex + 1, 1);
        removedAICount++;
    }
    // 也尝试移除用户消息后面紧跟的多模型容器（可能没有在历史记录中）
    const nextSibling = userMessageElement.nextElementSibling;
    if (nextSibling && nextSibling.classList.contains('multi-model-response-container')) {
        nextSibling.remove();
    }
    console.log(`Removed ${removedAICount} old AI response(s) starting after index ${userIndex}`);


    // --- 在重新生成前，立即标记即将作为上下文发送的标签页并更新UI ---
    // Start with the effective previously sent context, filtering out locally ignored ones
    const ignoredTabIdsForThisTurn = (state.locallyIgnoredTabs && state.locallyIgnoredTabs[userMessageData.id]) ? state.locallyIgnoredTabs[userMessageData.id] : [];
    
    let effectivePreviouslySentContext = previouslySentContextTabsFromHistory.filter(
        tab => !ignoredTabIdsForThisTurn.includes(tab.id)
    );
    
    let contextTabsForApiRegen = [...effectivePreviouslySentContext]; // Contains {id, title, content}

    // 处理在"重新生成"之前新选择的、尚未发送的标签页
    if (state.selectedContextTabs && state.selectedContextTabs.length > 0) {
        const newlySelectedTabsToSend = state.selectedContextTabs.filter(
            tab => tab.content && !tab.isLoading && !tab.isContextSent
        );

        if (newlySelectedTabsToSend.length > 0) {
            const newTabsForApi = newlySelectedTabsToSend.map(tab => ({ id: tab.id, title: tab.title, url: tab.url, content: tab.content }));
            
            // 合并新选择的标签页，避免重复（基于ID去重）
            newTabsForApi.forEach(newTab => {
                if (!contextTabsForApiRegen.some(existingTab => existingTab.id === newTab.id)) {
                    contextTabsForApiRegen.push(newTab);
                }
            });

            // 标记这些新选择的标签页为已发送并更新UI
            newlySelectedTabsToSend.forEach(tabSent => {
                const originalTab = state.selectedContextTabs.find(t => t.id === tabSent.id);
                if (originalTab) {
                    originalTab.isContextSent = true;
                }
            });
            state.selectedContextTabs = state.selectedContextTabs.filter(tab => !tab.isContextSent);
            
            if (updateSelectedTabsBarCallback) {
                updateSelectedTabsBarCallback(); // 立即更新UI
            }
        }
    }
    contextTabsForApiRegen = await hydrateContextTabsForApi(
        contextTabsForApiRegen,
        showToastCallback,
        currentTranslations
    );
    // --- 结束处理标签页逻辑 ---

    // --- Start Streaming State ---
    state.isStreaming = true;
    state.userScrolledUpDuringStream = false; // 重置滚动标记
    elements.sendMessage.classList.add('stop-streaming');
    const stopTitle = _('stopStreamingTitle', {}, currentTranslations);
    elements.sendMessage.title = stopTitle;
    elements.sendMessage.setAttribute('aria-label', stopTitle);
    // --- End Streaming State ---

    // 获取选中的模型列表
    const selectedModels = state.selectedModels && state.selectedModels.length > 0
        ? state.selectedModels
        : [state.model];

    // 判断是单模型还是多模型
    const isMultiModel = selectedModels.length > 1;

    if (isMultiModel) {
        // ========== 多模型并行重新生成 ==========
        await regenerateMultiModelMessage(
            userMessageText,
            userImages,
            userVideos,
            contextTabsForApiRegen,
            historyForApi,
            userIndex,
            userMessageElement,
            selectedModels,
            state,
            elements,
            currentTranslations,
            addMessageToChatCallback,
            showToastCallback,
            restoreSendButtonAndInputCallback,
            removedAIMessageIds
        );
    } else {
        // ========== 单模型重新生成（保持原有逻辑） ==========
        // Add thinking animation after the user message
        // The callback `addThinkingAnimationCallback` (defined in main.js) will use the live `isUserNearBottom`.
        // It expects `afterEl` as its first argument.
        const thinkingElement = addThinkingAnimationCallback(userMessageElement);

        try {
            // Prepare API callbacks object (similar to sendUserMessage)
            const apiUiCallbacks = {
                // addMessageToChatCallback is main.js#addMessageToChatUI, which correctly uses live isUserNearBottom
                addMessageToChat: addMessageToChatCallback,
                // These now call the wrappers on `window` (defined in main.js) which use live isUserNearBottom from main.js
                updateStreamingMessage: (el, content) => window.updateStreamingMessage(el, content),
                finalizeBotMessage: (el, content) => {
                    window.finalizeBotMessage(el, content, { suppressFollowUp: true });
                    if (typeof window.rebindFollowUpQuestionsForResponse === 'function') {
                        window.rebindFollowUpQuestionsForResponse({
                            oldResponseMessageIds: removedAIMessageIds,
                            newResponseMessageId: el?.dataset?.messageId || ''
                        });
                    }
                    // 此处不再需要处理 selectedContextTabs 的逻辑，已提前处理
                },
                clearImages: () => { }, // Don't clear images on regenerate
                showToast: showToastCallback, // Pass the received showToastCallback
                restoreSendButtonAndInput: restoreSendButtonAndInputCallback // Add this callback for error handling
            };

            // Call API to insert response
            await window.GeminiAPI.callApiAndInsertResponse(
                userMessageText,
                userImages,
                userVideos,
                thinkingElement,
                historyForApi,
                userIndex + 1, // Insert *after* the user message index
                userMessageElement, // Insert *after* this DOM element
                state,
                apiUiCallbacks,
                contextTabsForApiRegen // <--- Pass the prepared context tabs
            );
            // finalizeBotMessage will restore button state on success

        } catch (error) {
            console.error(`Regenerate failed:`, error);
            if (thinkingElement && thinkingElement.parentNode) thinkingElement.remove();
            // Add error message after the user message
            // addMessageToChatCallback already handles isUserNearBottom correctly
            addMessageToChatCallback(_('regenerateError', { error: error.message }, currentTranslations), 'bot', { insertAfterElement: userMessageElement });
            restoreSendButtonAndInputCallback(); // Restore button on error
        }
    }
}

/**
 * 为指定模型构建专属的历史记录。
 * 将多模型响应中的 parts 替换为该模型自己的响应内容。
 * 匹配规则（按优先级）：
 * 1. 精确匹配：历史中存在该模型的专属回复
 * 2. 最长公共前缀（LCP）匹配：按公共前缀长度降序贪心匹配最相似的历史模型回复
 * 3. 末位匹配：经过上述匹配后，如果恰好剩下1个未匹配的模型和1个未匹配的历史回复，直接配对
 * 4. 回退：使用默认的 parts（通常是第一个成功模型的回复），并在控制台输出警告
 * @param {Array} chatHistory - 原始聊天历史
 * @param {string} modelId - 目标模型ID
 * @param {Array<string>|null} allSelectedModelIds - 当前所有选中的模型ID列表（用于末位匹配）
 * @returns {Array} 该模型专属的历史记录副本
 */
function buildModelSpecificHistory(chatHistory, modelId, allSelectedModelIds = null) {
    return chatHistory.map(msg => {
        if (msg.role === 'model' && msg.multiModelResponses) {
            const matchedHistoricalId = resolveModelMatch(modelId, msg.multiModelResponses, allSelectedModelIds);
            if (matchedHistoricalId) {
                return {
                    ...msg,
                    parts: [{ text: msg.multiModelResponses[matchedHistoricalId] }]
                };
            }
            // 无法匹配，使用默认 parts
        }
        return msg;
    });
}

/**
 * 计算两个字符串的最长公共前缀长度。
 * @param {string} a - 字符串 a
 * @param {string} b - 字符串 b
 * @returns {number} 最长公共前缀的字符数
 */
function longestCommonPrefixLength(a, b) {
    const minLen = Math.min(a.length, b.length);
    let i = 0;
    while (i < minLen && a[i] === b[i]) {
        i++;
    }
    return i;
}

/**
 * 构建当前选中模型与历史多模型响应的完整匹配映射。
 * 匹配规则（按优先级）：精确匹配 → LCP匹配 → 末位匹配。
 * @param {Array<string>} allSelectedModelIds - 当前所有选中的模型ID列表
 * @param {Object} multiModelResponses - 历史中存储的多模型响应 { modelId: responseText }
 * @returns {Object} 匹配映射 { selectedModelId: historicalModelId }
 */
function buildFullModelMatchMapping(allSelectedModelIds, multiModelResponses) {
    const historicalModelIds = Object.keys(multiModelResponses);
    const matched = {};           // selectedModelId -> historicalModelId
    const matchedHistorical = new Set(); // 已被匹配的历史模型ID

    // === 步骤1：精确匹配 ===
    for (const selectedId of allSelectedModelIds) {
        if (multiModelResponses[selectedId] !== undefined) {
            matched[selectedId] = selectedId;
            matchedHistorical.add(selectedId);
        }
    }

    // === 步骤2：最长公共前缀（LCP）匹配 ===
    const unmatchedSelected = allSelectedModelIds.filter(id => !matched[id]);
    const unmatchedHistorical = historicalModelIds.filter(id => !matchedHistorical.has(id));

    const candidates = [];
    for (const selectedId of unmatchedSelected) {
        for (const histId of unmatchedHistorical) {
            const lcpLen = longestCommonPrefixLength(selectedId, histId);
            if (lcpLen > 0) {
                candidates.push({ selectedId, histId, lcpLen });
            }
        }
    }
    candidates.sort((a, b) => b.lcpLen - a.lcpLen);

    for (const { selectedId, histId, lcpLen } of candidates) {
        if (!matched[selectedId] && !matchedHistorical.has(histId)) {
            matched[selectedId] = histId;
            matchedHistorical.add(histId);
            console.log(`[ModelMatch] LCP matched (prefix length ${lcpLen}): "${selectedId}" ↔ "${histId}"`);
        }
    }

    // === 步骤3：末位匹配 ===
    const remainingUnmatchedSelected = allSelectedModelIds.filter(id => !matched[id]);
    const remainingUnmatchedHistorical = historicalModelIds.filter(id => !matchedHistorical.has(id));

    if (remainingUnmatchedSelected.length === 1 && remainingUnmatchedHistorical.length === 1) {
        const lastSelectedId = remainingUnmatchedSelected[0];
        const lastHistoricalId = remainingUnmatchedHistorical[0];
        matched[lastSelectedId] = lastHistoricalId;
        matchedHistorical.add(lastHistoricalId);
        console.log(`[ModelMatch] Last-one-standing matched: "${lastSelectedId}" ↔ "${lastHistoricalId}"`);
    }

    return matched;
}

/**
 * 为当前模型在历史多模型响应中寻找最佳匹配。
 * @param {string} targetModelId - 当前目标模型ID
 * @param {Object} multiModelResponses - 历史中存储的多模型响应 { modelId: responseText }
 * @param {Array<string>|null} allSelectedModelIds - 当前所有选中的模型ID列表
 * @returns {string|null} 匹配到的历史模型ID，或 null 表示无法匹配
 */
function resolveModelMatch(targetModelId, multiModelResponses, allSelectedModelIds) {
    // 快速路径：精确匹配
    if (multiModelResponses[targetModelId] !== undefined) {
        return targetModelId;
    }

    const selectedModels = allSelectedModelIds || [targetModelId];
    const matched = buildFullModelMatchMapping(selectedModels, multiModelResponses);

    if (matched[targetModelId]) {
        return matched[targetModelId];
    }

    // 无法匹配
    const historicalModelIds = Object.keys(multiModelResponses);
    console.warn(
        `[ModelMatch] Cannot match model "${targetModelId}" to any historical model response. ` +
        `Historical models: [${historicalModelIds.join(', ')}], Selected models: [${selectedModels.join(', ')}]. ` +
        `Using default parts.`
    );
    return null;
}

/**
 * 根据历史多模型响应的顺序，重新排列当前的模型信息数组。
 * 使得新发送的多模型响应展示顺序与历史记录的模型顺序一致。
 * @param {Array<Object>} modelInfos - 当前选中的模型信息数组 [{ modelId, displayName, ... }]
 * @param {Array} chatHistory - 聊天历史记录
 * @returns {Array<Object>} 重新排列后的模型信息数组
 */
function reorderModelInfosByHistory(modelInfos, chatHistory) {
    if (!chatHistory || chatHistory.length === 0 || modelInfos.length <= 1) {
        return modelInfos;
    }

    // 找到历史中最后一条多模型响应
    let lastMultiModelMsg = null;
    for (let i = chatHistory.length - 1; i >= 0; i--) {
        const msg = chatHistory[i];
        if (msg.role === 'model' && msg.multiModelResponses &&
            Object.keys(msg.multiModelResponses).length > 1) {
            lastMultiModelMsg = msg;
            break;
        }
    }

    if (!lastMultiModelMsg) {
        return modelInfos;
    }

    // 获取历史模型的展示顺序
    const historicalOrder = lastMultiModelMsg.modelOrder || Object.keys(lastMultiModelMsg.multiModelResponses);
    const allSelectedModelIds = modelInfos.map(info => info.modelId);

    // 构建全局匹配映射
    const mapping = buildFullModelMatchMapping(allSelectedModelIds, lastMultiModelMsg.multiModelResponses);

    // 构建反向映射：historicalModelId -> selectedModelId
    const reverseMapping = {};
    for (const [selectedId, historicalId] of Object.entries(mapping)) {
        reverseMapping[historicalId] = selectedId;
    }

    // 按历史顺序排列已匹配的模型，未匹配的追加在末尾
    const ordered = [];
    const used = new Set();

    for (const histId of historicalOrder) {
        const selectedId = reverseMapping[histId];
        if (selectedId) {
            const info = modelInfos.find(m => m.modelId === selectedId);
            if (info) {
                ordered.push(info);
                used.add(selectedId);
            }
        }
    }

    // 追加未匹配到历史顺序的模型
    for (const info of modelInfos) {
        if (!used.has(info.modelId)) {
            ordered.push(info);
        }
    }

    if (ordered.length !== modelInfos.length) {
        console.warn('[reorderModelInfosByHistory] Reordered count mismatch, falling back to original order');
        return modelInfos;
    }

    console.log(`[reorderModelInfosByHistory] Reordered models: [${ordered.map(m => m.modelId).join(', ')}]`);
    return ordered;
}

/**
 * Helper to extract text, image and video info from a message object.
 * @param {object} message - A message object from state.chatHistory
 * @returns {{text: string, images: Array<{dataUrl: string, mimeType: string}>, videos: Array<{dataUrl?: string, mimeType?: string, url?: string, type: string}>}}
 */
function extractPartsFromMessage(message) {
    let text = '';
    const images = [];
    const videos = [];
    if (message && message.parts && Array.isArray(message.parts)) {
        message.parts.forEach(part => {
            if (part.text) {
                text += (text ? '\n' : '') + part.text; // Combine text parts
            } else if (part.inlineData && part.inlineData.data && part.inlineData.mimeType) {
                if (part.inlineData.mimeType.startsWith('image/')) {
                    images.push({
                        dataUrl: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
                        mimeType: part.inlineData.mimeType
                    });
                }
                // 移除本地视频文件处理
            } else if (part.fileData && part.fileData.fileUri) {
                // YouTube URL
                videos.push({
                    url: part.fileData.fileUri,
                    type: 'youtube'
                });
            }
        });
    }
    return { text, images, videos };
}

/**
 * Aborts the current streaming API request.
 * @param {object} state - Global state reference
 * @param {function} restoreSendButtonAndInputCallback - Callback
 * @param {function} showToastCallback - Callback to show toast notifications
 * @param {object} currentTranslations - Translations object
 */
export function abortStreaming(state, restoreSendButtonAndInputCallback, showToastCallback, currentTranslations) {
    let aborted = false;

    // 尝试中断新的统一API接口
    if (window.PageTalkAPI && window.PageTalkAPI.currentAbortController) {
        console.log("Aborting unified API request...");
        window.PageTalkAPI.currentAbortController.abort();
        aborted = true;
    }

    // 尝试中断旧的Gemini API接口（向后兼容）
    if (window.GeminiAPI && window.GeminiAPI.currentAbortController) {
        console.log("Aborting legacy Gemini API request...");
        window.GeminiAPI.currentAbortController.abort();
        aborted = true;
    }

    if (!aborted) {
        console.warn("No active AbortController found to abort.");
    }

    // Always attempt to restore UI state after abort attempt
    restoreSendButtonAndInputCallback();
}

/**
 * Handles removing a sent tab from a message's context.
 * This updates the state to ignore the tab for future regenerations.
 * @param {string} messageId - The ID of the user message.
 * @param {string} tabId - The ID of the tab to remove from context.
 * @param {object} state - Global state reference.
 */
export function handleRemoveSentTabContext(messageId, tabId, state) {
    if (!state.locallyIgnoredTabs[messageId]) {
        state.locallyIgnoredTabs[messageId] = [];
    }
    if (!state.locallyIgnoredTabs[messageId].includes(tabId)) {
        state.locallyIgnoredTabs[messageId].push(tabId);
        console.log(`Tab ${tabId} marked as ignored for message ${messageId}. Ignored:`, state.locallyIgnoredTabs);
    } else {
        console.log(`Tab ${tabId} was already marked as ignored for message ${messageId}.`);
    }
}

/**
 * 创建欢迎消息，包含动态快捷操作
 * @param {object} currentTranslations - 当前翻译对象
 * @returns {Promise<HTMLElement>} 欢迎消息元素
 */
export async function createWelcomeMessage(currentTranslations) {
    const welcomeMessage = document.createElement('div');
    welcomeMessage.className = 'welcome-message';

    // 获取快捷操作
    let quickActions = [];
    if (window.QuickActionsManager) {
        try {
            // 检查快捷操作管理器是否已初始化
            if (window.QuickActionsManager.isQuickActionsManagerInitialized &&
                window.QuickActionsManager.isQuickActionsManagerInitialized()) {
                quickActions = window.QuickActionsManager.getAllQuickActions();
                console.log('[createWelcomeMessage] Found', quickActions.length, 'quick actions:', quickActions);
            } else {
                console.warn('[createWelcomeMessage] QuickActionsManager not yet initialized, using empty actions');
                quickActions = [];
            }
        } catch (error) {
            console.warn('[createWelcomeMessage] Error getting quick actions:', error);
            quickActions = [];
        }
    } else {
        console.warn('[createWelcomeMessage] QuickActionsManager not available in global scope');
    }

    // 生成快捷操作按钮HTML
    const quickActionsHtml = quickActions.map(action => {
        return `
            <button class="quick-action-btn" data-action-id="${action.id}" data-prompt="${escapeHtml(action.prompt)}" data-ignore-assistant="${action.ignoreAssistant}">
                ${escapeHtml(action.name)}
            </button>
        `;
    }).join('');

    welcomeMessage.innerHTML = `
        ${quickActionsHtml ? `<div class="quick-actions">${quickActionsHtml}</div>` : ''}
    `;

    // 为所有快捷操作按钮添加事件监听器
    const actionButtons = welcomeMessage.querySelectorAll('.quick-action-btn');
    actionButtons.forEach(button => {
        button.addEventListener('click', () => {
            const actionId = button.dataset.actionId;
            const prompt = button.dataset.prompt;
            const ignoreAssistant = button.dataset.ignoreAssistant === 'true';

            // 点击快捷操作后先移除欢迎消息，释放空间
            try {
                const parentWelcome = button.closest('.welcome-message');
                if (parentWelcome && parentWelcome.parentNode) {
                    parentWelcome.parentNode.removeChild(parentWelcome);
                }
            } catch (e) {
                console.warn('[createWelcomeMessage] Failed to remove welcome message on quick action click:', e);
            }

            // 触发快捷操作
            if (window.triggerQuickAction) {
                window.triggerQuickAction(actionId, prompt, ignoreAssistant);
            } else {
                console.warn('Quick action trigger function not available');
            }
        });
    });

    return welcomeMessage;
}

// 辅助函数：HTML转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
