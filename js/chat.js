/**
 * Pagetalk - Chat Core Logic
 */
import { generateUniqueId } from './utils.js';
import { tr as _ } from './utils/i18n.js';

// 使用 utils/i18n.js 提供的 tr 作为翻译函数

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
    const modelInfos = selectedModels
        .map(modelId => getModelInfo(modelId, elements))
        .filter(info => info !== null);

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

    modelInfos.forEach(modelInfo => {
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
    const promises = modelInfos.map(async (modelInfo) => {
        const modelId = modelInfo.modelId;

        try {
            // 创建临时状态，使用当前模型
            const tempState = {
                ...state,
                model: modelId,
                chatHistory: buildModelSpecificHistory(state.chatHistory, modelId)
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

            // 累积的响应内容
            let accumulatedContent = '';
            let hasReceivedFirstChunk = false;

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

                    // 使用 MarkdownRenderer 渲染内容
                    const formattedContent = window.MarkdownRenderer.render(content);
                    messageContent.innerHTML = formattedContent;

                    // 绑定思考块的点击事件
                    if (window.bindThinkingBlockEvents) {
                        window.bindThinkingBlockEvents(messageContent);
                    }

                    // 滚动
                    if (!state.userScrolledUpDuringStream) {
                        elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
                    }
                },
                finalizeBotMessage: (el, content) => {
                    accumulatedContent = content || accumulatedContent;
                    modelResponses[modelId] = accumulatedContent;

                    // 确保容器已显示
                    showContainer();

                    // 渲染最终内容
                    if (accumulatedContent) {
                        const formattedContent = window.MarkdownRenderer.render(accumulatedContent);
                        messageContent.innerHTML = formattedContent;
                    }

                    // 绑定思考块的点击事件
                    if (window.bindThinkingBlockEvents) {
                        window.bindThinkingBlockEvents(messageContent);
                    }

                    // 添加代码块复制按钮
                    if (window.addCopyButtonToCodeBlockCallback) {
                        messageContent.querySelectorAll('.code-block').forEach(block => {
                            window.addCopyButtonToCodeBlockCallback(block);
                        });
                    }

                    // 添加消息操作按钮（复制、重新生成、删除）
                    if (window.addMessageActionButtons) {
                        window.addMessageActionButtons(messageContent, accumulatedContent);
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
                    }
                },
                showToast: showToastCallback,
                restoreSendButtonAndInput: () => {
                    // API 层面发生错误时会调用这个回调
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
    restoreSendButtonAndInputCallback
) {
    // 获取模型信息
    const modelInfos = selectedModels
        .map(modelId => getModelInfo(modelId, elements))
        .filter(info => info !== null);

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

    modelInfos.forEach(modelInfo => {
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
    const promises = modelInfos.map(async (modelInfo) => {
        const modelId = modelInfo.modelId;

        try {
            // 创建临时状态，使用当前模型和提供的历史记录
            const tempState = {
                ...state,
                model: modelId,
                chatHistory: buildModelSpecificHistory(historyForApi, modelId)
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

            // 累积的响应内容
            let accumulatedContent = '';
            let hasReceivedFirstChunk = false;

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

                    // 使用 MarkdownRenderer 渲染内容
                    const formattedContent = window.MarkdownRenderer.render(content);
                    messageContent.innerHTML = formattedContent;

                    // 绑定思考块的点击事件
                    if (window.bindThinkingBlockEvents) {
                        window.bindThinkingBlockEvents(messageContent);
                    }

                    // 滚动
                    if (!state.userScrolledUpDuringStream) {
                        elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
                    }
                },
                finalizeBotMessage: (el, content) => {
                    accumulatedContent = content || accumulatedContent;
                    modelResponses[modelId] = accumulatedContent;

                    // 确保容器已显示
                    showContainer();

                    // 渲染最终内容
                    if (accumulatedContent) {
                        const formattedContent = window.MarkdownRenderer.render(accumulatedContent);
                        messageContent.innerHTML = formattedContent;
                    }

                    // 绑定思考块的点击事件
                    if (window.bindThinkingBlockEvents) {
                        window.bindThinkingBlockEvents(messageContent);
                    }

                    // 添加代码块复制按钮
                    if (window.addCopyButtonToCodeBlockCallback) {
                        messageContent.querySelectorAll('.code-block').forEach(block => {
                            window.addCopyButtonToCodeBlockCallback(block);
                        });
                    }

                    // 添加消息操作按钮（复制、重新生成、删除）
                    if (window.addMessageActionButtons) {
                        window.addMessageActionButtons(messageContent, accumulatedContent);
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
                    }
                },
                showToast: showToastCallback,
                restoreSendButtonAndInput: () => {
                    // API 层面发生错误时会调用这个回调
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
    const { text: userMessageText, images: userImages, videos: userVideos } = extractPartsFromMessage(userMessageData);

    // 提取上下文标签页
    const contextTabsForApi = userMessageData.sentContextTabsInfo || [];

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
        const tempState = {
            ...state,
            model: modelId,
            chatHistory: buildModelSpecificHistory(historyForApi, modelId)
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

    // Re-add welcome message with dynamic quick actions
    const welcomeMessage = await createWelcomeMessage(currentTranslations);
    elements.chatMessages.appendChild(welcomeMessage);

    clearImagesCallback(); // Clear images using callback
    clearVideosCallback(); // Clear videos using callback
    if (showToast) {
        showToastCallback(_('contextClearedSuccess', {}, currentTranslations), 'success');
    }
}

/**
 * Deletes a specific message from chat history and UI.
 * @param {string} messageId - The ID of the message to delete.
 * @param {object} state - Global state reference
 */
export function deleteMessage(messageId, state) {
    // 首先尝试查找普通消息
    const messageElement = document.querySelector(`.message[data-message-id="${messageId}"]`);
    let domRemoved = false;

    if (messageElement) {
        // 循环删除所有与此消息关联的前置容器（图片、标签页等）
        let prevSibling = messageElement.previousElementSibling;
        while (prevSibling && prevSibling.dataset.messageIdRef === messageId) {
            const siblingToRemove = prevSibling;
            prevSibling = siblingToRemove.previousElementSibling; // 先移动指针
            siblingToRemove.remove(); // 再删除
        }
        messageElement.remove();
        domRemoved = true;
    } else {
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

    const messageIndex = state.chatHistory.findIndex(msg => msg.id === messageId);
    let historyRemoved = false;
    if (messageIndex !== -1) {
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
    const { text: userMessageText, images: userImages, videos: userVideos } = extractPartsFromMessage(userMessageData); // Use helper

    // 新增：提取该用户轮次最初发送的上下文标签页
    const previouslySentContextTabsFromHistory = userMessageData.sentContextTabsInfo || []; // 确保是数组 [{id, title, content}]

    // Prepare history up to (but not including) the user message of the turn
    const historyForApi = state.chatHistory.slice(0, userIndex);

    // Remove old AI response(s) following the user message
    let removedAICount = 0;
    while (state.chatHistory[userIndex + 1]?.role === 'model') {
        const oldAiMessageId = state.chatHistory[userIndex + 1].id;
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
            restoreSendButtonAndInputCallback
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
                    window.finalizeBotMessage(el, content);
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
 * @param {Array} chatHistory - 原始聊天历史
 * @param {string} modelId - 目标模型ID
 * @returns {Array} 该模型专属的历史记录副本
 */
function buildModelSpecificHistory(chatHistory, modelId) {
    return chatHistory.map(msg => {
        if (msg.role === 'model' && msg.multiModelResponses && msg.multiModelResponses[modelId]) {
            return {
                ...msg,
                parts: [{ text: msg.multiModelResponses[modelId] }]
            };
        }
        return msg;
    });
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
        <h2>${_('welcomeHeading', {}, currentTranslations)}</h2>
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
