/**
 * Pagetalk - Main Sidepanel Script (Coordinator)
 */

// --- Imports ---
import { generateUniqueId } from './utils.js';
import { renderDynamicContent, rerenderAllMermaidCharts, showMermaidModal, hideMermaidModal } from './render.js';
import { applyTheme, updateMermaidTheme, toggleTheme, makeDraggable, loadButtonPosition, setThemeButtonVisibility } from './theme.js';
import { setupImagePaste, handleImageSelect, handleImageFile, updateImagesPreview, removeImageById, clearImages, showFullSizeImage, hideImageModal } from './image.js';
import { handleYouTubeUrl, updateVideosPreview, removeVideoById, clearVideos, showYouTubeDialog, hideYouTubeDialog } from './video.js';
// Correctly import autoSaveAgentSettings with an alias
import {
    loadAgents,
    updateAgentsListUI,
    createNewAgent,
    showDeleteConfirmDialog,
    confirmDeleteAgent,
    switchAgent,
    updateAgentSelectionInChat,
    saveAgentsList,
    saveCurrentAgentId,
    handleAgentExport,
    handleAgentImport,
    loadCurrentAgentSettingsIntoState,
    flushPendingAgentSaves,
    autoSaveAgentSettings as autoSaveAgentSettingsFromAgent // Alias the import
} from './agent.js';
import { loadSettings as loadAppSettings, handleLanguageChange, handleBotBoldHighlightColorChange, saveMermaidOverviewSettings, handleExportChat, handleCopyChat, handleObsidianSettingsChange, handleFollowUpQuestionSettingsChange, initModelSelection, updateModelCardsDisplay, handleProxyAddressChange, handleProxyTest, setupProviderEventListeners, initQuickActionsSettings, renderQuickActionsList } from './settings.js';
import { handleExportToObsidian } from './obsidian-export.js';
import { parseChatMarkdown } from './export-utils.js';
import {
    initFollowUpQuestionState,
    clearFollowUpQuestions,
    removeFollowUpQuestionsForMessageIds,
    rebindFollowUpQuestionsForResponse,
    generateFollowUpQuestionsForResponse as generateFollowUpQuestionsForResponseAction
} from './follow-up-questions.js';
import * as QuickActionsManager from './quick-actions-manager.js';
import { initTextSelectionHelperSettings, isTextSelectionHelperEnabled } from './text-selection-helper-settings.js';
import { sendUserMessage as sendUserMessageAction, clearContext as clearContextAction, deleteMessage as deleteMessageAction, regenerateMessage as regenerateMessageAction, abortStreaming as abortStreamingAction, handleRemoveSentTabContext as handleRemoveSentTabContextAction, createWelcomeMessage } from './chat.js';
import {
    switchTab,
    switchSettingsSubTab,
    addMessageToChat,
    updateStreamingMessage as uiUpdateStreamingMessage, // Renamed import
    finalizeBotMessage as uiFinalizeBotMessage,       // Renamed import
    addThinkingAnimation as uiAddThinkingAnimation,     // Renamed import for clarity
    showConnectionStatus,
    updateConnectionIndicator,
    updateContextStatus,
    showToast,
    resizeTextarea,
    setupAutoresizeTextarea,
    updateUIElementsWithTranslations,
    restoreSendButtonAndInput,
    toggleApiKeyVisibility,
    showChatStatusMessage,
    addCopyButtonToCodeBlock,
    addMessageActionButtons,
    applyBotMessageHeadingColor,
    postProcessBotMessageContent,
    resetBotMessageHeadingColors,
    showCopyCodeFeedback,
    showCopyMessageFeedback,
    showTabSelectionPopupUI,
    closeTabSelectionPopupUI as uiCloseTabSelectionPopupUI, // Alias to avoid naming conflict if any future local var
    updateSelectedTabsBarUI,
    createMultiModelResponseContainer,
    addThinkingAnimationToColumn,
    updateMultiModelStreamingMessage,
    finalizeMultiModelMessage,
    showMultiModelError,
    bindThinkingBlockEvents
} from './ui.js';
import { initCometCaret } from './comet-caret.js';
import { getPageContextStatus, getPageContextTextForPrompt, getPageContextCharCount } from './context-state.js';

const MERMAID_OVERVIEW_IDLE = 'idle';
const MERMAID_OVERVIEW_GENERATING = 'generating';
const MERMAID_OVERVIEW_READY = 'ready';
const MERMAID_OVERVIEW_ERROR = 'error';

// --- State Management ---
const state = {
    apiKey: '',
    model: 'google::gemini-2.5-flash',
    selectedModels: [], // 新增：多模型选择数组
    agents: [],
    currentAgentId: null,
    // Settings derived from current agent
    systemPrompt: '',
    temperature: 0.7,
    maxTokens: '', // 改为空值，让模型使用自己的默认值
    // Other state
    pageContext: null, // Use null initially to indicate not yet extracted
    pageTitle: '', // 当前页面标题，用于保存对话时作为标题
    pageUrl: '',
    pageContextMeta: null,
    removeContextWebLinks: true,
    removeContextSitePaths: true,
    chatHistory: [],
    isConnected: false,
    hasDeterminedConnection: false, // 新增：是否已判定连接状态，避免初始闪烁
    images: [],
    videos: [],
    darkMode: false,
    hasWebpageTheme: false,
    language: 'en', // Changed default language to English
    proxyAddress: '', // 代理地址
    botBoldHighlightColor: 'none',
    mermaidOverviewModel: '',
    mermaidOverviewSummaryPrompt: '',
    mermaidOverviewDiagramPrompt: '',
    followUpQuestionSettings: null,
    followUpQuestionsByResponseId: {},
    obsidianExportSettings: null,
    isStreaming: false,
    userScrolledUpDuringStream: false, // 新增：跟踪用户在流式传输期间是否已向上滚动
    // userHasSetPreference: false, // Removed
    selectedContextTabs: [], // 新增：存储用户选择的用于上下文的标签页
    availableTabsForSelection: [], // 新增：存储查询到的供用户选择的标签页
    isTabSelectionPopupOpen: false, // 新增：跟踪标签页选择弹窗的状态
    locallyIgnoredTabs: {}, // 新增: 跟踪用户从特定消息上下文中移除的标签页 { messageId: [tabId1, tabId2] }
    quickActionIgnoreAssistant: false, // 新增：快捷操作忽略助手标记
};

function createDefaultMermaidOverviewState(overrides = {}) {
    return {
        status: MERMAID_OVERVIEW_IDLE,
        linkedResponseId: '',
        generatorModel: '',
        summaryPromptSnapshot: '',
        diagramPromptSnapshot: '',
        summaryText: '',
        mermaidCode: '',
        generatedAt: 0,
        errorMessage: '',
        ...overrides
    };
}

const THEME_READY_TIMEOUT_MS = 800;
let themeReadyTimeoutId = null;
let activeMermaidOverviewMessageId = null;
let expandedSavedSessionTopicKey = null;
let isSavingChatSession = false;
let contextPreviewSearchState = {
    query: '',
    matches: [],
    activeIndex: -1
};

function startThemeReadyTimeout() {
    if (!document.body || !document.body.classList.contains('theme-pending')) {
        return;
    }
    if (themeReadyTimeoutId) {
        clearTimeout(themeReadyTimeoutId);
    }
    themeReadyTimeoutId = setTimeout(() => {
        console.warn('[main.js] Theme detection timed out, showing panel with current theme');
        markThemeReady();
    }, THEME_READY_TIMEOUT_MS);
}

function markThemeReady() {
    if (themeReadyTimeoutId) {
        clearTimeout(themeReadyTimeoutId);
        themeReadyTimeoutId = null;
    }
    // 移除 theme-pending 类（在 body 上）
    if (document.body && document.body.classList.contains('theme-pending')) {
        document.body.classList.remove('theme-pending');
    }
}

// Default settings (used by agent module)
const defaultSettings = {
    systemPrompt: '',
    temperature: 0.7,
    maxTokens: '', // 改为空值，让模型使用自己的默认值
};
// Default agent (used by agent module)
const defaultAgent = {
    id: 'default',
    name: 'Default', // Base name, will be translated on load
    ...defaultSettings
};

// --- DOM Elements ---
const elements = {
    // Main Navigation & Content
    tabs: document.querySelectorAll('.footer-tab'),
    tabContents: document.querySelectorAll('.tab-content'),
    // Chat Interface
    chatMessages: document.getElementById('chat-messages'),
    chatInputWrapper: document.querySelector('.chat-input-wrapper'),
    userInput: document.getElementById('user-input'),
    sendMessage: document.getElementById('send-message'),
    summarizeButton: document.getElementById('summarize-page'), // Note: This might be dynamically added now
    chatModelSelection: document.getElementById('chat-model-selection'),
    chatAgentSelection: document.getElementById('chat-agent-selection'),
    clearContextBtn: document.getElementById('clear-context'),
    saveChatSessionBtn: document.getElementById('save-chat-session'),
    chatHistoryBtn: document.getElementById('chat-history-btn'),
    exportChatToObsidianBtn: document.getElementById('export-chat-to-obsidian'),
    savedSessionsPopup: document.getElementById('saved-sessions-popup'),
    savedSessionsList: document.getElementById('saved-sessions-list'),
    savedSessionsEmpty: document.getElementById('saved-sessions-empty'),
    closeSavedSessionsBtn: document.getElementById('close-saved-sessions'),
    closePanelBtnChat: document.getElementById('close-panel'),
    // 新增：加号菜单和模型选择器元素
    attachmentMenuBtn: document.getElementById('attachment-menu-btn'),
    attachmentMenu: document.getElementById('attachment-menu'),
    inlineModelSelector: document.getElementById('inline-model-selector'),
    expandChatInputBtn: document.getElementById('expand-chat-input'),
    currentModelDisplay: document.getElementById('current-model-display'),
    modelSelectorMenu: document.getElementById('model-selector-menu'),
    uploadImage: document.getElementById('upload-image'),
    fileInput: document.getElementById('file-input'),
    addYoutubeUrl: document.getElementById('add-youtube-url'),
    imagePreviewContainer: document.getElementById('image-preview-container'),
    imagesGrid: document.getElementById('images-grid'),
    videoPreviewContainer: document.getElementById('video-preview-container'),
    videosGrid: document.getElementById('videos-grid'),
    youtubeUrlDialog: document.getElementById('youtube-url-dialog'),
    youtubeUrlInput: document.getElementById('youtube-url-input'),
    cancelYoutube: document.getElementById('cancel-youtube'),
    confirmYoutube: document.getElementById('confirm-youtube'),
    imageModal: document.getElementById('image-modal'),
    modalImage: document.getElementById('modal-image'),
    closeModal: document.querySelector('.close-modal'),
    mermaidModal: document.getElementById('mermaid-modal'),
    mermaidModalContent: document.getElementById('mermaid-modal-content'),
    mermaidModalFooter: document.getElementById('mermaid-modal-footer'),
    mermaidModalRegenerateBtn: document.getElementById('mermaid-modal-regenerate'),
    mermaidCloseModal: document.querySelector('.mermaid-close-modal'),
    chatStatusMessage: document.getElementById('chat-status-message'),
    // Settings Interface
    settingsSection: document.getElementById('settings'),
    settingsNavBtns: document.querySelectorAll('.settings-nav-btn'),
    settingsSubContents: document.querySelectorAll('.settings-sub-content'),
    closePanelBtnSettings: document.getElementById('close-panel-settings'),
    // Settings - General
    languageSelect: document.getElementById('language-select'),
    botBoldHighlightColorSelect: document.getElementById('bot-bold-highlight-color'),
    mermaidOverviewModelSelect: document.getElementById('mermaid-overview-model'),
    mermaidOverviewSummaryPromptTextarea: document.getElementById('mermaid-overview-summary-prompt'),
    mermaidOverviewDiagramPromptTextarea: document.getElementById('mermaid-overview-diagram-prompt'),
    followUpQuestionsEnabledToggle: document.getElementById('follow-up-questions-enabled'),
    followUpQuestionsModelSelect: document.getElementById('follow-up-questions-model'),
    followUpQuestionsPromptTextarea: document.getElementById('follow-up-questions-prompt'),
    proxyAddressInput: document.getElementById('proxy-address-input'),
    testProxyBtn: document.getElementById('test-proxy-btn'),
    themeToggleBtnSettings: document.getElementById('theme-toggle-btn'), // Draggable button
    moonIconSettings: document.getElementById('moon-icon'),
    sunIconSettings: document.getElementById('sun-icon'),
    exportFormatSelect: document.getElementById('export-format'),
    importChatHistoryBtn: document.getElementById('import-chat-history'),
    importChatHistoryInput: document.getElementById('import-chat-history-input'),
    exportChatHistoryBtn: document.getElementById('export-chat-history'),
    copyChatHistoryBtn: document.getElementById('copy-chat-history'),
    obsidianVaultInput: document.getElementById('obsidian-vault-input'),
    obsidianFolderInput: document.getElementById('obsidian-folder-input'),
    obsidianNoteNameInput: document.getElementById('obsidian-note-name-input'),
    obsidianFrontmatterTemplateTextarea: document.getElementById('obsidian-frontmatter-template'),
    obsidianBodyTemplateTextarea: document.getElementById('obsidian-body-template'),
    obsidianSilentOpenToggle: document.getElementById('obsidian-silent-open'),
    obsidianAiEnabledToggle: document.getElementById('obsidian-ai-enabled'),
    obsidianAiModelSelect: document.getElementById('obsidian-ai-model'),
    obsidianAiPromptTextarea: document.getElementById('obsidian-ai-prompt'),
    exportToObsidianBtn: document.getElementById('export-to-obsidian'),
    // Unified Import/Export
    exportAllSettingsBtn: document.getElementById('export-all-settings'),
    importAllSettingsBtn: document.getElementById('import-all-settings'),
    unifiedImportInput: document.getElementById('unified-import-input'),
    // Settings - Agent
    agentsList: document.getElementById('agents-list'),
    addNewAgent: document.getElementById('add-new-agent'),
    deleteConfirmDialog: document.getElementById('delete-confirm-dialog'),
    deleteAgentNameSpan: document.getElementById('delete-agent-name'), // Span inside prompt
    confirmDelete: document.getElementById('confirm-delete'),
    cancelDelete: document.getElementById('cancel-delete'),
    importAgentsBtn: document.getElementById('import-agents'),
    importAgentInput: document.getElementById('import-agent-input'),
    exportAgentsBtn: document.getElementById('export-agents'),
    // Settings - Model
    apiKey: null, // 多供应商模式下不再使用单一API Key
    modelSelection: document.getElementById('model-selection'),
    selectedModelsContainer: document.getElementById('selected-models-container'),

    connectionStatus: document.getElementById('connection-status'),
    toggleApiKey: null, // 多供应商模式下不再使用单一切换按钮
    apiKeyInput: null, // 多供应商模式下不再使用单一API Key输入框
    // Footer Status Bar
    contextStatus: document.getElementById('context-status'),
    contextStatusText: document.getElementById('context-status-text'),
    connectionIndicator: document.getElementById('connection-indicator'),
    contextPreviewModal: document.getElementById('context-preview-modal'),
    contextPreviewMeta: document.getElementById('context-preview-meta'),
    contextPreviewContent: document.getElementById('context-preview-content'),
    contextPreviewCopy: document.getElementById('context-preview-copy'),
    contextPreviewRemoveLinks: document.getElementById('context-preview-remove-links'),
    contextPreviewRemoveSitePaths: document.getElementById('context-preview-remove-site-paths'),
    contextPreviewSearch: document.getElementById('context-preview-search'),
    contextPreviewSearchPrev: document.getElementById('context-preview-search-prev'),
    contextPreviewSearchNext: document.getElementById('context-preview-search-next'),
    contextPreviewSelectArea: document.getElementById('context-preview-select-area'),
    contextPreviewCloseIcon: document.getElementById('context-preview-close-icon'),
    // Chat Navigation Buttons
    navToTop: document.getElementById('nav-to-top'),
    navUserQuestions: document.getElementById('nav-user-questions'),
    navUserQuestionsPanel: document.getElementById('nav-user-questions-panel'),
    navToBottom: document.getElementById('nav-to-bottom'),
};

elements.handleMermaidModalContextChange = (context) => {
    const overviewMessageId = context?.type === 'overview' ? context.userMessageId : null;
    activeMermaidOverviewMessageId = overviewMessageId || null;
    updateMermaidModalRegenerateButton();
};

// --- Translation ---
let currentTranslations = {}; // Loaded from translations.js
function _(key, replacements = {}) {
    // 优先使用统一 i18n 工具（若可用），并传入当前翻译对象
    if (window.I18n && typeof window.I18n.tr === 'function') {
        return window.I18n.tr(key, replacements, currentTranslations);
    }
    // 回退：使用 main.js 维护的当前翻译对象
    let translation = currentTranslations[key] || key;
    for (const placeholder in replacements) {
        translation = translation.replace(`{${placeholder}}`, replacements[placeholder]);
    }
    return translation;
}

// --- Scroll Tracking ---
let isUserNearBottom = true; // This remains the live state
const SCROLL_THRESHOLD = 30; // Increased threshold slightly
let userQuestionNavSignature = '';

function hasVisibleBotResponses() {
    if (!elements.chatMessages) return false;
    return Boolean(elements.chatMessages.querySelector('.bot-message:not(.thinking)'));
}

function syncChatInputVisibility() {
    if (!elements.chatInputWrapper) return;
    elements.chatInputWrapper.classList.toggle('collapsed-with-responses', hasVisibleBotResponses());
}

function setupChatMessagesObserver() {
    if (!elements.chatMessages) return;

    const observer = new MutationObserver(() => {
        syncChatInputVisibility();
        updateUserQuestionNav();
    });

    observer.observe(elements.chatMessages, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });

    syncChatInputVisibility();
    updateUserQuestionNav();
}


// --- Initialization ---
async function init() {
    console.log("Pagetalk Initializing...");
    initFollowUpQuestionState(state);

    // Listen for content script messages early to avoid missing initial theme updates.
    window.addEventListener('message', handleContentScriptMessages);
    requestThemeFromContentScript();

    // Initialize ModelManager first
    if (window.ModelManager?.instance) {
        try {
            await window.ModelManager.instance.initialize();
            console.log('[main.js] ModelManager initialized successfully');
        } catch (error) {
            console.error('[main.js] Failed to initialize ModelManager:', error);
        }
    } else {
        console.error('[main.js] ModelManager not available');
    }

    // Ensure delete-confirm dialog exists before wiring events
    ensureDeleteConfirmDialogStructure();

    // Load settings (app, agents) - this also loads language and applies initial theme/translations
    loadAppSettings(
        state, elements,
        () => updateConnectionIndicator(state.isConnected, elements, currentTranslations), // Pass updateConnectionIndicator directly
        loadAndApplyTranslations, // Pass translation loader
        (isDark) => applyTheme(isDark, elements), // Pass applyTheme
        () => {
            // Settings loaded callback
            console.log('[main.js] Settings loaded, updating current model display');
            updateCurrentModelDisplay();
        }
    );
    loadAgents(
        state,
        () => updateAgentsListUI(state, elements, currentTranslations, autoSaveAgentSettings, showDeleteConfirmDialogUI, switchAgentAndUpdateState), // Pass agent UI update. autoSaveAgentSettings here is the main.js wrapper.
        () => updateAgentSelectionInChat(state, elements, currentTranslations), // Pass chat dropdown update with translations
        () => saveCurrentAgentId(state), // Pass save current ID
        currentTranslations // Pass translations for default agent name
    );

    // Load draggable button position
    loadButtonPosition(elements);
    if (elements.themeToggleBtnSettings) {
        setTimeout(() => {
            makeDraggable(elements.themeToggleBtnSettings, () => toggleThemeAndUpdate(state, elements, rerenderAllMermaidChartsUI)); // Pass toggleTheme callback
        }, 100);
    }

    // Setup core features
    await initModelSelection(state, elements); // Populate model dropdowns (now async)
    updateCurrentModelDisplay(); // 初始化内联模型显示

    // 确保翻译已加载后再初始化划词助手设置和快捷操作设置
    setTimeout(async () => {
        console.log('[main.js] Initializing text selection helper with translations:', currentTranslations);
        await initTextSelectionHelperSettings(elements, currentTranslations, showToastUI); // Initialize text selection helper settings

        console.log('[main.js] Initializing quick actions manager...');
        // 先初始化快捷操作管理器
        await QuickActionsManager.initQuickActionsManager();

        // 设置全局快捷操作相关函数
        setupQuickActionsGlobals();

        console.log('[main.js] Initializing quick actions settings with translations:', currentTranslations);
        await initQuickActionsSettings(elements, currentTranslations); // Initialize quick actions settings

        // 初始化欢迎消息（如果聊天区域为空）
        if (elements.chatMessages && elements.chatMessages.children.length === 0) {
            // 确保快捷操作管理器已经初始化后再创建欢迎消息
            const welcomeMessage = await createWelcomeMessage(currentTranslations);
            elements.chatMessages.appendChild(welcomeMessage);
            syncChatInputVisibility();
            console.log('[main.js] Initial welcome message created with quick actions');
        }
    }, 100); // 给翻译加载一些时间
    setupEventListeners(); // Setup all event listeners
    setupImagePaste(elements, (file) => handleImageFile(file, state, updateImagesPreviewUI)); // Setup paste
    setupAutoresizeTextarea(elements); // Setup textarea resize
    setupChatMessagesObserver();

    // Initialize comet caret animation for chat input
    let cometCaretInstance = null;
    if (elements.userInput) {
        cometCaretInstance = initCometCaret(elements.userInput);
        console.log('[main.js] Comet caret initialized for user input');
    }

    // Expose global function to update comet caret position
    // Used when textarea value is programmatically changed (e.g., quick actions, send message)
    window.updateCometCaret = () => {
        if (cometCaretInstance) {
            cometCaretInstance.update();
        }
    };

    // Initial UI updates
    // 避免尚未判定连接状态时显示“未连接”造成闪烁
    if (state.hasDeterminedConnection) {
        updateConnectionIndicator(state.isConnected, elements, currentTranslations);
    }
    updateFooterContextStatusFromState();

    // Request page content after setup
    requestPageContent();

    // Mermaid Initialization (ensure library is loaded)
    if (typeof mermaid !== 'undefined') {
        try {
            mermaid.initialize({
                startOnLoad: false,
                theme: state.darkMode ? 'dark' : 'default',
                logLevel: 'error'
            });
            console.log('Mermaid initialized.');
        } catch (error) {
            console.error('Mermaid initialization failed:', error);
        }
    } else {
        console.warn('Mermaid library not found during init.');
    }

    // Set initial visibility for theme button - ensure it's hidden on chat tab
    const initialTab = document.querySelector('.footer-tab.active')?.dataset.tab || 'chat';
    setThemeButtonVisibility(initialTab, elements);

    // Additional safety check to ensure button is hidden on chat tab
    if (initialTab === 'chat' && elements.themeToggleBtnSettings) {
        elements.themeToggleBtnSettings.style.display = 'none';
        elements.themeToggleBtnSettings.style.visibility = 'hidden';
    }

    // Global Exposures for API module callbacks
    // These wrappers ensure that the live `isUserNearBottom` from main.js is used.

    // Wrapper for ui.js's updateStreamingMessage
    window.updateStreamingMessage = (messageElement, content) => {
        // `elements` is live from main.js's scope
        // Determine if scroll should happen based on the new logic
        const shouldScroll = state.isStreaming ? !state.userScrolledUpDuringStream : isUserNearBottom;
        uiUpdateStreamingMessage(messageElement, content, shouldScroll, elements); // Pass the decision
    };

    // Wrapper for ui.js's finalizeBotMessage
    window.finalizeBotMessage = (messageElement, finalContent, options = {}) => {
        // `elements`, `addCopyButtonToCodeBlockUI`,
        // `addMessageActionButtonsUI`, `restoreSendButtonAndInputUI`
        // are all live from main.js's scope
        const shouldScroll = state.isStreaming ? !state.userScrolledUpDuringStream : isUserNearBottom; // Similar logic for finalize
        uiFinalizeBotMessage(messageElement, finalContent, addCopyButtonToCodeBlockUI, addMessageActionButtonsUI, restoreSendButtonAndInputUI, shouldScroll, elements);
        if (!options.suppressFollowUp) {
            const responseMessageId = messageElement?.dataset?.messageId || '';
            setTimeout(() => triggerFollowUpQuestionsForResponse(responseMessageId), 0);
        }
    };

    // 确保在所有初始化完成后，输入框获得焦点
    if (elements.userInput) {
        setTimeout(() => elements.userInput.focus(), 150); // 增加延迟以确保DOM完全准备好
    }

    // Expose the handler on the window object so ui.js can call it
    window.handleRemoveSentTabContext = (messageId, tabId) => {
        handleRemoveSentTabContextAction(messageId, tabId, state);
    };

    window.generateFollowUpQuestionsForResponse = ({ userMessageId = '', responseMessageId = '', force = false } = {}) => {
        triggerFollowUpQuestionsForResponse(responseMessageId, userMessageId, force);
    };

    window.rebindFollowUpQuestionsForResponse = ({ oldResponseMessageIds = [], newResponseMessageId = '' } = {}) => {
        rebindFollowUpQuestionsForResponse({
            oldResponseMessageIds,
            newResponseMessageId,
            state,
            elements,
            currentTranslations,
            sendMessage: sendFollowUpQuestionText
        });
    };

    // Expose text selection helper functions to global scope
    window.isTextSelectionHelperEnabled = isTextSelectionHelperEnabled;

    // Expose state object to global scope for settings functions
    window.state = state;

    // Expose addCopyButtonToCodeBlock for multi-model responses
    window.addCopyButtonToCodeBlockCallback = (block) => {
        addCopyButtonToCodeBlockUI(block);
    };

    // Expose bindThinkingBlockEvents for multi-model responses
    window.bindThinkingBlockEvents = bindThinkingBlockEvents;

    console.log("Pagetalk Initialized.");
}

// --- Event Listener Setup ---
function setupEventListeners() {
    // Footer Tabs
    elements.tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            flushPendingAgentSaves(elements);
            // 新增：在切换标签页前关闭标签页选择弹窗
            closeTabSelectionPopupUIFromMain();
            // 调用 ui.js 中的 switchTab (假设 switchTab 是一个可访问的函数，或者这部分逻辑在 main.js 中)
            switchTab(tabId, elements, (subTab) => switchSettingsSubTab(subTab, elements));
            setThemeButtonVisibility(tabId, elements); // Update button visibility on tab switch

            // 额外的安全检查：确保主题按钮在聊天界面被隐藏
            if (tabId === 'chat' && elements.themeToggleBtnSettings) {
                elements.themeToggleBtnSettings.style.display = 'none';
                elements.themeToggleBtnSettings.style.visibility = 'hidden';
            }

            // 新增：如果切换到聊天标签页，则聚焦输入框
            if (tabId === 'chat' && elements.userInput) {
                // 使用 setTimeout 确保在标签页内容完全显示后再聚焦
                setTimeout(() => elements.userInput.focus(), 50);
                // console.log("User input focused on tab switch to chat (from main.js event listener).");
            }
        });
    });

    // Settings Sub-Tabs
    elements.settingsNavBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            flushPendingAgentSaves(elements);
            switchSettingsSubTab(btn.dataset.subtab, elements);
        });
    });

    // Chat Actions
    elements.sendMessage.addEventListener('click', handleSendButtonClick); // Initial listener
    elements.userInput.addEventListener('keydown', handleUserInputKeydown);
    // 新增：监听用户输入框的 input 事件，用于检测 "@"
    elements.userInput.addEventListener('input', handleUserInputForTabSelection);
    if (elements.contextStatus) {
        elements.contextStatus.addEventListener('click', openContextPreviewModal);
    }
    elements.clearContextBtn.addEventListener('click', async () => {
        await clearContextAction(state, elements, clearImagesUI, clearVideosUI, showToastUI, currentTranslations);
        clearFollowUpQuestions(state, elements);
        // Also clear the UI for selected tabs
        state.selectedContextTabs = [];
        updateSelectedTabsBarFromMain();
    });

    // 保存对话按钮事件
    if (elements.saveChatSessionBtn) {
        elements.saveChatSessionBtn.addEventListener('click', async () => {
            if (isSavingChatSession) return;

            isSavingChatSession = true;
            elements.saveChatSessionBtn.disabled = true;
            elements.saveChatSessionBtn.setAttribute('aria-busy', 'true');

            try {
                await saveChatSession(state, currentTranslations, showToastUI);
            } finally {
                isSavingChatSession = false;
                elements.saveChatSessionBtn.disabled = false;
                elements.saveChatSessionBtn.removeAttribute('aria-busy');
            }
        });
    }

    // 历史记录按钮事件
    if (elements.chatHistoryBtn) {
        elements.chatHistoryBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSavedSessionsPopup();
        });
    }

    if (elements.exportChatToObsidianBtn) {
        elements.exportChatToObsidianBtn.addEventListener('click', () => {
            handleExportToObsidian(state, elements, showToastUI, currentTranslations);
        });
    }

    // 关闭历史记录弹出层按钮
    if (elements.closeSavedSessionsBtn) {
        elements.closeSavedSessionsBtn.addEventListener('click', () => {
            hideSavedSessionsPopup();
        });
    }

    // 点击弹出层外部关闭
    document.addEventListener('click', (e) => {
        if (elements.savedSessionsPopup &&
            elements.savedSessionsPopup.style.display !== 'none' &&
            !elements.savedSessionsPopup.contains(e.target) &&
            e.target !== elements.chatHistoryBtn) {
            hideSavedSessionsPopup();
        }
    });

    elements.chatModelSelection.addEventListener('change', handleChatModelChange);
    elements.chatAgentSelection.addEventListener('change', handleChatAgentChange);

    // 新增：监听由 ui.js 触发的弹窗关闭事件，以同步状态
    document.addEventListener('tabPopupManuallyClosed', () => {
        if (state.isTabSelectionPopupOpen) {
            state.isTabSelectionPopupOpen = false;
            console.log("Tab selection popup closed via custom event, state updated.");
        }
    });

    // 新增：加号菜单交互
    if (elements.attachmentMenuBtn && elements.attachmentMenu) {
        elements.attachmentMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            elements.attachmentMenu.classList.toggle('show');
            // 同时关闭模型选择菜单
            if (elements.modelSelectorMenu) elements.modelSelectorMenu.classList.remove('show');
            if (elements.inlineModelSelector) elements.inlineModelSelector.classList.remove('active');
        });
    }

    // 新增：模型选择器交互
    if (elements.inlineModelSelector && elements.modelSelectorMenu) {
        elements.inlineModelSelector.addEventListener('click', (e) => {
            e.stopPropagation();
            elements.inlineModelSelector.classList.toggle('active');
            elements.modelSelectorMenu.classList.toggle('show');
            // 同时关闭加号菜单
            if (elements.attachmentMenu) elements.attachmentMenu.classList.remove('show');
            // 渲染模型菜单内容
            if (elements.modelSelectorMenu.classList.contains('show')) {
                renderModelSelectorMenu();
            }
        });
    }

    if (elements.expandChatInputBtn) {
        elements.expandChatInputBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleExpandedChatInput();
        });
    }

    // 点击外部关闭菜单
    document.addEventListener('click', (e) => {
        // 关闭加号菜单
        if (elements.attachmentMenu && !elements.attachmentMenu.contains(e.target) && e.target !== elements.attachmentMenuBtn) {
            elements.attachmentMenu.classList.remove('show');
        }
        // 关闭模型选择菜单
        if (elements.modelSelectorMenu && !elements.modelSelectorMenu.contains(e.target) && !elements.inlineModelSelector?.contains(e.target)) {
            elements.modelSelectorMenu.classList.remove('show');
            if (elements.inlineModelSelector) elements.inlineModelSelector.classList.remove('active');
        }
    });

    // Image Handling
    elements.uploadImage.addEventListener('click', (e) => {
        e.stopPropagation();
        elements.fileInput.click();
        // 点击上传后关闭加号菜单
        if (elements.attachmentMenu) elements.attachmentMenu.classList.remove('show');
    });
    elements.fileInput.addEventListener('change', (e) => handleImageSelect(e, (file) => handleImageFile(file, state, updateImagesPreviewUI), elements));
    elements.closeModal.addEventListener('click', () => hideImageModal(elements));
    window.addEventListener('click', (e) => { if (e.target === elements.imageModal) hideImageModal(elements); }); // Close modal on overlay click

    // YouTube Video Handling
    elements.addYoutubeUrl.addEventListener('click', (e) => {
        e.stopPropagation();
        showYouTubeDialog(elements);
        // 点击后关闭加号菜单
        if (elements.attachmentMenu) elements.attachmentMenu.classList.remove('show');
    });
    elements.cancelYoutube.addEventListener('click', () => hideYouTubeDialog(elements));
    elements.confirmYoutube.addEventListener('click', () => {
        const url = elements.youtubeUrlInput.value.trim();
        if (url) {
            handleYouTubeUrl(url, state, updateVideosPreviewUI, currentTranslations);
            hideYouTubeDialog(elements);
        }
    });
    elements.youtubeUrlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            elements.confirmYoutube.click();
        }
    });
    window.addEventListener('click', (e) => { if (e.target === elements.youtubeUrlDialog) hideYouTubeDialog(elements); }); // Close dialog on overlay click

    // Mermaid Modal
    elements.mermaidCloseModal.addEventListener('click', () => {
        activeMermaidOverviewMessageId = null;
        updateMermaidModalRegenerateButton();
        hideMermaidModal(elements);
    });
    elements.mermaidModal.addEventListener('click', (e) => {
        if (e.target === elements.mermaidModal) {
            activeMermaidOverviewMessageId = null;
            updateMermaidModalRegenerateButton();
            hideMermaidModal(elements);
        }
    });
    if (elements.mermaidModalRegenerateBtn) {
        elements.mermaidModalRegenerateBtn.addEventListener('click', () => {
            void regenerateMermaidOverviewFromModal();
        });
    }

    if (elements.contextPreviewCloseIcon) {
        elements.contextPreviewCloseIcon.addEventListener('click', closeContextPreviewModal);
    }
    if (elements.contextPreviewModal) {
        elements.contextPreviewModal.addEventListener('click', (e) => {
            if (e.target === elements.contextPreviewModal) {
                closeContextPreviewModal();
            }
        });
    }
    if (elements.contextPreviewCopy) {
        elements.contextPreviewCopy.addEventListener('click', () => {
            const pageContext = getPageContextTextForPrompt(state);
            if (!pageContext) return;

            window.parent.postMessage({ action: 'copyText', text: pageContext }, '*');
            showToastUI(_('copied', {}, currentTranslations), 'success');
        });
    }
    if (elements.contextPreviewRemoveLinks) {
        elements.contextPreviewRemoveLinks.checked = state.removeContextWebLinks !== false;
        elements.contextPreviewRemoveLinks.addEventListener('change', () => {
            state.removeContextWebLinks = elements.contextPreviewRemoveLinks.checked;
            if (isContextPreviewModalOpen()) {
                renderContextPreviewModal();
            }
        });
    }
    if (elements.contextPreviewRemoveSitePaths) {
        elements.contextPreviewRemoveSitePaths.checked = state.removeContextSitePaths !== false;
        elements.contextPreviewRemoveSitePaths.addEventListener('change', () => {
            state.removeContextSitePaths = elements.contextPreviewRemoveSitePaths.checked;
            if (isContextPreviewModalOpen()) {
                renderContextPreviewModal();
            }
        });
    }
    if (elements.contextPreviewSearch) {
        elements.contextPreviewSearch.addEventListener('input', () => {
            applyContextPreviewSearch(elements.contextPreviewSearch.value);
        });
    }
    if (elements.contextPreviewSearchPrev) {
        elements.contextPreviewSearchPrev.addEventListener('click', () => {
            navigateContextPreviewSearch(-1);
        });
    }
    if (elements.contextPreviewSearchNext) {
        elements.contextPreviewSearchNext.addEventListener('click', () => {
            navigateContextPreviewSearch(1);
        });
    }
    if (elements.contextPreviewSelectArea) {
        elements.contextPreviewSelectArea.addEventListener('click', () => {
            closeContextPreviewModal();
            window.parent.postMessage({ action: 'startPageAreaSelection' }, '*');
        });
    }

    // Settings Actions
    // Removed discover models button event listener



    // 多供应商模式下，API Key 可见性切换由 setupProviderEventListeners 处理
    // elements.toggleApiKey.addEventListener('click', () => toggleApiKeyVisibility(elements));
    elements.languageSelect.addEventListener('change', () => handleLanguageChange(state, elements, loadAndApplyTranslations, showToastUI, currentTranslations));
    if (elements.botBoldHighlightColorSelect) {
        elements.botBoldHighlightColorSelect.addEventListener('change', () => handleBotBoldHighlightColorChange(state, elements, showToastUI, currentTranslations));
    }
    if (elements.mermaidOverviewModelSelect) {
        elements.mermaidOverviewModelSelect.addEventListener('change', () => {
            saveMermaidOverviewSettings(state, elements, showToastUI, currentTranslations);
        });
    }
    if (elements.mermaidOverviewSummaryPromptTextarea) {
        elements.mermaidOverviewSummaryPromptTextarea.addEventListener('blur', () => {
            saveMermaidOverviewSettings(state, elements, showToastUI, currentTranslations);
        });
    }
    if (elements.mermaidOverviewDiagramPromptTextarea) {
        elements.mermaidOverviewDiagramPromptTextarea.addEventListener('blur', () => {
            saveMermaidOverviewSettings(state, elements, showToastUI, currentTranslations);
        });
    }
    if (elements.followUpQuestionsEnabledToggle) {
        elements.followUpQuestionsEnabledToggle.addEventListener('change', () => {
            handleFollowUpQuestionSettingsChange(state, elements, showToastUI, currentTranslations);
        });
    }
    if (elements.followUpQuestionsModelSelect) {
        elements.followUpQuestionsModelSelect.addEventListener('change', () => {
            handleFollowUpQuestionSettingsChange(state, elements, showToastUI, currentTranslations);
        });
    }
    if (elements.followUpQuestionsPromptTextarea) {
        elements.followUpQuestionsPromptTextarea.addEventListener('blur', () => {
            handleFollowUpQuestionSettingsChange(state, elements, showToastUI, currentTranslations);
        });
    }
    if (elements.importChatHistoryBtn && elements.importChatHistoryInput) {
        elements.importChatHistoryBtn.addEventListener('click', () => elements.importChatHistoryInput.click());
        elements.importChatHistoryInput.addEventListener('change', handleImportChatMarkdown);
    }
    elements.exportChatHistoryBtn.addEventListener('click', () => handleExportChat(state, elements, showToastUI, currentTranslations));
    elements.copyChatHistoryBtn.addEventListener('click', () => handleCopyChat(state, elements, showToastUI, currentTranslations));
    if (elements.exportToObsidianBtn) {
        elements.exportToObsidianBtn.addEventListener('click', () => {
            handleExportToObsidian(state, elements, showToastUI, currentTranslations);
        });
    }
    [
        elements.obsidianVaultInput,
        elements.obsidianFolderInput,
        elements.obsidianNoteNameInput,
        elements.obsidianFrontmatterTemplateTextarea,
        elements.obsidianBodyTemplateTextarea,
        elements.obsidianAiPromptTextarea
    ].forEach(input => {
        if (!input) return;
        input.addEventListener('blur', () => handleObsidianSettingsChange(state, elements, showToastUI, currentTranslations));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && input.tagName !== 'TEXTAREA') {
                e.preventDefault();
                input.blur();
            }
        });
    });
    if (elements.obsidianSilentOpenToggle) {
        elements.obsidianSilentOpenToggle.addEventListener('change', () => {
            handleObsidianSettingsChange(state, elements, showToastUI, currentTranslations);
        });
    }
    if (elements.obsidianAiEnabledToggle) {
        elements.obsidianAiEnabledToggle.addEventListener('change', () => {
            handleObsidianSettingsChange(state, elements, showToastUI, currentTranslations);
        });
    }
    if (elements.obsidianAiModelSelect) {
        elements.obsidianAiModelSelect.addEventListener('change', () => {
            handleObsidianSettingsChange(state, elements, showToastUI, currentTranslations);
        });
    }

    // Proxy Address Change
    if (elements.proxyAddressInput) {
        elements.proxyAddressInput.addEventListener('blur', () => handleProxyAddressChange(state, elements, showToastUI, currentTranslations));
        elements.proxyAddressInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                elements.proxyAddressInput.blur(); // Trigger blur event to save
            }
        });
    }

    // Proxy Test Button
    if (elements.testProxyBtn) {
        elements.testProxyBtn.addEventListener('click', () => handleProxyTest(state, elements, showToastUI, currentTranslations));
    }

    // Unified Import/Export
    if (elements.exportAllSettingsBtn) {
        elements.exportAllSettingsBtn.addEventListener('click', () => handleUnifiedExport(showToastUI, currentTranslations));
    }
    if (elements.importAllSettingsBtn) {
        elements.importAllSettingsBtn.addEventListener('click', () => {
            elements.unifiedImportInput.click();
        });
    }
    if (elements.unifiedImportInput) {
        elements.unifiedImportInput.addEventListener('change', (e) => handleUnifiedImport(e, showToastUI, currentTranslations));
    }

    // Agent Actions
    elements.addNewAgent.addEventListener('click', () => createNewAgent(state, updateAgentsListUIAllArgs, updateAgentSelectionInChatUI, saveAgentsListState, showToastUI, currentTranslations));
    elements.importAgentsBtn.addEventListener('click', () => elements.importAgentInput.click());
    elements.importAgentInput.addEventListener('change', (e) => handleAgentImport(e, state, saveAgentsListState, updateAgentsListUIAllArgs, updateAgentSelectionInChatUI, saveCurrentAgentIdState, showToastUI, currentTranslations));
    elements.exportAgentsBtn.addEventListener('click', () => handleAgentExport(state, showToastUI, currentTranslations));
    // Re-resolve elements in case dialog was reconstructed
    elements.deleteConfirmDialog = document.getElementById('delete-confirm-dialog');
    elements.confirmDelete = document.getElementById('confirm-delete');
    elements.cancelDelete = document.getElementById('cancel-delete');
    if (elements.cancelDelete) {
        elements.cancelDelete.addEventListener('click', () => { if (elements.deleteConfirmDialog) elements.deleteConfirmDialog.style.display = 'none'; });
    }
    if (elements.confirmDelete) {
        elements.confirmDelete.addEventListener('click', () => confirmDeleteAgent(state, elements, updateAgentsListUIAllArgs, updateAgentSelectionInChatUI, saveAgentsListState, showToastUI, currentTranslations));
    }
    window.addEventListener('click', (e) => { if (e.target === elements.deleteConfirmDialog) elements.deleteConfirmDialog.style.display = 'none'; }); // Close delete confirm on overlay click

    // Panel Closing with smarter Escape handling
    elements.closePanelBtnChat.addEventListener('click', closePanel);
    elements.closePanelBtnSettings.addEventListener('click', closePanel);
    window.addEventListener('pagehide', () => flushPendingAgentSaves(elements));
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        // If any modal/popup is open, close that first and do not close the panel
        if (handleGlobalEscapeForModals()) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        // No modals open – allow Escape to close the panel
        closePanel();
    });

    // Scroll Tracking
    if (elements.chatMessages) {
        elements.chatMessages.addEventListener('scroll', handleChatScroll);
    }

    // Chat Navigation Buttons
    if (elements.navToTop) {
        elements.navToTop.addEventListener('click', () => navScrollToTop());
    }
    if (elements.navUserQuestions) {
        elements.navUserQuestions.addEventListener('click', handleUserQuestionNavClick);
        elements.navUserQuestions.addEventListener('mouseleave', () => setActiveUserQuestionNavItem(-1));
    }
    if (elements.navToBottom) {
        elements.navToBottom.addEventListener('click', () => navScrollToBottom());
    }

    // --- 多供应商模式下，API Key 保存逻辑由 setupProviderEventListeners 处理 ---
    // 旧的单一 API Key 自动保存逻辑已移除，现在由各个供应商的输入框独立处理

    // 设置多供应商事件监听器
    setupProviderEventListeners(state, elements, showToastUI, () => updateConnectionIndicator(state.isConnected, elements, currentTranslations));
}

function toggleExpandedChatInput() {
    const chatInputContainer = elements.userInput?.closest('.chat-input');
    if (!chatInputContainer || !elements.expandChatInputBtn) return;

    const isExpanded = chatInputContainer.classList.toggle('expanded');
    elements.expandChatInputBtn.classList.toggle('active', isExpanded);
    elements.expandChatInputBtn.setAttribute('aria-pressed', String(isExpanded));

    const titleKey = isExpanded ? 'collapseInputTitle' : 'expandInputTitle';
    const translatedTitle = _(titleKey);
    elements.expandChatInputBtn.setAttribute('title', translatedTitle);
    elements.expandChatInputBtn.setAttribute('aria-label', translatedTitle);

    resizeTextarea(elements);
    elements.userInput?.focus();
}



// --- Event Handlers & Triggers ---

function handleUserInputKeydown(e) {
    // Check if the IME is composing text. If so, don't send the message.
    // The `isComposing` property is true during the composition session.
    // Pressing Enter to confirm an IME candidate will not trigger the send action.
    // 检查输入法是否正在输入（拼字）。如果是，则不发送消息。
    // `isComposing` 属性在输入法拼字期间为 true。
    // 按下回车键确认候选词时，不会触发发送操作。
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (!state.isStreaming) {
            sendUserMessageTrigger();
        }
    }
    // 如果标签选择弹窗打开，并且按下了 Escape 键，则关闭弹窗
    if (state.isTabSelectionPopupOpen && e.key === 'Escape') {
        e.preventDefault();
        closeTabSelectionPopupUIFromMain();
    }
    // 如果标签选择弹窗打开，并且按下了 Tab 键或箭头键，则阻止默认行为并处理导航
    if (state.isTabSelectionPopupOpen && (e.key === 'Tab' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        // e.preventDefault(); //  ui.js 中的 handlePopupKeyDown 会处理 preventDefault
        // navigateTabSelectionPopupUI(e.key); // 这个UI函数将在后面步骤定义
    }
}

// 新增：处理用户输入以触发标签页选择
function handleUserInputForTabSelection(e) {
    const text = e.target.value;
    const cursorPos = e.target.selectionStart;
    const atCharIndex = text.lastIndexOf('@', cursorPos - 1);

    // 定义有效的标签页名称匹配字符：字母、数字、下划线、连字符
    const validTabNameCharRegex = /^[a-zA-Z0-9_-]*$/;

    if (atCharIndex !== -1) {
        const textAfterAt = text.substring(atCharIndex + 1, cursorPos);
        const textBeforeAt = text.substring(0, atCharIndex);

        // 检查 @ 符号是否在开头或前面有空格，并且 @ 后面没有空格
        const isValidTrigger = (atCharIndex === 0 || /\s$/.test(textBeforeAt)) && !/\s/.test(textAfterAt);

        if (isValidTrigger) {
            // 如果弹窗未打开，则尝试打开
            if (!state.isTabSelectionPopupOpen) {
                console.log('尝试打开标签页选择列表，触发字符: @');
                fetchAndShowTabsForSelection();
            }
            // 如果弹窗已打开，且 @ 后的内容不再是有效匹配字符，则关闭
            // 或者 @ 后的内容为空，且弹窗已打开，也关闭 (例如用户删除了 @ 后的所有内容)
            if (state.isTabSelectionPopupOpen && !validTabNameCharRegex.test(textAfterAt)) {
                closeTabSelectionPopupUIFromMain();
            }
        } else if (state.isTabSelectionPopupOpen) {
            // 如果 @ 符号不再是有效触发条件（例如 @ 后面有空格），则关闭弹窗
            closeTabSelectionPopupUIFromMain();
        }
    } else if (state.isTabSelectionPopupOpen) {
        // 如果输入框中不再有 @ 符号，且弹窗是打开的，则关闭弹窗
        closeTabSelectionPopupUIFromMain();
    }
}

// 新增：获取并显示标签页以供选择
async function fetchAndShowTabsForSelection() {
    if (state.isStreaming) return;

    try {
        const tabs = await chrome.tabs.query({});
        const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTabId = activeTabs && activeTabs.length > 0 ? activeTabs[0].id : null;
        if (tabs && tabs.length > 0) {
            const currentExtensionId = chrome.runtime.id;
            state.availableTabsForSelection = tabs.filter(tab =>
                tab.id &&
                tab.url &&
                !tab.url.startsWith(`chrome-extension://${currentExtensionId}`) &&
                !tab.url.startsWith('chrome://') &&
                !tab.url.startsWith('about:') &&
                !tab.url.startsWith('edge://') &&
                tab.id !== activeTabId // 忽略当前页面，避免冗余
            ).map(tab => ({
                id: tab.id,
                title: tab.title || 'Untitled Tab',
                url: tab.url,
                favIconUrl: tab.favIconUrl || '../magic.png'
            }));

            if (state.availableTabsForSelection.length > 0) {
                // 调用UI函数显示弹窗（多选） 
                showTabSelectionPopupUI(state.availableTabsForSelection, handleTabsSelectedFromPopup, elements, currentTranslations);
                state.isTabSelectionPopupOpen = true;
            } else {
                state.availableTabsForSelection = [];
                state.isTabSelectionPopupOpen = false;
            }
        } else {
            state.availableTabsForSelection = [];
            state.isTabSelectionPopupOpen = false;
        }
    } catch (error) {
        console.error('Error querying tabs:', error);
        state.availableTabsForSelection = [];
        state.isTabSelectionPopupOpen = false;
        if (showToastUI) showToastUI('获取标签页列表失败', 'error');
    }
}

// 新增：处理从弹窗中选择标签页的回调
function handleTabSelectedFromPopup(selectedTab) {
    if (!selectedTab) {
        // state.isTabSelectionPopupOpen = false; // closeTabSelectionPopupUIFromMain 会处理
        closeTabSelectionPopupUIFromMain(); // <--- Ensure state is updated if no tab selected (e.g. Esc)
        return;
    }

    console.log('Tab selected:', selectedTab);
    // state.isTabSelectionPopupOpen = false; // closeTabSelectionPopupUIFromMain 会处理
    closeTabSelectionPopupUIFromMain(); // <--- MODIFIED HERE (called by ui.js click handler, but ensure state sync)

    const currentText = elements.userInput.value;
    const cursorPos = elements.userInput.selectionStart;
    const atCharIndex = currentText.lastIndexOf('@', cursorPos - 1);
    if (atCharIndex !== -1) {
        elements.userInput.value = currentText.substring(0, atCharIndex);
    }
    elements.userInput.focus();

    // Update custom caret position after programmatic value change
    if (window.updateCometCaret) window.updateCometCaret();

    const isAlreadySelected = state.selectedContextTabs.some(tab => tab.id === selectedTab.id);
    if (isAlreadySelected) {
        if (showToastUI) showToastUI(`标签页 "${selectedTab.title.substring(0, 20)}..." 已添加`, 'info');
        return;
    }

    const newSelectedTabEntry = {
        id: selectedTab.id,
        title: selectedTab.title,
        url: selectedTab.url,
        favIconUrl: selectedTab.favIconUrl,
        content: null,
        isLoading: true,
        isContextSent: false
    };
    state.selectedContextTabs.push(newSelectedTabEntry);
    updateSelectedTabsBarUI(state.selectedContextTabs, elements, removeSelectedTabFromMain, currentTranslations); // <--- MODIFIED HERE (added removeSelectedTabFromMain)

    chrome.runtime.sendMessage({ action: 'extractTabContent', tabId: selectedTab.id }, (response) => {
        const tabData = state.selectedContextTabs.find(t => t.id === selectedTab.id);
        if (tabData) {
            if (response.content && !response.error) {
                tabData.content = response.content;
                tabData.isLoading = false;
                tabData.error = false;
                console.log(`Content for tab ${selectedTab.id} loaded, length: ${response.content?.length}`);
                // 使用自定义类名调用 showToastUI
                showToastUI(_('tabContentLoadedSuccess', { title: tabData.title.substring(0, 20) }), 'success', 'toast-tab-loaded');
            } else {
                tabData.content = null; // 确保错误时内容为空
                tabData.isLoading = false;
                tabData.error = true;
                const errorMessage = response.error || _('unknownErrorLoadingTab', {}, currentTranslations);
                console.error(`Failed to load content for tab ${selectedTab.id}: ${errorMessage}`);
                // 使用自定义类名调用 showToastUI
                showToastUI(_('tabContentLoadFailed', { title: tabData.title.substring(0, 20), error: errorMessage }), 'error', 'toast-tab-loaded');
            }
            updateSelectedTabsBarUI(state.selectedContextTabs, elements, removeSelectedTabFromMain, currentTranslations); // 更新UI以反映加载/错误状态
        }
    });
}

// 新增：处理从弹窗中多选标签页的回调
function handleTabsSelectedFromPopup(selectedTabs) {
    if (!Array.isArray(selectedTabs) || selectedTabs.length === 0) {
        closeTabSelectionPopupUIFromMain();
        return;
    }

    // 关闭弹窗并同步状态
    closeTabSelectionPopupUIFromMain();

    // 移除输入框中最后一个 '@' 及其后内容
    const currentText = elements.userInput.value;
    const cursorPos = elements.userInput.selectionStart;
    const atCharIndex = currentText.lastIndexOf('@', cursorPos - 1);
    if (atCharIndex !== -1) {
        elements.userInput.value = currentText.substring(0, atCharIndex);
    }
    elements.userInput.focus();

    // Update custom caret position after programmatic value change
    if (window.updateCometCaret) window.updateCometCaret();

    // 逐个加入到选中列表
    const suppressPerTabSuccessToast = selectedTabs.length > 1; // 多选时仅显示汇总提示，抑制单条成功提示
    let addedCount = 0;
    selectedTabs.forEach((tab) => {
        const isAlreadySelected = state.selectedContextTabs.some(t => t.id === tab.id);
        if (isAlreadySelected) return;

        const newSelectedTabEntry = {
            id: tab.id,
            title: tab.title,
            url: tab.url,
            favIconUrl: tab.favIconUrl,
            content: null,
            isLoading: true,
            isContextSent: false
        };
        state.selectedContextTabs.push(newSelectedTabEntry);
        addedCount++;

        chrome.runtime.sendMessage({ action: 'extractTabContent', tabId: tab.id }, (response) => {
            const tabData = state.selectedContextTabs.find(t => t.id === tab.id);
            if (tabData) {
                if (response && response.content && !response.error) {
                    tabData.content = response.content;
                    tabData.isLoading = false;
                    tabData.error = false;
                    if (!suppressPerTabSuccessToast) {
                        showToastUI(_('tabContentLoadedSuccess', { title: tabData.title.substring(0, 20) }), 'success', 'toast-tab-loaded');
                    }
                } else {
                    tabData.content = null;
                    tabData.isLoading = false;
                    tabData.error = true;
                    const errorMessage = response?.error || _('unknownErrorLoadingTab', {}, currentTranslations);
                    console.error(`Failed to load content for tab ${tab.id}: ${errorMessage}`);
                    showToastUI(_('tabContentLoadFailed', { title: tabData.title.substring(0, 20), error: errorMessage }), 'error', 'toast-tab-loaded');
                }
                updateSelectedTabsBarUI(state.selectedContextTabs, elements, removeSelectedTabFromMain, currentTranslations);
            }
        });
    });

    // 更新一次选中栏，显示 loading 状态
    if (addedCount > 0) {
        updateSelectedTabsBarUI(state.selectedContextTabs, elements, removeSelectedTabFromMain, currentTranslations);
        if (showToastUI && addedCount > 1) {
            showToastUI(_('tabsAddedSuccess', { count: addedCount }), 'info', 'toast-tabs-added');
        }
    }
}

// 后续步骤将定义:
// - showTabSelectionPopupUI (在ui.js)
// - closeTabSelectionPopupUI (在ui.js)
// - navigateTabSelectionPopupUI (在ui.js)
// - updateSelectedTabsBarUI (在ui.js)

function handleChatModelChange() {
    state.model = elements.chatModelSelection.value;
    // 同步设置页下拉（若存在）
    if (elements.modelSelection) {
        elements.modelSelection.value = state.model;
    }
    // 更新内联模型显示
    updateCurrentModelDisplay();

    // 在多供应商模式下，只需要保存模型选择，不需要测试API Key
    chrome.storage.sync.set({ model: state.model }, () => {
        if (chrome.runtime.lastError) {
            console.error("Error saving model selection:", chrome.runtime.lastError);
            showToastUI(_('saveFailedToast', { error: chrome.runtime.lastError.message }, currentTranslations), 'error');
        } else {
            console.log(`Model selection saved: ${state.model}`);
        }
    });
}

// 渲染自定义模型选择菜单（支持多选）
function renderModelSelectorMenu() {
    const menu = elements.modelSelectorMenu;
    const select = elements.chatModelSelection;
    if (!menu || !select) return;

    menu.innerHTML = '';

    // 供应商图标映射 (使用 icons 文件夹中的 SVG)
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

    // 获取图标路径
    function getProviderIcon(providerName) {
        const iconFile = providerIconMap[providerName];
        if (iconFile) {
            return `<img src="../icons/${iconFile}" alt="${providerName}" class="provider-icon-img">`;
        }
        // 默认图标
        return '<svg class="provider-icon-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>';
    }

    // 创建模型选项（带复选框）
    function createModelOption(option, providerName) {
        const btn = document.createElement('button');
        btn.className = 'model-option';
        btn.dataset.value = option.value;
        btn.type = 'button'; // 防止表单提交

        // 复选框
        const checkbox = document.createElement('span');
        checkbox.className = 'model-checkbox';

        // 模型名称
        const nameSpan = document.createElement('span');
        nameSpan.className = 'model-option-name';
        nameSpan.textContent = option.textContent;

        btn.appendChild(checkbox);
        btn.appendChild(nameSpan);

        // 检查是否已选中
        if (state.selectedModels.includes(option.value)) {
            btn.classList.add('selected');
        }

        // 点击切换选中状态
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleModelSelection(option.value);
        });

        return btn;
    }

    // 获取 optgroup 结构
    const optgroups = select.querySelectorAll('optgroup');
    if (optgroups.length > 0) {
        optgroups.forEach(optgroup => {
            const group = document.createElement('div');
            group.className = 'model-group';

            const label = document.createElement('div');
            label.className = 'model-group-label';

            // 添加供应商图标
            const providerName = optgroup.label;
            label.innerHTML = `<span class="provider-icon">${getProviderIcon(providerName)}</span>${providerName}`;
            group.appendChild(label);

            optgroup.querySelectorAll('option').forEach(option => {
                const btn = createModelOption(option, providerName);
                group.appendChild(btn);
            });

            menu.appendChild(group);
        });
    } else {
        // 没有分组，直接渲染 options
        select.querySelectorAll('option').forEach(option => {
            const btn = createModelOption(option, '');
            menu.appendChild(btn);
        });
    }
}


// 切换模型选中状态（多选模式）
function toggleModelSelection(value) {
    const index = state.selectedModels.indexOf(value);
    if (index > -1) {
        // 如果已选中，取消选中（但至少保留一个）
        if (state.selectedModels.length > 1) {
            state.selectedModels.splice(index, 1);
        }
    } else {
        // 如果未选中，添加到选中列表
        state.selectedModels.push(value);
    }

    // 更新主模型为第一个选中的模型（向后兼容）
    if (state.selectedModels.length > 0) {
        state.model = state.selectedModels[0];
        elements.chatModelSelection.value = state.model;
    }

    // 更新菜单中的选中状态
    const menu = elements.modelSelectorMenu;
    if (menu) {
        menu.querySelectorAll('.model-option').forEach(btn => {
            if (state.selectedModels.includes(btn.dataset.value)) {
                btn.classList.add('selected');
            } else {
                btn.classList.remove('selected');
            }
        });
    }

    // 更新显示
    updateCurrentModelDisplay();

    // 保存选择
    saveSelectedModels();
}

// 保存选中的模型
function saveSelectedModels() {
    chrome.storage.sync.set({
        model: state.model,
        selectedModels: state.selectedModels
    }, () => {
        if (chrome.runtime.lastError) {
            console.error("Error saving model selection:", chrome.runtime.lastError);
            showToastUI(_('saveFailedToast', { error: chrome.runtime.lastError.message }, currentTranslations), 'error');
        } else {
            console.log(`Model selection saved: ${state.selectedModels.join(', ')}`);
        }
    });
}

// 从自定义菜单选择模型（单选模式 - 保留用于向后兼容）
function selectModelFromMenu(value) {
    elements.chatModelSelection.value = value;
    handleChatModelChange();
    // 关闭菜单
    elements.modelSelectorMenu.classList.remove('show');
    elements.inlineModelSelector.classList.remove('active');
}

// 更新当前模型显示（支持多模型显示）
function updateCurrentModelDisplay() {
    if (!elements.currentModelDisplay || !elements.chatModelSelection) return;

    // 过滤掉已经不存在于下拉选择器中的模型
    const validModels = state.selectedModels.filter(modelValue => {
        return elements.chatModelSelection.querySelector(`option[value="${modelValue}"]`) !== null;
    });

    // 如果有模型被过滤掉了，更新 state.selectedModels
    if (validModels.length !== state.selectedModels.length) {
        state.selectedModels = validModels;
        // 确保至少有一个模型被选中
        if (state.selectedModels.length === 0) {
            const firstOption = elements.chatModelSelection.querySelector('option');
            if (firstOption) {
                state.selectedModels = [firstOption.value];
            }
        }
        // 更新主模型
        if (state.selectedModels.length > 0) {
            state.model = state.selectedModels[0];
            elements.chatModelSelection.value = state.model;
        }
        // 保存更新后的选择
        chrome.storage.sync.set({
            model: state.model,
            selectedModels: state.selectedModels
        });
        console.log(`[Main] Cleaned up invalid models, remaining: ${state.selectedModels.join(', ')}`);
    }

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

    // 获取模型信息的辅助函数
    function getModelInfo(modelValue) {
        const select = elements.chatModelSelection;
        const option = select.querySelector(`option[value="${modelValue}"]`);
        if (!option) return null;

        const optgroup = option.parentElement;
        const providerName = optgroup && optgroup.tagName === 'OPTGROUP' ? optgroup.label : '';
        const iconFile = providerIconMap[providerName];

        return {
            value: modelValue,
            displayName: option.textContent,
            providerName,
            iconFile
        };
    }

    // 如果只有一个模型，使用简洁显示
    if (state.selectedModels.length === 1) {
        const modelInfo = getModelInfo(state.selectedModels[0]);
        if (modelInfo) {
            if (modelInfo.iconFile) {
                elements.currentModelDisplay.innerHTML = `<img src="../icons/${modelInfo.iconFile}" alt="${modelInfo.providerName}" class="model-display-icon">${modelInfo.displayName}`;
            } else {
                elements.currentModelDisplay.textContent = modelInfo.displayName;
            }
        }
    } else {
        // 多个模型，显示数量和图标
        let html = '';
        const maxDisplay = 3; // 最多显示3个图标
        const displayModels = state.selectedModels.slice(0, maxDisplay);

        displayModels.forEach((modelValue, index) => {
            const modelInfo = getModelInfo(modelValue);
            if (modelInfo && modelInfo.iconFile) {
                html += `<img src="../icons/${modelInfo.iconFile}" alt="${modelInfo.providerName}" class="model-display-icon multi" title="${modelInfo.displayName}">`;
            }
        });

        if (state.selectedModels.length > maxDisplay) {
            html += `<span class="model-count-badge">+${state.selectedModels.length - maxDisplay}</span>`;
        }

        html += `<span class="model-count">${state.selectedModels.length} models</span>`;
        elements.currentModelDisplay.innerHTML = html;
    }
}


function handleChatAgentChange() {
    switchAgentAndUpdateState(elements.chatAgentSelection.value);
}

function handleChatScroll() {
    const el = elements.chatMessages;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;

    if (state.isStreaming) {
        if (!atBottom && !state.userScrolledUpDuringStream) {
            // User scrolled up for the first time during this stream
            state.userScrolledUpDuringStream = true;
            console.log("User scrolled up during stream, auto-scroll disabled for this stream.");
        } else if (atBottom && state.userScrolledUpDuringStream) {
            // User scrolled back to bottom, re-enable auto-scroll
            state.userScrolledUpDuringStream = false;
            console.log("User scrolled back to bottom during stream, auto-scroll re-enabled.");
        }
    }
    isUserNearBottom = atBottom; // Keep this for non-streaming contexts or as a general flag
}

// --- Chat Navigation Functions ---

/**
 * 滚动到聊天区域顶部
 */
function navScrollToTop() {
    if (!elements.chatMessages) return;
    elements.chatMessages.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
}

/**
 * 滚动到聊天区域底部
 */
function navScrollToBottom() {
    if (!elements.chatMessages) return;
    elements.chatMessages.scrollTo({
        top: elements.chatMessages.scrollHeight,
        behavior: 'smooth'
    });
}

/**
 * 获取所有用户消息元素列表
 * @returns {HTMLElement[]} 用户消息元素数组
 */
function getUserMessageElements() {
    if (!elements.chatMessages) return [];
    return Array.from(elements.chatMessages.querySelectorAll('.message.user-message:not(.empty-bubble)'));
}

function getMessageTextFromHistory(messageId) {
    if (!messageId) return '';
    const message = state.chatHistory.find((item) => item.id === messageId && item.role === 'user');
    if (!message?.parts || !Array.isArray(message.parts)) return '';

    return message.parts
        .filter((part) => part?.text)
        .map((part) => part.text)
        .join('\n')
        .trim();
}

function getUserQuestionText(messageElement) {
    if (!messageElement) return '';

    const contentClone = messageElement.cloneNode(true);
    contentClone.querySelectorAll(
        '.message-actions, .copy-button, .mermaid-overview-btn, .code-copy-button'
    ).forEach((node) => node.remove());

    const domText = contentClone.textContent?.trim() || '';
    return domText || getMessageTextFromHistory(messageElement.dataset.messageId);
}

function getUserQuestionNavLabel(questionText, fallbackIndex) {
    const text = (questionText || '').replace(/\s+/g, ' ').trim();
    if (!text) return `${fallbackIndex + 1}.`;

    const firstPunctuationIndex = text.search(/[，。！？；：,.!?;:、]/);
    const label = firstPunctuationIndex > 0
        ? text.slice(0, firstPunctuationIndex)
        : text;

    return label.trim() || `${fallbackIndex + 1}.`;
}

function updateUserQuestionNav() {
    if (!elements.navUserQuestions) return;

    const userMessages = getUserMessageElements();
    const navItems = userMessages.map((messageElement, index) => {
        const questionText = getUserQuestionText(messageElement);
        return {
            messageElement,
            questionText,
            label: getUserQuestionNavLabel(questionText, index)
        };
    });
    const nextSignature = navItems
        .map(({ messageElement, questionText }) => `${messageElement.dataset.messageId || ''}:${questionText}`)
        .join('|');

    if (nextSignature === userQuestionNavSignature) {
        return;
    }

    userQuestionNavSignature = nextSignature;
    elements.navUserQuestions.classList.toggle('is-empty', userMessages.length === 0);
    elements.navUserQuestions.querySelectorAll('.chat-nav-question-dot').forEach((node) => node.remove());
    if (elements.navUserQuestionsPanel) {
        elements.navUserQuestionsPanel.replaceChildren();
    }

    navItems.forEach(({ messageElement, label }, index) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'chat-nav-question-dot';
        item.dataset.messageId = messageElement.dataset.messageId || '';
        item.dataset.questionIndex = String(index);
        item.setAttribute('aria-label', label);
        item.addEventListener('mouseenter', () => setActiveUserQuestionNavItem(index));
        item.addEventListener('focus', () => setActiveUserQuestionNavItem(index));

        elements.navUserQuestions.appendChild(item);

        if (elements.navUserQuestionsPanel) {
            const panelItem = document.createElement('button');
            panelItem.type = 'button';
            panelItem.className = 'chat-nav-question-item';
            panelItem.dataset.messageId = messageElement.dataset.messageId || '';
            panelItem.dataset.questionIndex = String(index);
            panelItem.textContent = label;
            panelItem.setAttribute('aria-label', label);
            elements.navUserQuestionsPanel.appendChild(panelItem);
        }
    });

    setActiveUserQuestionNavItem(-1);
}

function setActiveUserQuestionNavItem(activeIndex) {
    if (!elements.navUserQuestions) return;

    elements.navUserQuestions.querySelectorAll('.chat-nav-question-dot').forEach((item) => {
        item.classList.toggle('is-active', Number.parseInt(item.dataset.questionIndex, 10) === activeIndex);
    });

    if (elements.navUserQuestionsPanel) {
        elements.navUserQuestionsPanel.querySelectorAll('.chat-nav-question-item').forEach((item) => {
            item.classList.toggle('is-active', Number.parseInt(item.dataset.questionIndex, 10) === activeIndex);
        });
    }
}

function handleUserQuestionNavClick(event) {
    const navItem = event.target.closest('.chat-nav-question-dot, .chat-nav-question-item');
    if (!navItem || !elements.navUserQuestions?.contains(navItem)) return;

    const messageId = navItem.dataset.messageId;
    const userMessages = getUserMessageElements();
    const targetMessage = messageId
        ? userMessages.find((message) => message.dataset.messageId === messageId)
        : userMessages[Number.parseInt(navItem.dataset.questionIndex, 10)];

    if (targetMessage) {
        scrollToUserMessage(targetMessage);
    }
}

/**
 * 找到当前视口中最接近中心的用户消息索引
 * @param {HTMLElement[]} userMessages - 用户消息元素数组
 * @returns {number} 当前可见的用户消息索引，-1 表示没有找到
 */
function getCurrentVisibleUserMessageIndex(userMessages) {
    if (!elements.chatMessages || userMessages.length === 0) return -1;

    const container = elements.chatMessages;
    const containerTop = container.scrollTop;
    const containerMiddle = containerTop + container.clientHeight / 2;

    let closestIndex = -1;
    let closestDistance = Infinity;

    for (let i = 0; i < userMessages.length; i++) {
        const msg = userMessages[i];
        const msgTop = msg.offsetTop;
        const msgMiddle = msgTop + msg.offsetHeight / 2;
        const distance = Math.abs(msgMiddle - containerMiddle);

        if (distance < closestDistance) {
            closestDistance = distance;
            closestIndex = i;
        }
    }

    return closestIndex;
}

/**
 * 导航到上一条用户提问消息
 */
function navToPrevUserMessage() {
    const userMessages = getUserMessageElements();
    if (userMessages.length === 0) return;

    const currentIndex = getCurrentVisibleUserMessageIndex(userMessages);
    if (currentIndex <= 0) {
        // 已经在第一条或没有找到，滚动到顶部
        navScrollToTop();
        return;
    }

    // 检查当前消息是否已经在视口中且完全可见
    const container = elements.chatMessages;
    const currentMsg = userMessages[currentIndex];
    const msgTop = currentMsg.offsetTop;
    const containerTop = container.scrollTop;

    // 如果当前消息的顶部在视口内（且有一定容差），直接跳到上一条
    let targetIndex;
    if (msgTop >= containerTop && msgTop <= containerTop + container.clientHeight * 0.3) {
        // 当前消息在视口顶部附近，跳到上一条
        targetIndex = currentIndex - 1;
    } else {
        // 当前消息不在视口顶部，先跳到当前消息
        targetIndex = currentIndex - 1;
    }

    targetIndex = Math.max(0, targetIndex);
    scrollToUserMessage(userMessages[targetIndex]);
}

/**
 * 导航到下一条用户提问消息
 */
function navToNextUserMessage() {
    const userMessages = getUserMessageElements();
    if (userMessages.length === 0) return;

    const currentIndex = getCurrentVisibleUserMessageIndex(userMessages);
    if (currentIndex >= userMessages.length - 1) {
        // 已经在最后一条，滚动到底部
        navScrollToBottom();
        return;
    }

    const targetIndex = Math.min(userMessages.length - 1, currentIndex + 1);
    scrollToUserMessage(userMessages[targetIndex]);
}

/**
 * 滚动到指定的用户消息，使其出现在视口顶部附近
 * @param {HTMLElement} msgElement - 要滚动到的消息元素
 */
function scrollToUserMessage(msgElement) {
    if (!elements.chatMessages || !msgElement) return;

    // 查找是否有关联的 sent-tabs-container 或 sent-images-container
    const messageId = msgElement.dataset.messageId;
    let scrollTarget = msgElement;

    if (messageId) {
        // 查找与此消息关联的 sent-tabs-container（在消息之前）
        const sentTabsContainer = elements.chatMessages.querySelector(
            `.sent-tabs-container[data-message-id-ref="${messageId}"]`
        );
        const sentImagesContainer = elements.chatMessages.querySelector(
            `.sent-images-container[data-message-id-ref="${messageId}"]`
        );

        // 使用最上面的关联元素作为滚动目标
        if (sentTabsContainer) {
            scrollTarget = sentTabsContainer;
        } else if (sentImagesContainer) {
            scrollTarget = sentImagesContainer;
        }
    }

    const container = elements.chatMessages;
    // 计算目标位置，让消息出现在视口中偏上 1/5 处
    const targetTop = scrollTarget.offsetTop - container.clientHeight * 0.15;

    container.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth'
    });
}

// Wrapper function to trigger sendUserMessage with all dependencies
function sendUserMessageTrigger() {
    if (state.isStreaming) return;

    // 若存在欢迎消息，先移除，避免占用顶部空间
    try {
        const welcome = elements.chatMessages && elements.chatMessages.querySelector('.welcome-message');
        if (welcome && welcome.parentNode) {
            welcome.parentNode.removeChild(welcome);
        }
    } catch (e) {
        console.warn('[main.js] Failed to remove welcome message before sending:', e);
    }

    // 添加发送动效
    if (elements.sendMessage) {
        elements.sendMessage.classList.add('sending');
        // 移除发送动效，让动画完成
        setTimeout(() => {
            if (elements.sendMessage) {
                elements.sendMessage.classList.remove('sending');
            }
        }, 600);
    }

    // 准备 sentContextTabs 数据 (只包含必要信息)
    const tabsForMessageBubble = state.selectedContextTabs.map(tab => ({
        title: tab.title,
        favIconUrl: tab.favIconUrl
        // 不传递 tab.content 或 tab.id 到气泡渲染中
    }));

    sendUserMessageAction(
        state, elements, currentTranslations,
        (msg, type) => showConnectionStatus(msg, type, elements), // showConnectionStatusCallback
        (content, sender, options) => { // Modified addMessageToChatCallback wrapper
            let messageOptions = { ...options };
            if (sender === 'user' && tabsForMessageBubble.length > 0) {
                // tabsForBubbleDisplay should now include id, title, favIconUrl
                messageOptions.sentContextTabs = tabsForMessageBubble;
            }
            return addMessageToChatUI(content, sender, messageOptions);
        },
        (afterEl) => uiAddThinkingAnimation(afterEl, elements, isUserNearBottom),
        () => resizeTextarea(elements),
        clearImagesUI,
        clearVideosUI,
        showToastUI,
        restoreSendButtonAndInputUI,
        updateSelectedTabsBarFromMain
    );
}

function handleSendButtonClick() {
    if (state.isStreaming) {
        abortStreamingUI();
        return;
    }

    sendUserMessageTrigger();
}

// Wrapper function to trigger abortStreaming
function abortStreamingUI() {
    abortStreamingAction(state, restoreSendButtonAndInputUI, showToastUI, currentTranslations);
}

// Wrapper function to restore send button UI
function restoreSendButtonAndInputUI() {
    restoreSendButtonAndInput(state, elements, currentTranslations);
    syncChatInputVisibility();
}

function handleImportChatMarkdown(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const fileName = file.name || '';
    if (!/\.(md|markdown)$/i.test(fileName)) {
        showToastUI(_('chatImportMarkdownOnly', {}, currentTranslations), 'error');
        return;
    }

    if (state.isStreaming) {
        showToastUI(_('streamingInProgress', {}, currentTranslations), 'warning');
        return;
    }

    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
        try {
            const markdown = String(loadEvent.target?.result || '');
            const importedChatHistory = parseChatMarkdown(markdown, elements, currentTranslations);

            if (!importedChatHistory.length) {
                showToastUI(_('chatImportEmptyError', {}, currentTranslations), 'error');
                return;
            }

            if (state.chatHistory?.length > 0 && !confirm(_('chatImportConfirm', {}, currentTranslations))) {
                return;
            }

            await restoreImportedChatHistory(importedChatHistory);
            showToastUI(_('chatImportSuccess', { count: importedChatHistory.length }, currentTranslations), 'success');
        } catch (error) {
            console.error('[ImportChatMarkdown] Failed to import chat markdown:', error);
            showToastUI(_('chatImportError', { error: error.message }, currentTranslations), 'error');
        }
    };
    reader.onerror = () => {
        showToastUI(_('chatImportError', { error: reader.error?.message || 'File read failed' }, currentTranslations), 'error');
    };
    reader.readAsText(file);
}

async function restoreImportedChatHistory(chatHistory) {
    elements.chatMessages.innerHTML = '';
    state.chatHistory = chatHistory;
    state.locallyIgnoredTabs = {};
    clearFollowUpQuestions(state, elements);
    state.selectedContextTabs = [];
    clearImagesUI();
    clearVideosUI();
    updateSelectedTabsBarFromMain();

    await renderChatHistoryFromSession({ chatHistory });
    syncChatInputVisibility();
    switchTab('chat', elements, (subTab) => switchSettingsSubTab(subTab, elements));
    setThemeButtonVisibility('chat', elements);
    if (elements.themeToggleBtnSettings) {
        elements.themeToggleBtnSettings.style.display = 'none';
        elements.themeToggleBtnSettings.style.visibility = 'hidden';
    }
    setTimeout(() => elements.userInput?.focus(), 50);
}

// Wrapper function for toggleTheme used by draggable button
function toggleThemeAndUpdate() {
    toggleTheme(state, elements, rerenderAllMermaidChartsUI);
}

// Wrapper function for rerenderAllMermaidCharts
function rerenderAllMermaidChartsUI() {
    rerenderAllMermaidCharts(elements);
}

// Wrapper function for updateAgentsListUI with all args
function updateAgentsListUIAllArgs() {
    updateAgentsListUI(state, elements, currentTranslations, autoSaveAgentSettings, showDeleteConfirmDialogUI, switchAgentAndUpdateState);
}

// Wrapper function for autoSaveAgentSettings in main.js
// This function is passed as a callback when updateAgentsListUI is called.
function autoSaveAgentSettings(agentId, agentItemElement) {
    // Call the aliased imported function from agent.js
    autoSaveAgentSettingsFromAgent(agentId, agentItemElement, state, saveAgentsListState, updateAgentSelectionInChatUI, showToastUI, currentTranslations);
}

// Wrapper function for showDeleteConfirmDialog
function showDeleteConfirmDialogUI(agentId) {
    showDeleteConfirmDialog(agentId, state, elements, currentTranslations);
}

// Wrapper function for switchAgent that also saves ID and updates state
function switchAgentAndUpdateState(agentId) {
    switchAgent(agentId, state, saveCurrentAgentIdState);
    // No need to explicitly call loadCurrentAgentSettingsIntoState here,
    // switchAgent internally calls it.
}

// Wrapper function for updateAgentSelectionInChat
function updateAgentSelectionInChatUI() {
    updateAgentSelectionInChat(state, elements, currentTranslations);
}

// Wrapper function for saveAgentsList
function saveAgentsListState() {
    saveAgentsList(state);
}

// Wrapper function for saveCurrentAgentId
function saveCurrentAgentIdState() {
    saveCurrentAgentId(state);
}

// Wrapper function for addMessageToChat
function addMessageToChatUI(content, sender, options) {
    // 将 isUserNearBottom 的当前值传递给 ui.js 中的 addMessageToChat
    // options 现在可能包含 sentContextTabs
    return addMessageToChat(content, sender, options, state, elements, currentTranslations, addCopyButtonToCodeBlockUI, addMessageActionButtonsUI, isUserNearBottom);
}

// Wrapper function for addCopyButtonToCodeBlock
function addCopyButtonToCodeBlockUI(block) {
    addCopyButtonToCodeBlock(block, currentTranslations, copyCodeToClipboard);
}

// Wrapper function for addMessageActionButtons
function addMessageActionButtonsUI(messageElement, content) {
    addMessageActionButtons(
        messageElement,
        content,
        currentTranslations,
        copyMessageContent,
        regenerateMessageUI,
        deleteMessageUI,
        handleMermaidOverviewAction
    );
}

// Wrapper function for copyCodeToClipboard (handles feedback)
function copyCodeToClipboard(code, buttonElement) {
    window.parent.postMessage({ action: 'copyText', text: code }, '*');
    showCopyCodeFeedback(buttonElement); // Show UI feedback
}

// Wrapper function for copyMessageContent (handles feedback)
function copyMessageContent(messageElement, originalContent, buttonElement) {
    const formattedContent = originalContent.replace(/\n/g, '\r\n');
    window.parent.postMessage({ action: 'copyText', text: formattedContent }, '*');
    showCopyMessageFeedback(buttonElement); // Show UI feedback
}

function isUserMessageElement(messageElement) {
    return !!(messageElement && messageElement.classList.contains('user-message'));
}

function findMessageById(messageId) {
    return state.chatHistory.find((msg) => msg.id === messageId) || null;
}

function ensureUserMessageMermaidOverview(userMessage) {
    if (!userMessage) return createDefaultMermaidOverviewState();
    if (!userMessage.mermaidOverview || typeof userMessage.mermaidOverview !== 'object') {
        userMessage.mermaidOverview = createDefaultMermaidOverviewState();
    } else {
        userMessage.mermaidOverview = createDefaultMermaidOverviewState(userMessage.mermaidOverview);
    }
    return userMessage.mermaidOverview;
}

function getLinkedMultiModelResponseForUserMessage(userMessageId) {
    const userIndex = state.chatHistory.findIndex((msg) => msg.id === userMessageId && msg.role === 'user');
    if (userIndex === -1) return null;
    const nextMessage = state.chatHistory[userIndex + 1];
    if (!nextMessage || nextMessage.role !== 'model') return null;
    if (!nextMessage.multiModelResponses || Object.keys(nextMessage.multiModelResponses).length <= 1) return null;
    return nextMessage;
}

function getMermaidOverviewStateForMessageElement(messageElement) {
    if (!isUserMessageElement(messageElement)) {
        return { status: MERMAID_OVERVIEW_IDLE };
    }

    const userMessage = findMessageById(messageElement.dataset.messageId);
    if (!userMessage) {
        return { status: MERMAID_OVERVIEW_IDLE };
    }

    return ensureUserMessageMermaidOverview(userMessage);
}

function shouldShowMermaidOverviewButton(messageElement) {
    if (!isUserMessageElement(messageElement)) return false;
    const linkedResponse = getLinkedMultiModelResponseForUserMessage(messageElement.dataset.messageId);
    return !!linkedResponse;
}

function refreshMessageActionButtonsByMessageId(messageId) {
    if (!messageId) return;
    const messageElement = document.querySelector(`.message[data-message-id="${messageId}"]`);
    if (!messageElement) return;

    const historyMessage = findMessageById(messageId);
    const content = historyMessage?.parts
        ?.filter((part) => !!part.text)
        .map((part) => part.text)
        .join('\n') || '';

    addMessageActionButtonsUI(messageElement, content);
}

window.refreshMessageActionButtonsByMessageId = refreshMessageActionButtonsByMessageId;

const MERMAID_DIAGRAM_START_RE = /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie\b|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|xychart-beta|sankey-beta|packet-beta|block-beta|architecture|kanban)\b/i;

function removeThinkingBlocks(text) {
    if (!text) return '';
    return text.replace(/<think>[\s\S]*?<\/think>/gi, ' ').trim();
}

function extractFromMarkdownFence(text) {
    if (!text) return '';

    const mermaidFenceMatch = text.match(/```mermaid\s*([\s\S]*?)```/i);
    if (mermaidFenceMatch?.[1]) {
        return mermaidFenceMatch[1].trim();
    }

    const genericFenceMatch = text.match(/```\s*([\s\S]*?)```/i);
    if (genericFenceMatch?.[1]) {
        return genericFenceMatch[1].trim();
    }

    return '';
}

function extractMermaidCandidateText(text) {
    if (!text) return '';

    const withoutThinking = removeThinkingBlocks(text)
        .replace(/^Here is .*?Mermaid.*?:\s*/i, '')
        .replace(/^下面是.*?Mermaid.*?[：:]\s*/i, '')
        .trim();

    const fencedContent = extractFromMarkdownFence(withoutThinking);
    if (fencedContent) {
        return fencedContent;
    }

    const lines = withoutThinking.split(/\r?\n/);
    const diagramStartIndex = lines.findIndex((line) => MERMAID_DIAGRAM_START_RE.test(line));

    if (diagramStartIndex !== -1) {
        return lines.slice(diagramStartIndex).join('\n').trim();
    }

    return withoutThinking;
}

async function tryParseMermaidCode(candidate) {
    await mermaid.parse(candidate);
    return candidate;
}

async function validateMermaidCode(mermaidCode) {
    if (typeof mermaid === 'undefined') {
        return { valid: false, error: 'Mermaid library not available' };
    }

    const extracted = extractMermaidCandidateText(mermaidCode);
    if (!extracted) {
        return { valid: false, error: 'Empty Mermaid output' };
    }

    const lines = extracted.split(/\r?\n/);
    let lastError = null;

    try {
        await tryParseMermaidCode(extracted);
        return { valid: true, code: extracted };
    } catch (error) {
        lastError = error;
    }

    for (let end = lines.length - 1; end >= 1; end--) {
        const candidate = lines.slice(0, end).join('\n').trim();
        if (!candidate) continue;

        try {
            await tryParseMermaidCode(candidate);
            return { valid: true, code: candidate };
        } catch (error) {
            lastError = error;
        }
    }

    return { valid: false, error: lastError?.message || 'Parse failed' };
}

function buildMermaidOverviewPromptPayload(userMessage, linkedResponse) {
    const question = userMessage?.parts
        ?.filter((part) => !!part.text)
        .map((part) => part.text)
        .join('\n')
        .trim() || '';

    const modelOrder = Array.isArray(linkedResponse.modelOrder)
        ? linkedResponse.modelOrder
        : Object.keys(linkedResponse.multiModelResponses || {});

    const answers = modelOrder
        .filter((modelId) => typeof linkedResponse.multiModelResponses?.[modelId] === 'string')
        .map((modelId) => ({
            modelId,
            answer: linkedResponse.multiModelResponses[modelId]
        }));

    return { question, answers };
}

async function callTextModelOnce(modelId, messages) {
    let accumulatedText = '';
    await window.PageTalkAPI.callApi(modelId, messages, (chunk) => {
        accumulatedText += chunk;
    }, {});
    return accumulatedText.trim();
}

async function openMermaidOverviewModal(mermaidCode) {
    const validationResult = await validateMermaidCode(mermaidCode);
    if (!validationResult.valid) {
        throw new Error(_('mermaidOverviewInvalidCode', { error: validationResult.error }));
    }

    const { svg } = await mermaid.render(`mermaid-overview-${Date.now()}`, validationResult.code);
    showMermaidModal(svg, elements, {
        type: 'overview',
        userMessageId: activeMermaidOverviewMessageId
    });
}

function updateMermaidModalRegenerateButton() {
    if (!elements.mermaidModalRegenerateBtn) return;

    if (!activeMermaidOverviewMessageId) {
        elements.mermaidModalRegenerateBtn.style.display = 'none';
        elements.mermaidModalRegenerateBtn.disabled = false;
        return;
    }

    const userMessage = findMessageById(activeMermaidOverviewMessageId);
    const mermaidOverview = userMessage ? ensureUserMessageMermaidOverview(userMessage) : null;
    const isGenerating = mermaidOverview?.status === MERMAID_OVERVIEW_GENERATING;

    elements.mermaidModalRegenerateBtn.style.display = 'inline-flex';
    elements.mermaidModalRegenerateBtn.disabled = isGenerating;

    const label = isGenerating ? _('mermaidOverviewGenerating') : _('regenerate');
    const span = elements.mermaidModalRegenerateBtn.querySelector('span');
    if (span) {
        span.textContent = label;
    } else {
        elements.mermaidModalRegenerateBtn.textContent = label;
    }
}

async function generateMermaidOverviewForMessage(userMessage) {
    const mermaidOverview = ensureUserMessageMermaidOverview(userMessage);
    const linkedResponse = getLinkedMultiModelResponseForUserMessage(userMessage.id);

    if (!linkedResponse) {
        throw new Error(_('mermaidOverviewNoLinkedResponse'));
    }

    if (!state.mermaidOverviewModel || !state.mermaidOverviewSummaryPrompt || !state.mermaidOverviewDiagramPrompt) {
        throw new Error(_('mermaidOverviewMissingSettings'));
    }

    const { question, answers } = buildMermaidOverviewPromptPayload(userMessage, linkedResponse);
    if (!question || answers.length === 0) {
        throw new Error(_('mermaidOverviewNoLinkedResponse'));
    }

    const answersText = answers.map(({ modelId, answer }) => `## ${modelId}\n${answer}`).join('\n\n');
    const summaryMessages = [
        {
            role: 'system',
            content: `${state.mermaidOverviewSummaryPrompt}\n\n${_('mermaidOverviewSummarySystemPrompt')}`
        },
        {
            role: 'user',
            content: `用户问题：\n${question}\n\n所有模型回答：\n${answersText}`
        }
    ];

    const summaryText = await callTextModelOnce(state.mermaidOverviewModel, summaryMessages);

    const diagramMessages = [
        {
            role: 'system',
            content: `${state.mermaidOverviewDiagramPrompt}\n\n${_('mermaidOverviewDiagramSystemPrompt')}`
        },
        {
            role: 'user',
            content: `用户问题：\n${question}\n\n所有模型回答：\n${answersText}\n\n总结结果：\n${summaryText}`
        }
    ];

    const mermaidCode = await callTextModelOnce(state.mermaidOverviewModel, diagramMessages);
    const validationResult = await validateMermaidCode(mermaidCode);
    if (!validationResult.valid) {
        throw new Error(validationResult.error);
    }

    userMessage.mermaidOverview = createDefaultMermaidOverviewState({
        status: MERMAID_OVERVIEW_READY,
        linkedResponseId: linkedResponse.id,
        generatorModel: state.mermaidOverviewModel,
        summaryPromptSnapshot: state.mermaidOverviewSummaryPrompt,
        diagramPromptSnapshot: state.mermaidOverviewDiagramPrompt,
        summaryText,
        mermaidCode: validationResult.code,
        generatedAt: Date.now(),
        errorMessage: ''
    });

    return userMessage.mermaidOverview;
}

function resetMermaidOverviewForUserMessage(userMessageId) {
    const userMessage = findMessageById(userMessageId);
    if (!userMessage || userMessage.role !== 'user') return;
    userMessage.mermaidOverview = createDefaultMermaidOverviewState();
    refreshMessageActionButtonsByMessageId(userMessageId);
}

window.resetMermaidOverviewForUserMessage = resetMermaidOverviewForUserMessage;

async function triggerMermaidOverviewForMessage(messageElement) {
    const userMessageId = messageElement?.dataset?.messageId;
    const userMessage = findMessageById(userMessageId);
    if (!userMessage || userMessage.role !== 'user') {
        return;
    }

    const mermaidOverview = ensureUserMessageMermaidOverview(userMessage);
    if (mermaidOverview.status === MERMAID_OVERVIEW_GENERATING) {
        return;
    }

    if (mermaidOverview.status === MERMAID_OVERVIEW_READY && mermaidOverview.mermaidCode) {
        try {
            activeMermaidOverviewMessageId = userMessageId;
            await openMermaidOverviewModal(mermaidOverview.mermaidCode);
        } catch (error) {
            activeMermaidOverviewMessageId = null;
            updateMermaidModalRegenerateButton();
            showToastUI(error.message, 'error');
        }
        return;
    }

    mermaidOverview.status = MERMAID_OVERVIEW_GENERATING;
    mermaidOverview.errorMessage = '';
    refreshMessageActionButtonsByMessageId(userMessageId);
    showToastUI(_('mermaidOverviewGenerationStarted'), 'success');

    try {
        const generatedOverview = await generateMermaidOverviewForMessage(userMessage);
        refreshMessageActionButtonsByMessageId(userMessageId);
        showToastUI(_('mermaidOverviewGeneratedSuccess'), 'success');
    } catch (error) {
        userMessage.mermaidOverview = createDefaultMermaidOverviewState({
            status: MERMAID_OVERVIEW_ERROR,
            linkedResponseId: mermaidOverview.linkedResponseId || '',
            generatorModel: state.mermaidOverviewModel,
            summaryPromptSnapshot: state.mermaidOverviewSummaryPrompt,
            diagramPromptSnapshot: state.mermaidOverviewDiagramPrompt,
            errorMessage: error.message || 'Unknown error'
        });
        refreshMessageActionButtonsByMessageId(userMessageId);
        activeMermaidOverviewMessageId = null;
        showToastUI(_('mermaidOverviewGenerationFailed', { error: error.message || 'Unknown error' }), 'error');
        updateMermaidModalRegenerateButton();
    }
}

async function regenerateMermaidOverviewFromModal() {
    if (!activeMermaidOverviewMessageId) return;

    const userMessage = findMessageById(activeMermaidOverviewMessageId);
    if (!userMessage || userMessage.role !== 'user') return;

    const previousOverview = ensureUserMessageMermaidOverview(userMessage);
    const previousReadyState = previousOverview.status === MERMAID_OVERVIEW_READY ? { ...previousOverview } : null;

    userMessage.mermaidOverview = createDefaultMermaidOverviewState({
        ...previousOverview,
        status: MERMAID_OVERVIEW_GENERATING,
        errorMessage: ''
    });
    refreshMessageActionButtonsByMessageId(activeMermaidOverviewMessageId);
    updateMermaidModalRegenerateButton();
    showToastUI(_('mermaidOverviewGenerationStarted'), 'success');

    try {
        const generatedOverview = await generateMermaidOverviewForMessage(userMessage);
        refreshMessageActionButtonsByMessageId(activeMermaidOverviewMessageId);
        showToastUI(_('mermaidOverviewGeneratedSuccess'), 'success');
        await openMermaidOverviewModal(generatedOverview.mermaidCode);
    } catch (error) {
        if (previousReadyState) {
            userMessage.mermaidOverview = previousReadyState;
            try {
                await openMermaidOverviewModal(previousReadyState.mermaidCode);
            } catch (modalError) {
                console.warn('[main.js] Failed to restore previous Mermaid modal content:', modalError);
            }
        } else {
            userMessage.mermaidOverview = createDefaultMermaidOverviewState({
                status: MERMAID_OVERVIEW_ERROR,
                linkedResponseId: previousOverview.linkedResponseId || '',
                generatorModel: state.mermaidOverviewModel,
                summaryPromptSnapshot: state.mermaidOverviewSummaryPrompt,
                diagramPromptSnapshot: state.mermaidOverviewDiagramPrompt,
                errorMessage: error.message || 'Unknown error'
            });
        }

        refreshMessageActionButtonsByMessageId(activeMermaidOverviewMessageId);
        showToastUI(_('mermaidOverviewGenerationFailed', { error: error.message || 'Unknown error' }), 'error');
    } finally {
        updateMermaidModalRegenerateButton();
    }
}

function handleMermaidOverviewAction(action, messageElement) {
    if (action === 'shouldShow') {
        return shouldShowMermaidOverviewButton(messageElement);
    }

    if (action === 'getState') {
        return getMermaidOverviewStateForMessageElement(messageElement);
    }

    if (action === 'trigger') {
        void triggerMermaidOverviewForMessage(messageElement);
    }

    return null;
}


// Wrapper function for regenerateMessage
function regenerateMessageUI(messageId) {
    regenerateMessageAction(
        messageId, state, elements, currentTranslations,
        addMessageToChatUI,
        (afterEl) => uiAddThinkingAnimation(afterEl, elements, isUserNearBottom),
        restoreSendButtonAndInputUI,
        showToastUI,
        updateSelectedTabsBarFromMain
    );
}

function triggerFollowUpQuestionsForResponse(responseMessageId, sourceUserMessageId = '', force = false) {
    if (!responseMessageId) return;
    generateFollowUpQuestionsForResponseAction({
        state,
        elements,
        currentTranslations,
        responseMessageId,
        sourceUserMessageId,
        sendMessage: sendFollowUpQuestionText,
        force
    });
}

function sendFollowUpQuestionText(questionText) {
    const text = String(questionText || '').trim();
    if (!text) return;
    if (state.isStreaming) {
        showToastUI(_('streamingInProgress', {}, currentTranslations), 'warning');
        return;
    }

    elements.userInput.value = text;
    resizeTextarea(elements);
    if (window.updateCometCaret) window.updateCometCaret();
    sendUserMessageTrigger();
}

// Wrapper function for deleteMessage
function deleteMessageUI(messageId) {
    const messageIndex = state.chatHistory.findIndex(msg => msg.id === messageId);
    const idsToRemove = [];
    const botMessageElement = document.querySelector(`.bot-message[data-message-id="${messageId}"]`);
    const multiModelContainer = botMessageElement?.closest('.multi-model-response-container');
    if (multiModelContainer && multiModelContainer.querySelectorAll('.bot-message-column').length <= 1) {
        idsToRemove.push(multiModelContainer.dataset.messageId);
    }

    if (messageIndex !== -1 && state.chatHistory[messageIndex]?.role === 'user') {
        idsToRemove.push(state.chatHistory[messageIndex].id);
        let nextIndex = messageIndex + 1;
        while (nextIndex < state.chatHistory.length && state.chatHistory[nextIndex]?.role === 'model') {
            idsToRemove.push(state.chatHistory[nextIndex].id);
            nextIndex += 1;
        }
    } else if (messageId) {
        idsToRemove.push(messageId);
    }

    deleteMessageAction(messageId, state);
    removeFollowUpQuestionsForMessageIds(idsToRemove, state, elements);
    syncChatInputVisibility();
}

// Wrapper function for clearImages
function clearImagesUI() {
    clearImages(state, updateImagesPreviewUI);
}

// Wrapper function for updateImagesPreview
function updateImagesPreviewUI() {
    updateImagesPreview(state, elements, currentTranslations, removeImageByIdUI);
}

// Wrapper function for removeImageById
function removeImageByIdUI(imageId) {
    removeImageById(imageId, state, updateImagesPreviewUI);
}

// Wrapper function for clearVideos
function clearVideosUI() {
    clearVideos(state, updateVideosPreviewUI);
}

// Wrapper function for updateVideosPreview
function updateVideosPreviewUI() {
    updateVideosPreview(state, elements, currentTranslations, removeVideoByIdUI);
}

// Wrapper function for removeVideoById
function removeVideoByIdUI(videoId) {
    removeVideoById(videoId, state, updateVideosPreviewUI);
}

// Wrapper function for showToast
function showToastUI(message, type, customClass = '') {
    showToast(message, type, customClass);
}

function updateFooterContextStatusFromState() {
    const pageContextStatus = getPageContextStatus(state.pageContext);

    if (pageContextStatus === 'extracting') {
        updateContextStatus('contextStatusExtracting', {}, elements, currentTranslations);
        return;
    }

    if (pageContextStatus === 'failed') {
        updateContextStatus('contextStatusFailed', {}, elements, currentTranslations);
        return;
    }

    if (pageContextStatus === 'ready') {
        updateContextStatus('contextStatusChars', { charCount: getPageContextCharCount(getPageContextTextForPrompt(state)) }, elements, currentTranslations);
        return;
    }

    updateContextStatus('contextStatusNone', {}, elements, currentTranslations);
}

function isContextPreviewModalOpen() {
    return !!(elements.contextPreviewModal && getComputedStyle(elements.contextPreviewModal).display !== 'none');
}

function renderContextPreviewModal() {
    if (!elements.contextPreviewContent || !elements.contextPreviewMeta || !elements.contextPreviewCopy) return;

    if (elements.contextPreviewRemoveLinks) {
        elements.contextPreviewRemoveLinks.checked = state.removeContextWebLinks !== false;
    }
    if (elements.contextPreviewRemoveSitePaths) {
        elements.contextPreviewRemoveSitePaths.checked = state.removeContextSitePaths !== false;
    }

    const pageContextStatus = getPageContextStatus(state.pageContext);
    const pageContext = getPageContextTextForPrompt(state);
    const metaParts = [];

    if (state.pageTitle) {
        metaParts.push(state.pageTitle);
    }

    if (pageContextStatus === 'ready') {
        metaParts.push(_('contextStatusChars', { charCount: getPageContextCharCount(pageContext) }));
        const extractionMetaParts = formatPageContextMetaForPreview(state.pageContextMeta);
        metaParts.push(...extractionMetaParts);
    }

    elements.contextPreviewMeta.textContent = metaParts.join(' · ');
    elements.contextPreviewMeta.style.display = metaParts.length > 0 ? 'block' : 'none';

    if (pageContextStatus === 'ready') {
        renderContextPreviewSections(pageContext);
        elements.contextPreviewCopy.disabled = false;
        return;
    }

    const statusKeyMap = {
        extracting: 'contextStatusExtracting',
        failed: 'contextStatusFailed',
        none: 'contextStatusNone'
    };

    renderContextPreviewStatus(_(statusKeyMap[pageContextStatus] || 'contextStatusNone'));
    elements.contextPreviewCopy.disabled = true;
}

function renderContextPreviewStatus(text) {
    elements.contextPreviewContent.innerHTML = '';
    elements.contextPreviewContent.classList.remove('context-preview-sections');
    elements.contextPreviewContent.textContent = text;
    contextPreviewSearchState = { query: '', matches: [], activeIndex: -1 };
    updateContextPreviewSearchNavState();
}

function renderContextPreviewSections(pageContext) {
    elements.contextPreviewContent.innerHTML = '';
    elements.contextPreviewContent.classList.add('context-preview-sections');

    const sections = splitContextPreviewSections(pageContext);
    const panelData = [
        {
            key: 'article',
            title: _('contextPreviewArticlePanelTitle'),
            content: sections.article,
            empty: _('contextPreviewArticleEmpty')
        },
        {
            key: 'comments',
            title: _('contextPreviewCommentsPanelTitle'),
            content: sections.comments,
            empty: _('contextPreviewCommentsEmpty')
        },
        {
            key: 'manual',
            title: _('contextPreviewManualAreaPanelTitle'),
            content: sections.manual,
            empty: _('contextPreviewManualAreaEmpty')
        }
    ];

    panelData.forEach(panel => {
        const panelEl = document.createElement('section');
        panelEl.className = `context-preview-section context-preview-section-${panel.key}`;

        const titleEl = document.createElement('h4');
        titleEl.className = 'context-preview-section-title';
        titleEl.textContent = panel.title;

        const bodyEl = document.createElement('div');
        bodyEl.className = 'context-preview-section-body';
        bodyEl.dataset.contextPreviewText = panel.content || '';
        bodyEl.dataset.contextPreviewEmpty = panel.empty;
        bodyEl.textContent = panel.content || panel.empty;
        if (!panel.content) {
            bodyEl.classList.add('context-preview-section-empty');
        }

        panelEl.appendChild(titleEl);
        panelEl.appendChild(bodyEl);
        elements.contextPreviewContent.appendChild(panelEl);
    });

    if (elements.contextPreviewSearch?.value) {
        applyContextPreviewSearch(elements.contextPreviewSearch.value);
    }
}

function applyContextPreviewSearch(rawQuery) {
    if (!elements.contextPreviewContent) return;
    const query = String(rawQuery || '').trim();
    const bodies = Array.from(elements.contextPreviewContent.querySelectorAll('.context-preview-section-body'));
    contextPreviewSearchState = {
        query,
        matches: [],
        activeIndex: -1
    };

    bodies.forEach(body => {
        body.classList.remove('context-preview-section-active-match');
        const originalText = body.dataset.contextPreviewText || '';
        if (originalText) {
            body.textContent = originalText;
            body.classList.remove('context-preview-section-empty');
        } else {
            body.textContent = body.dataset.contextPreviewEmpty || '';
            body.classList.add('context-preview-section-empty');
        }
    });

    if (!query) {
        updateContextPreviewSearchNavState();
        return;
    }

    for (const body of bodies) {
        const text = body.dataset.contextPreviewText || '';
        if (!text) continue;
        const matches = findContextPreviewMatches(text, query);
        if (matches.length === 0) continue;

        renderContextPreviewHighlightedMatches(body, text, matches);
        const renderedMarks = Array.from(body.querySelectorAll('.context-preview-search-match'));
        if (renderedMarks.length > 0) {
            contextPreviewSearchState.matches.push(...renderedMarks);
        }
    }

    if (contextPreviewSearchState.matches.length > 0) {
        contextPreviewSearchState.activeIndex = 0;
        activateContextPreviewSearchMatch(0);
    }
    updateContextPreviewSearchNavState();
}

function navigateContextPreviewSearch(direction) {
    const matches = contextPreviewSearchState.matches || [];
    if (!matches.length) return;
    const nextIndex = (contextPreviewSearchState.activeIndex + direction + matches.length) % matches.length;
    activateContextPreviewSearchMatch(nextIndex);
    updateContextPreviewSearchNavState();
}

function activateContextPreviewSearchMatch(index) {
    const matches = contextPreviewSearchState.matches || [];
    if (!matches.length || index < 0 || index >= matches.length) return;

    matches.forEach(match => match.classList.remove('context-preview-search-match-active'));
    elements.contextPreviewContent
        ?.querySelectorAll('.context-preview-section-body')
        .forEach(body => body.classList.remove('context-preview-section-active-match'));

    const activeMatch = matches[index];
    activeMatch.classList.add('context-preview-search-match-active');
    const matchBody = activeMatch.closest('.context-preview-section-body');
    matchBody?.classList.add('context-preview-section-active-match');
    contextPreviewSearchState.activeIndex = index;
    activeMatch.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
}

function updateContextPreviewSearchNavState() {
    const hasMatches = (contextPreviewSearchState.matches || []).length > 0;
    if (elements.contextPreviewSearchPrev) elements.contextPreviewSearchPrev.disabled = !hasMatches;
    if (elements.contextPreviewSearchNext) elements.contextPreviewSearchNext.disabled = !hasMatches;
}

function findContextPreviewMatches(text, query) {
    const normalizedText = text.toLowerCase();
    const normalizedQuery = query.toLowerCase();
    const exactMatches = [];
    let exactIndex = normalizedText.indexOf(normalizedQuery);
    while (exactIndex !== -1) {
        exactMatches.push({
            start: exactIndex,
            end: exactIndex + query.length
        });
        exactIndex = normalizedText.indexOf(normalizedQuery, exactIndex + Math.max(1, query.length));
    }
    if (exactMatches.length > 0) {
        return exactMatches;
    }

    let textIndex = 0;
    const positions = [];
    for (const char of normalizedQuery) {
        const foundAt = normalizedText.indexOf(char, textIndex);
        if (foundAt === -1) return [];
        positions.push(foundAt);
        textIndex = foundAt + 1;
    }

    if (positions.length === 0) return [];
    return [{
        start: positions[0],
        end: positions[positions.length - 1] + 1
    }];
}

function renderContextPreviewHighlightedMatches(body, text, matches) {
    body.innerHTML = '';
    let cursor = 0;
    matches.forEach(match => {
        if (match.start > cursor) {
            body.appendChild(document.createTextNode(text.slice(cursor, match.start)));
        }
        const mark = document.createElement('mark');
        mark.className = 'context-preview-search-match';
        mark.textContent = text.slice(match.start, match.end);
        body.appendChild(mark);
        cursor = match.end;
    });
    if (cursor < text.length) {
        body.appendChild(document.createTextNode(text.slice(cursor)));
    }
}

function splitContextPreviewSections(pageContext) {
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
        const body = stripContextPreviewSectionDecorators(pageContext.slice(start, end));

        if (title === 'Page Content') {
            sections.article = appendPreviewSectionText(sections.article, body);
        } else if (title === 'Comments / Replies') {
            sections.comments = appendPreviewSectionText(sections.comments, body);
        } else if (title === 'Manually Selected Page Area') {
            sections.manual = appendPreviewSectionText(sections.manual, body);
        }
    });

    return sections;
}

function stripContextPreviewSectionDecorators(text) {
    return String(text || '')
        .replace(/^\s*---\s*$/gm, '')
        .replace(/^_Source:[^\n]*_\s*/gmi, '')
        .trim();
}

function appendPreviewSectionText(existing, next) {
    const cleanNext = String(next || '').trim();
    if (!cleanNext) return existing || '';
    return existing ? `${existing}\n\n---\n\n${cleanNext}` : cleanNext;
}

function formatPageContextMetaForPreview(meta) {
    if (!meta || typeof meta !== 'object') return [];

    const parts = [];
    if (typeof meta.articleCharCount === 'number' && meta.articleCharCount > 0) {
        parts.push(_('contextPreviewPageContentChars', { charCount: meta.articleCharCount }));
    }
    if (typeof meta.commentsCharCount === 'number' && meta.commentsCharCount > 0) {
        parts.push(_('contextPreviewCommentsChars', {
            charCount: meta.commentsCharCount,
            sectionCount: meta.commentContainerCount || 0
        }));
    } else if (meta.mode === 'article-plus-comments') {
        parts.push(_('contextPreviewCommentsNone'));
    }
    if (meta.truncated) {
        parts.push(_('contextPreviewTruncated'));
    }
    if (typeof meta.manualAreaCharCount === 'number' && meta.manualAreaCharCount > 0) {
        parts.push(_('contextPreviewManualAreaChars', {
            charCount: meta.manualAreaCharCount,
            areaCount: meta.manualAreaCount || 1
        }));
    }

    return parts;
}

function appendManualAreaToPageContext(content, meta = {}) {
    const cleanContent = typeof content === 'string' ? content.trim() : '';
    if (!cleanContent) return;

    const sectionLabel = _('manualAreaContextSectionTitle', {}, currentTranslations);
    const sourceLabel = _('manualAreaContextSourceLabel', {
        selector: meta?.selector || ''
    }, currentTranslations);
    const manualSection = `# ${sectionLabel}\n\n_${sourceLabel}_\n\n${cleanContent}`;
    const existingContext = typeof state.pageContext === 'string' && state.pageContext !== 'error' ? state.pageContext.trim() : '';
    state.pageContext = existingContext ? `${existingContext}\n\n---\n\n${manualSection}` : manualSection;

    const previousMeta = state.pageContextMeta && typeof state.pageContextMeta === 'object' ? state.pageContextMeta : {};
    const previousManualCount = previousMeta.manualAreaCount || 0;
    const previousManualChars = previousMeta.manualAreaCharCount || 0;
    state.pageContextMeta = {
        ...previousMeta,
        manualAreaCount: previousManualCount + 1,
        manualAreaCharCount: previousManualChars + cleanContent.length
    };
}

function openContextPreviewModal() {
    if (!elements.contextPreviewModal) return;
    renderContextPreviewModal();
    elements.contextPreviewModal.style.display = 'flex';
    elements.contextPreviewCloseIcon?.focus();
}

function closeContextPreviewModal() {
    if (!elements.contextPreviewModal) return;
    elements.contextPreviewModal.style.display = 'none';
}


// --- Communication with Content Script ---

function handleContentScriptMessages(event) {
    const message = event.data;
    switch (message.action) {
        case 'pageContentExtracted':
            state.pageContext = message.content;
            state.pageTitle = message.pageTitle || ''; // 保存页面标题
            state.pageUrl = message.pageUrl || '';
            state.pageContextMeta = message.meta || null;
            updateFooterContextStatusFromState();
            if (isContextPreviewModalOpen()) {
                renderContextPreviewModal();
            }
            if (message.showSuccessMessage) {
                const msgText = _('pageContentExtractedSuccess', {}, currentTranslations);
                showChatStatusMessage(msgText, 'success', elements);
            }
            break;
        case 'pageAreaSelected':
            appendManualAreaToPageContext(message.content, message.meta);
            updateFooterContextStatusFromState();
            openContextPreviewModal();
            showToastUI(_('contextAreaAddedSuccess', {}, currentTranslations), 'success');
            break;
        case 'pageAreaSelectionCancelled':
            showToastUI(_('contextAreaSelectionCancelled', {}, currentTranslations), 'info');
            break;
        case 'pageAreaSelectionFailed':
            showToastUI(_('contextAreaSelectionFailed', { error: message.error || '' }, currentTranslations), 'error');
            break;
        case 'pageContentLoaded':
            requestPageContent();
            break;
        case 'copySuccess':
            // Feedback is now handled within the copy functions themselves
            // console.log('Copy successful (message from content script)');
            break;
        case 'panelShownAndFocusInput': // 修改：处理新的 action
            startThemeReadyTimeout();
            // 首先确保聊天标签页是当前活动的标签页
            // 强制切换到聊天标签页并聚焦输入框
            switchTab('chat', elements, (subTab) => switchSettingsSubTab(subTab, elements)); // 确保聊天标签页被激活
            if (elements.userInput) {
                setTimeout(() => elements.userInput.focus(), 50);
                // console.log("User input focused on panel shown (forced via panelShownAndFocusInput).");
            }
            resizeTextarea(elements); // 保持原有 resize 逻辑
            break;
        case 'panelResized':
            resizeTextarea(elements);
            break;
        case 'webpageThemeDetected':
            console.log(`[main.js] Received webpage theme: ${message.theme}`);
            if (message.theme === 'dark' || message.theme === 'light') {
                const isWebpageDark = message.theme === 'dark';
                console.log(`Applying webpage theme: ${message.theme}`);
                state.hasWebpageTheme = true;
                state.darkMode = isWebpageDark;
                applyTheme(isWebpageDark, elements);
                updateMermaidTheme(isWebpageDark, rerenderAllMermaidChartsUI);
                markThemeReady();
            } else {
                console.log(`Ignoring non-explicit webpage theme: ${message.theme}`);
                markThemeReady();
            }
            break;
        case 'languageChanged':
            console.log(`[main.js] Received language change: ${message.newLanguage}`);
            handleLanguageChangeFromContent(message.newLanguage);
            break;
        case 'extensionReloaded':
            console.log(`[main.js] Extension reloaded - reinitializing`);
            handleExtensionReloadFromContent();
            break;
        case 'proxyAutoCleared':
            console.log(`[main.js] Proxy auto-cleared notification:`, message.failedProxy);
            handleProxyAutoClearedFromContent(message.failedProxy);
            break;
        case 'callUnifiedAPIFromBackground':
            console.log(`[main.js] Received API call request from background:`, message.model);
            handleUnifiedAPICallFromBackground(message);
            break;
        case 'modelsUpdated':
            console.log(`[main.js] Models updated - refreshing model selectors`);
            handleModelsUpdatedFromContent();
            break;
    }
}

function requestPageContent() {
    state.pageContext = null;
    state.pageTitle = '';
    state.pageUrl = '';
    state.pageContextMeta = null;
    updateFooterContextStatusFromState();
    if (isContextPreviewModalOpen()) {
        renderContextPreviewModal();
    }
    window.parent.postMessage({ action: 'requestPageContent' }, '*');

    // 添加超时机制，如果10秒内没有收到响应，显示失败状态
    setTimeout(() => {
        if (state.pageContext === null) { // 仍然是初始状态，说明没有收到响应
            console.warn('[main.js] Page content extraction timeout');
            state.pageContext = 'error';
            state.pageContextMeta = null;
            updateFooterContextStatusFromState();
            if (isContextPreviewModalOpen()) {
                renderContextPreviewModal();
            }
        }
    }, 10000); // 10秒超时
}

function requestThemeFromContentScript() {
    // 检查是否在iframe中
    if (window.parent !== window) {
        // 在iframe中，检查Chrome API是否可用
        if (!chrome || !chrome.tabs || !chrome.runtime) {
            console.log("[main.js] In iframe context with invalidated extension context, requesting theme via content script message");
            // 通过content script代理请求主题
            window.parent.postMessage({ action: 'requestThemeFromIframe' }, '*');
            return;
        }
    }

    // 检查Chrome API的可用性，避免在失效状态下调用
    if (!chrome || !chrome.tabs || !chrome.runtime) {
        console.log("[main.js] Chrome API not available, applying system theme preference");
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        state.darkMode = prefersDark;
        applyTheme(state.darkMode, elements);
        updateMermaidTheme(state.darkMode, rerenderAllMermaidChartsUI);
        markThemeReady();
        return;
    }

    try {
        // 如果Chrome API可用，直接使用
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (chrome.runtime.lastError) {
                console.log("[main.js] Chrome API context invalidated, applying system theme preference");
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                state.darkMode = prefersDark;
                applyTheme(state.darkMode, elements);
                updateMermaidTheme(state.darkMode, rerenderAllMermaidChartsUI);
                markThemeReady();
                return;
            }

            if (tabs && tabs[0] && tabs[0].id) {
                chrome.tabs.sendMessage(tabs[0].id, { action: "requestTheme" }, (response) => {
                    if (chrome.runtime.lastError) {
                        // console.warn("Could not request theme from content script:", chrome.runtime.lastError.message);
                        // Apply default theme based on system preference if request fails
                        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                        console.log("Falling back to system theme preference:", prefersDark ? 'dark' : 'light');
                        state.darkMode = prefersDark;
                        applyTheme(state.darkMode, elements);
                        updateMermaidTheme(state.darkMode, rerenderAllMermaidChartsUI);
                        markThemeReady();
                    } else {
                        // Theme will be applied via 'webpageThemeDetected' message handler
                        // console.log("Theme request sent to content script.");
                    }
                });
            } else {
                console.warn("Could not get active tab ID to request theme.");
                // Apply default theme based on system preference
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                state.darkMode = prefersDark;
                applyTheme(state.darkMode, elements);
                updateMermaidTheme(state.darkMode, rerenderAllMermaidChartsUI);
                markThemeReady();
            }
        });
    } catch (e) {
        // 如果在iframe中且Chrome API失效，使用代理方式
        if (window.parent !== window) {
            console.log("[main.js] Chrome API failed in iframe, using content script proxy");
            window.parent.postMessage({ action: 'requestThemeFromIframe' }, '*');
        } else {
            console.log("[main.js] Error requesting theme, applying system theme preference");
            // Apply default theme based on system preference
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            state.darkMode = prefersDark;
            applyTheme(state.darkMode, elements);
            updateMermaidTheme(state.darkMode, rerenderAllMermaidChartsUI);
            markThemeReady();
        }
    }
}

function closePanel() {
    flushPendingAgentSaves(elements);
    if (themeReadyTimeoutId) {
        clearTimeout(themeReadyTimeoutId);
        themeReadyTimeoutId = null;
    }
    if (document.body) {
        document.body.classList.add('theme-pending');
    }
    window.parent.postMessage({ action: 'closePanel' }, '*');
}

/**
 * 处理来自background的API调用转发请求
 */
async function handleUnifiedAPICallFromBackground(message) {
    try {
        const { model, messages, options } = message;
        console.log('[main.js] Handling unified API call from background for model:', model);

        // 检查统一API接口是否可用
        if (!window.ModelManager?.instance || !window.PageTalkAPI?.callApi) {
            throw new Error(_('unifiedApiNotAvailable', {}, currentTranslations));
        }

        // 确保ModelManager已初始化
        await window.ModelManager.instance.initialize();

        let accumulatedText = '';

        // 流式回调函数
        const streamCallback = (chunk, complete) => {
            accumulatedText += chunk;
            // 对于划词助手，我们不需要实时流式更新，只需要最终结果
        };

        // 调用统一API接口
        await window.PageTalkAPI.callApi(model, messages, streamCallback, options);

        // 发送成功响应
        window.parent.postMessage({
            action: 'unifiedAPIResponse',
            success: true,
            response: accumulatedText
        }, '*');

    } catch (error) {
        console.error('[main.js] Error handling unified API call from background:', error);

        // 发送错误响应
        window.parent.postMessage({
            action: 'unifiedAPIResponse',
            success: false,
            error: error.message
        }, '*');
    }
}

/**
 * 处理来自content script的模型更新通知
 */
async function handleModelsUpdatedFromContent() {
    console.log(`[main.js] Handling models updated from content`);

    try {
        // 重新初始化模型选择器
        await initModelSelection(state, elements);
        console.log(`[main.js] Model selectors refreshed successfully`);
    } catch (error) {
        console.error(`[main.js] Error refreshing model selectors:`, error);
    }
}

/**
 * 处理来自content script的语言变化通知
 */
async function handleLanguageChangeFromContent(newLanguage) {
    console.log(`[main.js] Handling language change from content: ${newLanguage}`);

    // 更新状态
    state.language = newLanguage;

    // 重新加载并应用翻译
    await loadAndApplyTranslations(newLanguage);

    // 重新初始化划词助手设置（如果设置页面打开）
    if (window.initTextSelectionHelperSettings && elements.textSelectionHelperSettings) {
        const settingsContainer = elements.textSelectionHelperSettings;
        if (settingsContainer && settingsContainer.style.display !== 'none') {
            console.log('[main.js] Reinitializing text selection helper settings for language change');
            const translations = window.translations && window.translations[newLanguage] ? window.translations[newLanguage] : {};
            window.initTextSelectionHelperSettings(elements, translations, showToastUI);
        }
    }
}

/**
 * 处理来自content script的扩展重载通知
 */
async function handleExtensionReloadFromContent() {
    console.log(`[main.js] Handling extension reload from content`);

    // 扩展重载后，content script会自动重新检测主题，所以这里不需要主动请求
    // 只在必要时才请求主题（比如用户手动触发）
    console.log('[main.js] Extension reloaded, theme will be auto-detected by content script');

    // 重新加载当前语言的翻译
    if (state.language) {
        await loadAndApplyTranslations(state.language);
    }

    // 重新初始化所有设置
    if (window.initTextSelectionHelperSettings && elements.textSelectionHelperSettings) {
        console.log('[main.js] Reinitializing text selection helper settings after extension reload');
        const translations = window.translations && window.translations[state.language] ? window.translations[state.language] : {};
        window.initTextSelectionHelperSettings(elements, translations, showToastUI);
    }
}

/**
 * 处理代理自动清除通知
 */
function handleProxyAutoClearedFromContent(failedProxy) {
    console.log('[main.js] Handling proxy auto-cleared notification for:', failedProxy);

    // 更新UI中的代理地址输入框
    if (elements.proxyAddressInput) {
        elements.proxyAddressInput.value = '';
    }

    // 更新状态
    state.proxyAddress = '';

    // 显示通知给用户
    const message = _('proxyConnectionFailed', { proxy: failedProxy }, currentTranslations);
    if (showToastUI) {
        showToastUI(message, 'warning', 'toast-proxy-cleared');
    }

    console.log('[main.js] Proxy settings cleared due to connection failure');
}

// --- Translation Loading ---
async function loadAndApplyTranslations(language) {
    if (typeof window.translations === 'undefined') {
        console.error(_('translationsNotFound', {}, currentTranslations));
        return;
    }
    currentTranslations = window.translations[language] || window.translations['en']; // Fallback to English
    state.language = language; // Ensure state is updated
    console.log(`Applying translations for: ${language}`);
    updateUIElementsWithTranslations(currentTranslations); // Update static UI text

    // Update dynamic parts that depend on translations
    updateAgentsListUIAllArgs(); // Re-render agent list with translated labels/placeholders
    updateAgentSelectionInChatUI(); // Ensure chat agent selection is updated with translations
    // 仅当已判定连接状态后才渲染连接状态文案
    if (state.hasDeterminedConnection) {
        updateConnectionIndicator(state.isConnected, elements, currentTranslations);
    }

    // 更新默认快捷操作的翻译
    try {
        await QuickActionsManager.updateDefaultActionsTranslations();
    } catch (error) {
        console.warn('[main.js] Error updating default quick actions translations:', error);
    }

    // 重新渲染快捷操作列表以更新翻译
    try {
        await renderQuickActionsList(currentTranslations);
    } catch (error) {
        console.warn('[main.js] Error updating quick actions list translations:', error);
    }

    // 广播语言变化事件给动态创建的UI组件（如自定义选项对话框）
    try {
        const languageChangeEvent = new CustomEvent('pagetalk:languageChanged', {
            detail: { newLanguage: language }
        });
        document.dispatchEvent(languageChangeEvent);
        console.log(`[main.js] Language change event dispatched for: ${language}`);
    } catch (error) {
        console.warn('[main.js] Error dispatching language change event:', error);
    }
    updateFooterContextStatusFromState();
    if (isContextPreviewModalOpen()) {
        renderContextPreviewModal();
    }

    // Re-render welcome message if chat is empty
    if (elements.chatMessages && elements.chatMessages.children.length === 1 && elements.chatMessages.firstElementChild.classList.contains('welcome-message')) {
        // 只有在快捷操作管理器已经初始化的情况下才刷新欢迎消息
        if (window.QuickActionsManager && window.QuickActionsManager.isQuickActionsManagerInitialized && window.QuickActionsManager.isQuickActionsManagerInitialized()) {
            await refreshWelcomeMessageQuickActions();
        } else {
            console.log('[main.js] Skipping welcome message refresh - QuickActionsManager not yet initialized');
        }
    } else {
        // Update existing welcome message if present
        const welcomeHeading = elements.chatMessages.querySelector('.welcome-message h2');
        if (welcomeHeading) welcomeHeading.textContent = _('welcomeHeading');
        // 注意：不再更新快捷操作按钮的文本，因为它们现在是动态的
        // 如果需要更新快捷操作，应该使用 refreshWelcomeMessageQuickActions()
        // Also update existing message action button titles
        document.querySelectorAll('.message-action-btn, .copy-button').forEach(btn => {
            if (btn.classList.contains('copy-button')) btn.title = _('copyAll');
            else if (btn.classList.contains('regenerate-btn')) btn.title = _('regenerate');
            else if (btn.classList.contains('delete-btn')) btn.title = _('deleteMessage');
            else if (btn.classList.contains('mermaid-overview-btn')) {
                const status = btn.dataset.mermaidStatus || MERMAID_OVERVIEW_IDLE;
                const titleKey = status === MERMAID_OVERVIEW_READY
                    ? 'mermaidOverviewView'
                    : status === MERMAID_OVERVIEW_GENERATING
                        ? 'mermaidOverviewGenerating'
                        : status === MERMAID_OVERVIEW_ERROR
                            ? 'mermaidOverviewRetry'
                            : 'mermaidOverviewGenerate';
                btn.title = _(titleKey);
            }
        });
        document.querySelectorAll('.code-copy-button').forEach(btn => btn.title = _('copyCode'));
        updateMermaidModalRegenerateButton();
    }

    syncChatInputVisibility();


    // Sync Day.js locale
    if (typeof dayjs !== 'undefined') {
        dayjs.locale(language.toLowerCase() === 'zh-cn' ? 'zh-cn' : 'en');
        console.log(`Day.js locale set to: ${dayjs.locale()}`);
    } else {
        console.warn('Day.js not loaded, cannot set locale.');
    }
}

// --- Global Access (if needed for dynamic buttons, etc.) ---
// Expose functions needed by dynamically created elements if necessary
window.sendUserMessageTrigger = sendUserMessageTrigger;
window.addCopyButtonToCodeBlock = addCopyButtonToCodeBlockUI; // Expose wrappers if needed elsewhere
window.addMessageActionButtons = addMessageActionButtonsUI;
// window.updateStreamingMessage and window.finalizeBotMessage are set in init()
window.showToast = showToastUI; // Expose toast globally if needed
window.showToastUI = showToastUI; // Also expose as showToastUI for consistency
window.updateCurrentModelDisplay = updateCurrentModelDisplay; // Expose for settings.js to update inline model selector

// 假设这是在"首次操作"完成，并且聊天消息等已添加到DOM之后
function onFirstOperationComplete() {
    // ... 其他逻辑 ...

    // 尝试强制重绘/回流聊天头部来修正选择框位置
    const chatHeader = elements.chatMessages.previousElementSibling; // 假设 .chat-header 就在 .chat-messages 前面
    if (chatHeader && chatHeader.classList.contains('chat-header')) {
        // 一种轻微强制回流的方法
        chatHeader.style.display = 'none';
        void chatHeader.offsetHeight; // 读取 offsetHeight 会强制浏览器回流
        chatHeader.style.display = 'flex'; // 恢复原状
    }
    // 或者，如果确认 resizeTextarea 能解决且无明显副作用，也可以调用它
    // if (elements.userInput) {
    //     resizeTextarea(elements);
    // }
}

// --- Start Application ---
document.addEventListener('DOMContentLoaded', init);

// 新增包装函数，用于从 main.js 中关闭弹窗并更新状态
function closeTabSelectionPopupUIFromMain() {
    if (state.isTabSelectionPopupOpen) { // 只有在弹窗确实打开时才操作
        uiCloseTabSelectionPopupUI(); // 调用从 ui.js 导入的函数来移除DOM
        state.isTabSelectionPopupOpen = false;
        console.log("Tab selection popup closed from main.js, state updated.");
    }
}

// New: Handle Escape priority for modals/popups before closing the panel
function handleGlobalEscapeForModals() {
    try {
        // 0) Agent delete confirm dialog (sidepanel built-in)
        const deleteConfirmOverlay = document.getElementById('delete-confirm-dialog');
        if (deleteConfirmOverlay && getComputedStyle(deleteConfirmOverlay).display !== 'none') {
            deleteConfirmOverlay.style.display = 'none';
            return true;
        }
        // 1) Tab selection popup inside chat
        const tabPopup = document.getElementById('tab-selection-popup');
        // 仅当弹窗实际可见时才拦截 ESC
        if (tabPopup && getComputedStyle(tabPopup).display !== 'none') {
            closeTabSelectionPopupUIFromMain();
            return true;
        }

        // 2) Custom provider modal
        const customProviderModal = document.getElementById('custom-provider-modal');
        if (customProviderModal && customProviderModal.classList.contains('show')) {
            customProviderModal.classList.remove('show');
            return true;
        }

        // 3) Model discovery dialog
        const modelDialog = document.querySelector('.model-discovery-dialog');
        if (modelDialog) {
            const closeBtn = modelDialog.querySelector('.close-btn');
            if (closeBtn) closeBtn.click(); else modelDialog.remove();
            return true;
        }

        // 4) Custom option edit dialog (Selection Helper Settings)
        const customOptionDialog = document.querySelector('.custom-option-dialog-overlay');
        if (customOptionDialog) {
            const closeBtn = customOptionDialog.querySelector('.custom-option-dialog-close');
            if (closeBtn) closeBtn.click(); else customOptionDialog.remove();
            return true;
        }

        // 5) Delete/Import conflict overlays in Selection Helper Settings
        const deleteDialog = document.getElementById('delete-custom-option-dialog');
        if (deleteDialog) {
            const cancelBtn = deleteDialog.querySelector('.dialog-cancel');
            if (cancelBtn) cancelBtn.click(); else deleteDialog.remove();
            return true;
        }
        const importConflictDialog = document.getElementById('import-conflict-dialog');
        if (importConflictDialog) {
            const cancelBtn = importConflictDialog.querySelector('.dialog-cancel');
            if (cancelBtn) cancelBtn.click(); else importConflictDialog.remove();
            return true;
        }

        // 6) Context preview modal
        if (isContextPreviewModalOpen()) {
            closeContextPreviewModal();
            return true;
        }

        // 7) Generic overlays created in settings (e.g., import/export confirms)
        // 仅处理“可见”的 overlay，避免隐藏的对话框常驻导致 ESC 失效
        const overlays = Array
            .from(document.querySelectorAll('body > .dialog-overlay'))
            .filter(ov => {
                const cs = getComputedStyle(ov);
                return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
            });
        if (overlays.length > 0) {
            const topOverlay = overlays[overlays.length - 1];
            // Try common cancel/close selectors across the project
            const cancelBtn = topOverlay.querySelector('.dialog-cancel, .cancel-btn, .close-btn');
            if (topOverlay.id === 'delete-confirm-dialog') {
                topOverlay.style.display = 'none';
            } else if (cancelBtn) {
                cancelBtn.click();
            } else {
                // Fallback: hide instead of removing to avoid breaking cached references
                topOverlay.style.display = 'none';
            }
            return true;
        }

        // 8) Image preview modal
        if (elements.imageModal && getComputedStyle(elements.imageModal).display !== 'none') {
            hideImageModal(elements);
            return true;
        }

        // 9) Mermaid preview modal
        if (elements.mermaidModal && getComputedStyle(elements.mermaidModal).display !== 'none') {
            activeMermaidOverviewMessageId = null;
            updateMermaidModalRegenerateButton();
            hideMermaidModal(elements);
            return true;
        }

        return false;
    } catch (err) {
        console.warn('[main.js] handleGlobalEscapeForModals error:', err);
        return false;
    }
}

// Ensure the delete-confirm dialog exists and has the expected structure
function ensureDeleteConfirmDialogStructure() {
    const existing = document.getElementById('delete-confirm-dialog');
    if (existing) return;
    // Build a minimal dialog compatible with our event wiring
    const overlay = document.createElement('div');
    overlay.id = 'delete-confirm-dialog';
    overlay.className = 'dialog-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = `
        <div class="dialog-content">
            <h3>${(window.I18n?.tr && window.I18n.tr('deleteConfirmHeading', {}, {})) || '确认删除'}</h3>
            <p>${(window.I18n?.tr && window.I18n.tr('deleteConfirmPrompt', { agentName: '<strong></strong>' }, {})) || '您确定要删除助手吗？此操作无法撤销。'}</p>
            <div class="dialog-actions">
                <button id="cancel-delete" class="cancel-btn">${(window.I18n?.tr && window.I18n.tr('cancel', {}, {})) || '取消'}</button>
                <button id="confirm-delete" class="delete-btn" style="background-color: var(--error-color); color: white;">${(window.I18n?.tr && window.I18n.tr('delete', {}, {})) || '删除'}</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
}

// 新增：移除选中的上下文标签页
function removeSelectedTabFromMain(tabId) {
    state.selectedContextTabs = state.selectedContextTabs.filter(tab => tab.id !== tabId);
    // 调用 ui.js 中的函数更新UI (确保此函数接受正确的参数)
    updateSelectedTabsBarUI(state.selectedContextTabs, elements, removeSelectedTabFromMain, currentTranslations);
    console.log(`Selected context tab ${tabId} removed. Remaining:`, state.selectedContextTabs.length);
}

// 新增：用于更新已选标签栏UI的回调函数
function updateSelectedTabsBarFromMain() {
    updateSelectedTabsBarUI(state.selectedContextTabs, elements, removeSelectedTabFromMain, currentTranslations);
}

// === 快捷操作相关函数 ===

/**
 * 设置快捷操作相关的全局函数
 */
function setupQuickActionsGlobals() {
    // 设置全局快捷操作管理器引用
    window.QuickActionsManager = QuickActionsManager;

    // 设置快捷操作触发函数
    window.triggerQuickAction = triggerQuickAction;

    console.log('[main.js] Quick actions globals set up');
}

/**
 * 触发快捷操作
 * @param {string} actionId - 快捷操作ID
 * @param {string} prompt - 快捷操作的提示词
 * @param {boolean} ignoreAssistant - 是否忽略助手设置
 */
async function triggerQuickAction(actionId, prompt, ignoreAssistant) {
    console.log(`[main.js] Triggering quick action: ${actionId}, ignoreAssistant: ${ignoreAssistant}`);

    if (!prompt || !prompt.trim()) {
        console.warn('[main.js] Quick action prompt is empty');
        return;
    }

    // 检查是否正在流式传输
    if (state.isStreaming) {
        console.warn('[main.js] Cannot trigger quick action while streaming');
        if (showToastUI) {
            showToastUI(_('streamingInProgress', {}, currentTranslations), 'warning');
        }
        return;
    }

    // 检查API连接
    let hasValidApiKey = false;
    if (window.ModelManager?.instance) {
        try {
            await window.ModelManager.instance.initialize();
            const modelConfig = window.ModelManager.instance.getModelApiConfig(state.model);
            const providerId = modelConfig.providerId;
            hasValidApiKey = window.ModelManager.instance.isProviderConfigured(providerId);
        } catch (error) {
            console.warn('[main.js] Failed to check provider configuration:', error);
        }
    }

    if (!hasValidApiKey) {
        if (showToastUI) {
            showToastUI(_('apiKeyMissingError', {}, currentTranslations), 'error');
        }
        return;
    }

    // 设置输入框内容
    elements.userInput.value = prompt.trim();
    elements.userInput.focus();

    // Update custom caret position after programmatic value change
    if (window.updateCometCaret) window.updateCometCaret();

    // 如果需要忽略助手，设置全局标记
    if (ignoreAssistant) {
        state.quickActionIgnoreAssistant = true;
        console.log('[main.js] Set quick action ignore assistant flag');
    }

    try {
        // 触发发送消息
        sendUserMessageTrigger();

        console.log(`[main.js] Quick action "${actionId}" executed successfully`);
    } catch (error) {
        console.error('[main.js] Error executing quick action:', error);
        if (showToastUI) {
            showToastUI(_('quickActionError', { error: error.message }, currentTranslations) || '快捷操作执行失败', 'error');
        }
    } finally {
        // 清除标记
        if (ignoreAssistant) {
            // 延迟清除标记，确保API调用已经完成
            setTimeout(() => {
                state.quickActionIgnoreAssistant = false;
                console.log('[main.js] Cleared quick action ignore assistant flag');
            }, 2000);
        }
    }
}

/**
 * 刷新欢迎消息中的快捷操作
 */
async function refreshWelcomeMessageQuickActions() {
    const welcomeMessage = elements.chatMessages.querySelector('.welcome-message');
    if (welcomeMessage) {
        // 确保快捷操作管理器可用
        if (!window.QuickActionsManager) {
            console.warn('[main.js] QuickActionsManager not available, skipping welcome message refresh');
            return;
        }

        const newWelcomeMessage = await createWelcomeMessage(currentTranslations);
        welcomeMessage.replaceWith(newWelcomeMessage);
        console.log('[main.js] Welcome message quick actions refreshed');
    }
}

// 导出刷新函数供设置界面使用
window.refreshWelcomeMessageQuickActions = refreshWelcomeMessageQuickActions;

// --- 统一导入导出功能 ---

/**
 * 处理统一导出功能
 * @param {function} showToastUI - Toast显示函数
 * @param {object} currentTranslations - 当前翻译对象
 */
async function handleUnifiedExport(showToastUI, currentTranslations) {
    try {
        console.log('[main.js] Starting unified export...');

        // 收集所有需要导出的数据
        const exportData = await collectAllSettingsData();

        // 生成文件名
        const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const filename = `pagetalk_all_settings_${timestamp}.json`;

        // 创建并下载文件
        const jsonString = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        const message = currentTranslations?.unifiedExportSuccess || '所有设置已导出';
        showToastUI(message, 'success');
        console.log('[main.js] Unified export completed successfully');

    } catch (error) {
        console.error('[main.js] Unified export failed:', error);
        const message = currentTranslations?.unifiedExportError || '导出设置时出错: {error}';
        showToastUI(message.replace('{error}', error.message), 'error');
    }
}

/**
 * 处理统一导入功能
 * @param {Event} event - 文件选择事件
 * @param {function} showToastUI - Toast显示函数
 * @param {object} currentTranslations - 当前翻译对象
 */
async function handleUnifiedImport(event, showToastUI, currentTranslations) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            console.log('[main.js] Starting unified import...');

            // 解析JSON数据
            const importData = JSON.parse(e.target.result);

            // 验证数据格式
            if (!validateImportData(importData)) {
                throw new Error('Invalid file format');
            }

            // 用户确认
            const confirmMessage = currentTranslations?.unifiedImportConfirm ||
                '这将覆盖您所有的当前设置，操作无法撤销。是否继续？';

            if (!window.confirm(confirmMessage)) {
                return;
            }

            // 执行导入
            await importAllSettingsData(importData);

            // 显示成功消息
            const successMessage = currentTranslations?.unifiedImportSuccess ||
                '设置导入成功！界面将自动刷新以应用新设置。';
            showToastUI(successMessage, 'success');

            // 延迟刷新界面
            setTimeout(() => {
                window.location.reload();
            }, 2000);

            console.log('[main.js] Unified import completed successfully');

        } catch (error) {
            console.error('[main.js] Unified import failed:', error);
            const message = currentTranslations?.unifiedImportError || '导入失败：{error}';
            showToastUI(message.replace('{error}', error.message), 'error');
        }
    };

    reader.readAsText(file);

    // 清空文件输入，允许重复选择同一文件
    event.target.value = '';
}

/**
 * 收集所有设置数据
 * @returns {Promise<Object>} 包含所有设置的对象
 */
async function collectAllSettingsData() {
    return new Promise((resolve) => {
        // 从sync存储获取数据
        chrome.storage.sync.get(null, (syncResult) => {
            if (chrome.runtime.lastError) {
                console.error('[main.js] Error reading from sync storage:', chrome.runtime.lastError);
                syncResult = {};
            }

            // 从local存储获取数据
            chrome.storage.local.get(null, (localResult) => {
                if (chrome.runtime.lastError) {
                    console.error('[main.js] Error reading from local storage:', chrome.runtime.lastError);
                    localResult = {};
                }

                // 优先从 local 获取模型数据，避免 sync 配额导致的不完整
                const managedModelsForExport = Array.isArray(localResult.managedModels) && localResult.managedModels.length > 0
                    ? localResult.managedModels
                    : (syncResult.managedModels || []);
                const userActiveModelsForExport = Array.isArray(localResult.userActiveModels) && localResult.userActiveModels.length > 0
                    ? localResult.userActiveModels
                    : (syncResult.userActiveModels || []);
                const localHasAgents = Array.isArray(localResult.agents) && localResult.agents.length > 0;
                const syncHasAgents = Array.isArray(syncResult.agents) && syncResult.agents.length > 0;
                const useLocalAgents = localHasAgents && (!syncHasAgents || Number(localResult.agentsUpdatedAt || 0) >= Number(syncResult.agentsUpdatedAt || 0));
                const agentsSourceForExport = useLocalAgents ? localResult : syncResult;
                const agentsForExport = agentsSourceForExport.agents || [];
                const currentAgentIdForExport = agentsSourceForExport.currentAgentId || null;
                const agentsUpdatedAtForExport = agentsSourceForExport.agentsUpdatedAt || null;

                // 构建导出数据结构
                const exportData = {
                    app: 'PageTalk',
                    version: '1.0',
                    exportDate: new Date().toISOString(),
                    settings: {
                        sync: {
                            // 助手配置
                            agents: agentsForExport,
                            currentAgentId: currentAgentIdForExport,
                            agentsUpdatedAt: agentsUpdatedAtForExport,
                            // 供应商设置（API Keys等）
                            providerSettings: syncResult.providerSettings || {},
                            // 模型管理器相关（与旧版保持兼容，依然放入 sync）
                            managedModels: managedModelsForExport,
                            userActiveModels: userActiveModelsForExport,
                            modelManagerVersion: syncResult.modelManagerVersion || null,
                            // 通用设置
                            language: syncResult.language || 'zh-CN',
                            proxyAddress: syncResult.proxyAddress || '',
                            model: syncResult.model || null,
                            followUpQuestionSettings: syncResult.followUpQuestionSettings || null,
                            // 自定义供应商
                            customProviders: syncResult.customProviders || []
                        },
                        local: {
                            // 划词助手设置
                            textSelectionHelperSettings: localResult.textSelectionHelperSettings || {},
                            textSelectionHelperSettingsVersion: localResult.textSelectionHelperSettingsVersion || null,
                            // 快捷操作
                            quickActions: localResult.quickActions || { actions: [] },
                            // 助手也保留一份 local 备份，避免 sync 配额导致导出不完整
                            agents: agentsForExport,
                            currentAgentId: currentAgentIdForExport,
                            agentsUpdatedAt: agentsUpdatedAtForExport,
                            // 也同时把模型数据放到 local，便于导入时直接写入
                            managedModels: managedModelsForExport,
                            userActiveModels: userActiveModelsForExport
                        }
                    }
                };

                console.log('[main.js] Collected settings data:', exportData);
                resolve(exportData);
            });
        });
    });
}

/**
 * 验证导入数据格式
 * @param {Object} importData - 导入的数据
 * @returns {boolean} 是否有效
 */
function validateImportData(importData) {
    // 检查基本结构
    if (!importData || typeof importData !== 'object') {
        return false;
    }

    // 检查必要字段
    if (!importData.settings || typeof importData.settings !== 'object') {
        return false;
    }

    // 检查sync和local字段
    if (!importData.settings.sync || typeof importData.settings.sync !== 'object') {
        return false;
    }

    if (!importData.settings.local || typeof importData.settings.local !== 'object') {
        return false;
    }

    console.log('[main.js] Import data validation passed');
    return true;
}

/**
 * 导入所有设置数据
 * @param {Object} importData - 导入的数据
 * @returns {Promise<void>}
 */
async function importAllSettingsData(importData) {
    return new Promise((resolve, reject) => {
        const syncSettingsToImport = { ...importData.settings.sync };
        delete syncSettingsToImport.botBoldHighlightColor;
        const localSettingsToImport = { ...importData.settings.local };
        if (Array.isArray(syncSettingsToImport.agents) && !Array.isArray(localSettingsToImport.agents)) {
            localSettingsToImport.agents = syncSettingsToImport.agents;
            localSettingsToImport.currentAgentId = syncSettingsToImport.currentAgentId || null;
        }

        // 导入sync数据
        chrome.storage.sync.set(syncSettingsToImport, () => {
            if (chrome.runtime.lastError) {
                console.error('[main.js] Error saving to sync storage:', chrome.runtime.lastError);
                reject(new Error('Failed to save sync settings'));
                return;
            }

            // 导入local数据
            chrome.storage.local.set(localSettingsToImport, () => {
                if (chrome.runtime.lastError) {
                    console.error('[main.js] Error saving to local storage:', chrome.runtime.lastError);
                    reject(new Error('Failed to save local settings'));
                    return;
                }

                console.log('[main.js] All settings imported successfully');
                resolve();
            });
        });
    });
}

// ========== 聊天记录保存与恢复功能 ==========

function cloneJsonSerializableValue(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function createSavedContextTabSnapshot(tab) {
    if (!tab || typeof tab !== 'object') return null;

    const snapshot = {};
    ['id', 'title', 'url', 'favIconUrl'].forEach(key => {
        if (tab[key] !== undefined && tab[key] !== null) {
            snapshot[key] = tab[key];
        }
    });
    return snapshot;
}

function createSavedChatMessageSnapshot(message) {
    if (!message || typeof message !== 'object') return message;

    const snapshot = {};
    Object.entries(message).forEach(([key, value]) => {
        if (key === 'sentContextTabsInfo') {
            const slimTabs = Array.isArray(value)
                ? value.map(createSavedContextTabSnapshot).filter(Boolean)
                : [];
            if (slimTabs.length > 0) {
                snapshot.sentContextTabsInfo = slimTabs;
            }
            return;
        }

        const clonedValue = cloneJsonSerializableValue(value);
        if (clonedValue !== undefined) {
            snapshot[key] = clonedValue;
        }
    });

    return snapshot;
}

function createSavedChatHistorySnapshot(chatHistory) {
    if (!Array.isArray(chatHistory)) return [];
    return chatHistory.map(createSavedChatMessageSnapshot);
}

/**
 * 保存当前对话到 chrome.storage.local
 */
async function saveChatSession(state, currentTranslations, showToastCallback) {
    if (!state.chatHistory || state.chatHistory.length === 0) {
        showToastCallback(_('saveSessionEmpty'), 'warning');
        return;
    }

    // 生成对话标题（优先使用页面标题，否则使用默认标题）
    let title = '';
    if (state.pageTitle) {
        // 使用页面标题，限制长度
        title = state.pageTitle.substring(0, 50);
        if (state.pageTitle.length > 50) title += '...';
    }

    // 如果没有页面标题，使用默认标题
    if (!title) {
        const now = new Date();
        const dateStr = now.toLocaleDateString();
        title = _('sessionTitleDefault', { date: dateStr });
    }

    const session = {
        id: generateUniqueId(),
        title: title,
        savedAt: Date.now(),
        chatHistory: createSavedChatHistorySnapshot(state.chatHistory),
        agentId: state.currentAgentId,
        model: state.model,
        selectedModels: state.selectedModels ? [...state.selectedModels] : []
    };

    try {
        // 获取现有的已保存对话
        const result = await chrome.storage.local.get('savedChatSessions');
        const sessions = result.savedChatSessions || [];

        // 添加新对话到列表开头
        sessions.unshift(session);

        // 保存到 storage
        await chrome.storage.local.set({ savedChatSessions: sessions });

        showToastCallback(_('saveSessionSuccess'), 'success');
        console.log('[SaveSession] Session saved:', session.id, session.title);
    } catch (error) {
        console.error('[SaveSession] Error saving session:', error);
        showToastCallback(_('error') + ': ' + error.message, 'error');
    }
}

/**
 * 加载已保存的对话列表
 */
async function loadSavedSessions() {
    try {
        const result = await chrome.storage.local.get('savedChatSessions');
        return result.savedChatSessions || [];
    } catch (error) {
        console.error('[LoadSessions] Error loading sessions:', error);
        return [];
    }
}

/**
 * 显示/隐藏已保存对话弹出层
 */
function toggleSavedSessionsPopup() {
    if (elements.savedSessionsPopup.style.display === 'none') {
        showSavedSessionsPopup();
    } else {
        hideSavedSessionsPopup();
    }
}

/**
 * 显示已保存对话弹出层
 */
async function showSavedSessionsPopup() {
    const sessions = await loadSavedSessions();
    renderSavedSessionsList(sessions);
    elements.savedSessionsPopup.style.display = 'flex';
}

/**
 * 隐藏已保存对话弹出层
 */
function hideSavedSessionsPopup() {
    elements.savedSessionsPopup.style.display = 'none';
}

/**
 * 提取已保存会话中的用户问题
 */
function extractUserQuestionsFromSession(session) {
    const userQuestions = [];

    if (!session?.chatHistory || !Array.isArray(session.chatHistory)) {
        return userQuestions;
    }

    session.chatHistory.forEach(msg => {
        if (msg.role !== 'user' || !Array.isArray(msg.parts)) {
            return;
        }

        const textPart = msg.parts.find(part => part?.text && part.text.trim());
        if (!textPart) {
            return;
        }

        const firstLine = textPart.text.trim().split('\n')[0].trim();
        if (firstLine) {
            userQuestions.push(firstLine);
        }
    });

    return userQuestions;
}

/**
 * 轻量标准化问题文本，用于主题归组
 */
function normalizeQuestionForTopicGrouping(text) {
    if (!text) return '';

    return text
        .replace(/\s+/g, ' ')
        .replace(/[？?。！!]+$/g, '')
        .trim();
}

/**
 * 计算两个问题序列的最长公共前缀长度
 */
function getCommonQuestionPrefixLength(questionsA, questionsB) {
    const maxLength = Math.min(questionsA.length, questionsB.length);
    let index = 0;

    while (index < maxLength) {
        if (questionsA[index] !== questionsB[index]) {
            break;
        }
        index += 1;
    }

    return index;
}

/**
 * 计算一组会话问题序列的全组公共前缀长度
 */
function getGroupCommonQuestionPrefixLength(normalizedQuestionLists) {
    if (!Array.isArray(normalizedQuestionLists) || normalizedQuestionLists.length === 0) {
        return 0;
    }

    return normalizedQuestionLists.slice(1).reduce((prefixLength, questions) => {
        const nextPrefixLength = getCommonQuestionPrefixLength(
            normalizedQuestionLists[0].slice(0, prefixLength),
            questions.slice(0, prefixLength)
        );
        return Math.min(prefixLength, nextPrefixLength);
    }, normalizedQuestionLists[0].length);
}

/**
 * 格式化已保存会话时间
 */
function formatSavedSessionDate(timestamp, includeTime = true) {
    const date = new Date(timestamp);
    const datePart = date.toLocaleDateString();

    if (!includeTime) {
        return datePart;
    }

    const timePart = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${datePart} ${timePart}`;
}

/**
 * 构建已保存会话主题组
 */
function buildSavedSessionTopicGroups(sessions) {
    const groupsByKey = new Map();

    sessions.forEach(session => {
        const userQuestions = extractUserQuestionsFromSession(session);
        const normalizedQuestions = userQuestions.map(normalizeQuestionForTopicGrouping);
        const hasTwoSharedQuestions = normalizedQuestions.length >= 2;
        const topicKey = hasTwoSharedQuestions
            ? `${normalizedQuestions[0]}\n@@\n${normalizedQuestions[1]}`
            : `session:${session.id}`;

        if (!groupsByKey.has(topicKey)) {
            groupsByKey.set(topicKey, {
                topicKey,
                sharedQuestions: hasTwoSharedQuestions
                    ? [userQuestions[0], userQuestions[1]]
                    : userQuestions.slice(0, 2),
                latestSavedAt: session.savedAt || 0,
                sessions: []
            });
        }

        const group = groupsByKey.get(topicKey);
        group.latestSavedAt = Math.max(group.latestSavedAt, session.savedAt || 0);

        const remainingQuestions = hasTwoSharedQuestions ? userQuestions.slice(2) : userQuestions.slice();

        group.sessions.push({
            session,
            userQuestions,
            normalizedQuestions,
            remainingQuestions,
            matchedPrefixLength: hasTwoSharedQuestions ? 2 : 0,
            onlySharedQuestions: hasTwoSharedQuestions && remainingQuestions.length === 0
        });
    });

    return Array.from(groupsByKey.values())
        .map(group => {
            if (group.sessions.length <= 1) {
                const singleSession = group.sessions[0];
                return {
                    ...group,
                    sharedQuestions: singleSession ? singleSession.userQuestions.slice(0, 2) : [],
                    sharedPrefixLength: 0,
                    sessions: group.sessions.sort((a, b) => (b.session.savedAt || 0) - (a.session.savedAt || 0))
                };
            }

            const normalizedQuestionLists = group.sessions.map(item => item.normalizedQuestions);
            const sharedPrefixLength = getGroupCommonQuestionPrefixLength(normalizedQuestionLists);
            const sharedQuestions = group.sessions[0].userQuestions.slice(0, sharedPrefixLength);

            const sessionsWithPrefix = group.sessions
                .map(item => {
                    const remainingQuestions = item.userQuestions.slice(sharedPrefixLength);

                    return {
                        ...item,
                        matchedPrefixLength: sharedPrefixLength,
                        remainingQuestions,
                        onlySharedQuestions: remainingQuestions.length === 0
                    };
                })
                .sort((a, b) => {
                    if ((b.session.savedAt || 0) !== (a.session.savedAt || 0)) {
                        return (b.session.savedAt || 0) - (a.session.savedAt || 0);
                    }
                    return b.matchedPrefixLength - a.matchedPrefixLength;
                });

            return {
                ...group,
                sharedQuestions,
                sharedPrefixLength,
                sessions: sessionsWithPrefix
            };
        })
        .sort((a, b) => {
            if (b.latestSavedAt !== a.latestSavedAt) {
                return b.latestSavedAt - a.latestSavedAt;
            }
            return b.sessions.length - a.sessions.length;
        });
}

/**
 * 创建第二层会话问题列表
 */
function createSavedSessionQuestionsElement(questions, { highlightFirst = false, placeholder = '' } = {}) {
    const questionsContainer = document.createElement('div');
    questionsContainer.className = 'saved-session-questions';

    if (placeholder) {
        const placeholderEl = document.createElement('div');
        placeholderEl.className = 'saved-session-question saved-session-question-placeholder';
        placeholderEl.textContent = placeholder;
        questionsContainer.appendChild(placeholderEl);
        return questionsContainer;
    }

    questions.forEach((question, index) => {
        const questionEl = document.createElement('div');
        questionEl.className = 'saved-session-question';
        if (highlightFirst && index === 0) {
            questionEl.classList.add('saved-session-question-highlight');
        }
        questionEl.title = question;
        questionEl.textContent = question;
        questionsContainer.appendChild(questionEl);
    });

    return questionsContainer;
}

/**
 * 创建主题块第一层预览问题
 */
function createTopicPreviewQuestion(question) {
    const previewEl = document.createElement('div');
    previewEl.className = 'saved-session-topic-preview-question';
    previewEl.title = question;
    previewEl.textContent = question;
    return previewEl;
}

/**
 * 创建主题块下的原始会话
 */
function createSavedSessionBranchItem(groupSession) {
    const { session, remainingQuestions, onlySharedQuestions } = groupSession;
    const branchItem = document.createElement('div');
    branchItem.className = 'saved-session-item saved-session-branch-item';
    branchItem.dataset.sessionId = session.id;

    branchItem.innerHTML = `
        <div class="saved-session-top-row">
            <div class="saved-session-info">
                <div class="saved-session-title" title="${escapeHtml(session.title)}">${escapeHtml(session.title)}</div>
                <div class="saved-session-date">${formatSavedSessionDate(session.savedAt)}</div>
            </div>
            <div class="saved-session-actions">
                <button class="session-action-btn delete-btn" data-session-id="${session.id}" title="${_('delete')}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                        <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                    </svg>
                </button>
            </div>
        </div>
    `;

    const questionsEl = onlySharedQuestions
        ? createSavedSessionQuestionsElement([], { placeholder: _('savedSessionsOnlySharedQuestions') })
        : createSavedSessionQuestionsElement(remainingQuestions, { highlightFirst: true });

    branchItem.appendChild(questionsEl);

    branchItem.addEventListener('click', (e) => {
        if (!e.target.closest('.session-action-btn')) {
            restoreChatSession(session.id);
        }
    });

    const deleteBtn = branchItem.querySelector('.delete-btn');
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSavedSession(session.id);
    });

    return branchItem;
}

/**
 * 创建单条已保存会话，保持改版前的平铺记录样式
 */
function createStandaloneSavedSessionItem(groupSession) {
    const { session, userQuestions } = groupSession;
    const item = document.createElement('div');
    item.className = 'saved-session-item';
    item.dataset.sessionId = session.id;

    item.innerHTML = `
        <div class="saved-session-top-row">
            <div class="saved-session-info">
                <div class="saved-session-title" title="${escapeHtml(session.title)}">${escapeHtml(session.title)}</div>
                <div class="saved-session-date">${formatSavedSessionDate(session.savedAt)}</div>
            </div>
            <div class="saved-session-actions">
                <button class="session-action-btn delete-btn" data-session-id="${session.id}" title="${_('delete')}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                        <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                    </svg>
                </button>
            </div>
        </div>
    `;

    if (userQuestions.length > 0) {
        item.appendChild(createSavedSessionQuestionsElement(userQuestions));
    }

    item.addEventListener('click', (e) => {
        if (!e.target.closest('.session-action-btn')) {
            restoreChatSession(session.id);
        }
    });

    const deleteBtn = item.querySelector('.delete-btn');
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSavedSession(session.id);
    });

    return item;
}

/**
 * 渲染已保存对话列表
 */
function renderSavedSessionsList(sessions) {
    const listContainer = elements.savedSessionsList;
    const emptyContainer = elements.savedSessionsEmpty;

    listContainer.innerHTML = '';

    if (!sessions || sessions.length === 0) {
        expandedSavedSessionTopicKey = null;
        listContainer.style.display = 'none';
        emptyContainer.style.display = 'block';
        return;
    }

    const topicGroups = buildSavedSessionTopicGroups(sessions);
    const hasExpandedGroup = topicGroups.some(group => group.topicKey === expandedSavedSessionTopicKey);
    if (!hasExpandedGroup) {
        expandedSavedSessionTopicKey = null;
    }

    listContainer.style.display = 'block';
    emptyContainer.style.display = 'none';

    topicGroups.forEach(group => {
    if (group.sessions.length === 1) {
            const standaloneItem = createStandaloneSavedSessionItem(group.sessions[0]);
            standaloneItem.classList.add('saved-session-standalone-item');
            listContainer.appendChild(standaloneItem);
            return;
        }

        const topicItem = document.createElement('div');
        const isExpanded = expandedSavedSessionTopicKey === group.topicKey;
        topicItem.className = `saved-session-topic${isExpanded ? ' expanded' : ''}`;
        topicItem.dataset.topicKey = group.topicKey;

        const topicHeader = document.createElement('button');
        topicHeader.type = 'button';
        topicHeader.className = 'saved-session-topic-header';
        topicHeader.innerHTML = `
            <span class="saved-session-topic-chevron" aria-hidden="true">${isExpanded ? '▾' : '▸'}</span>
            <div class="saved-session-topic-header-main">
                <div class="saved-session-topic-meta">
                    <span class="saved-session-topic-count">${_('savedSessionsRelatedCount', { count: group.sessions.length })}</span>
                    <span class="saved-session-topic-date">${formatSavedSessionDate(group.latestSavedAt, false)}</span>
                </div>
            </div>
        `;

        const previewContainer = document.createElement('div');
        previewContainer.className = 'saved-session-topic-preview';
        group.sharedQuestions.forEach(question => {
            previewContainer.appendChild(createTopicPreviewQuestion(question));
        });

        topicHeader.querySelector('.saved-session-topic-header-main').appendChild(previewContainer);

        topicHeader.addEventListener('click', (e) => {
            e.stopPropagation();
            expandedSavedSessionTopicKey = isExpanded ? null : group.topicKey;
            renderSavedSessionsList(sessions);
        });

        topicItem.appendChild(topicHeader);

        if (isExpanded) {
            const branchesContainer = document.createElement('div');
            branchesContainer.className = 'saved-session-topic-branches';

            group.sessions.forEach(groupSession => {
                branchesContainer.appendChild(createSavedSessionBranchItem(groupSession));
            });

            topicItem.appendChild(branchesContainer);
        }

        listContainer.appendChild(topicItem);
    });
}

/**
 * 恢复指定的对话
 */
async function restoreChatSession(sessionId) {
    // 如果当前有对话内容，询问是否覆盖
    if (state.chatHistory && state.chatHistory.length > 0) {
        if (!confirm(_('restoreSessionConfirm'))) {
            return;
        }
    }

    try {
        const sessions = await loadSavedSessions();
        const session = sessions.find(s => s.id === sessionId);

        if (!session) {
            console.error('[RestoreSession] Session not found:', sessionId);
            return;
        }

        // 清空当前聊天 UI
        elements.chatMessages.innerHTML = '';

        // 恢复状态
        state.chatHistory = session.chatHistory;
        state.locallyIgnoredTabs = {};
        clearFollowUpQuestions(state, elements);

        // 重建聊天 UI
        await renderChatHistoryFromSession(session);
        syncChatInputVisibility();

        // 隐藏弹出层
        hideSavedSessionsPopup();

        showToastUI(_('restoreSessionSuccess'), 'success');
        console.log('[RestoreSession] Session restored:', sessionId);
    } catch (error) {
        console.error('[RestoreSession] Error restoring session:', error);
        showToastUI(_('error') + ': ' + error.message, 'error');
    }
}

/**
 * 从保存的 session 数据重建聊天 UI
 */
async function renderChatHistoryFromSession(session) {
    resetBotMessageHeadingColors();

    for (const message of session.chatHistory) {
        if (message.role === 'user') {
            // 提取用户消息内容
            const { text, images, videos } = extractPartsFromMessageForRestore(message);
            const sentContextTabs = message.sentContextTabsInfo || [];

            // 渲染用户消息
            addMessageToChatUI(text, 'user', {
                id: message.id,
                images,
                videos,
                sentContextTabs
            });
        } else if (message.role === 'model') {
            // 检查是否是多模型响应
            if (message.multiModelResponses && Object.keys(message.multiModelResponses).length > 1) {
                // 渲染多模型响应容器
                renderMultiModelResponseFromHistory(message);
            } else {
                // 渲染单模型响应
                const text = message.parts?.[0]?.text || '';
                const botElement = addMessageToChatUI(text, 'bot', {
                    id: message.id
                });
                // 添加操作按钮
                if (botElement && window.addMessageActionButtons) {
                    window.addMessageActionButtons(botElement, text);
                }
            }
        }
    }
}

/**
 * 从历史记录渲染多模型响应
 */
function renderMultiModelResponseFromHistory(message) {
    const container = document.createElement('div');
    container.className = 'multi-model-response-container';
    container.dataset.messageId = message.id;

    const modelResponses = message.multiModelResponses;

    const orderedModelIds = message.modelOrder || Object.keys(modelResponses);
    for (const [modelIndex, modelId] of orderedModelIds.entries()) {
        const responseText = modelResponses[modelId];
        if (responseText === undefined) continue;
        const column = document.createElement('div');
        column.className = 'bot-message-column';
        column.dataset.modelId = modelId;

        // 模型名称标签
        const modelLabel = document.createElement('div');
        modelLabel.className = 'model-response-label';

        // 尝试获取模型信息
        const modelInfo = getModelInfoForRestore(modelId);
        if (modelInfo && modelInfo.iconFile) {
            const icon = document.createElement('img');
            icon.src = `../icons/${modelInfo.iconFile}`;
            icon.alt = modelInfo.providerName || '';
            icon.className = 'provider-icon-img';
            modelLabel.appendChild(icon);
        }

        const nameSpan = document.createElement('span');
        nameSpan.className = 'model-name';
        nameSpan.textContent = modelInfo?.displayName || modelId;
        nameSpan.title = modelInfo?.displayName || modelId;
        modelLabel.appendChild(nameSpan);

        column.appendChild(modelLabel);

        // 消息内容区域
        const messageContent = document.createElement('div');
        messageContent.className = 'bot-message';
        messageContent.dataset.modelId = modelId;
        messageContent.dataset.messageId = generateUniqueId();
        applyBotMessageHeadingColor(messageContent, modelIndex);

        // 渲染内容
        if (responseText) {
            const formattedContent = window.MarkdownRenderer.render(responseText);
            messageContent.innerHTML = formattedContent;
        }

        // 添加消息操作按钮
        if (window.addMessageActionButtons) {
            window.addMessageActionButtons(messageContent, responseText || '');
        }

        postProcessBotMessageContent(messageContent, addCopyButtonToCodeBlockUI, elements, messageContent.dataset.messageId);

        column.appendChild(messageContent);
        container.appendChild(column);
    }

    elements.chatMessages.appendChild(container);
}

/**
 * 获取模型信息（用于恢复时显示）
 */
function getModelInfoForRestore(modelValue) {
    const select = elements.chatModelSelection;
    if (!select) return null;

    const option = select.querySelector(`option[value="${modelValue}"]`);
    if (!option) return { displayName: modelValue, providerName: '', iconFile: null };

    const optgroup = option.parentElement;
    const providerName = optgroup && optgroup.tagName === 'OPTGROUP' ? optgroup.label : '';

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

    return {
        modelId: modelValue,
        displayName: option.textContent,
        providerName,
        iconFile: providerIconMap[providerName] || null
    };
}

/**
 * 从消息对象中提取文本、图片和视频（用于恢复）
 */
function extractPartsFromMessageForRestore(message) {
    let text = '';
    const images = [];
    const videos = [];

    if (message && message.parts && Array.isArray(message.parts)) {
        message.parts.forEach(part => {
            if (part.text) {
                text += (text ? '\n' : '') + part.text;
            } else if (part.inlineData && part.inlineData.data && part.inlineData.mimeType) {
                if (part.inlineData.mimeType.startsWith('image/')) {
                    images.push({
                        dataUrl: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
                        mimeType: part.inlineData.mimeType
                    });
                }
            } else if (part.fileData && part.fileData.fileUri) {
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
 * 删除已保存的对话
 */
async function deleteSavedSession(sessionId) {
    if (!confirm(_('deleteSessionConfirm'))) {
        return;
    }

    try {
        const sessions = await loadSavedSessions();
        const updatedSessions = sessions.filter(s => s.id !== sessionId);

        await chrome.storage.local.set({ savedChatSessions: updatedSessions });

        // 重新渲染列表
        renderSavedSessionsList(updatedSessions);

        showToastUI(_('deleteSessionSuccess'), 'success');
        console.log('[DeleteSession] Session deleted:', sessionId);
    } catch (error) {
        console.error('[DeleteSession] Error deleting session:', error);
        showToastUI(_('error') + ': ' + error.message, 'error');
    }
}

/**
 * HTML 转义辅助函数
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
