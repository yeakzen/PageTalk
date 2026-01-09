# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PageTalk is a Chrome Extension (Manifest V3) that provides AI-powered Q&A assistance for web pages. It supports multiple AI providers (Google Gemini, OpenAI, Anthropic Claude, DeepSeek, OpenRouter, SiliconFlow, etc.) and features text selection helpers, PDF parsing, multi-tab context, and rich content rendering.

## Development Setup

No build process required. This is a vanilla JavaScript project.

### Loading the Extension
1. Go to `chrome://extensions/` (Chrome) or `edge://extensions/` (Edge)
2. Enable "Developer mode"
3. Click "Load unpacked" and select the project folder

### Key Shortcut
- `Alt+P`: Open/close the PageTalk panel

## Architecture

### Entry Points

- **`js/background.js`**: Service worker - handles extension icon clicks, context menus, proxy settings, and message routing between content scripts and sidepanel
- **`js/content.js`**: Content script injected into all pages - creates the sidepanel iframe, extracts page content using Readability.js, handles PDF parsing
- **`js/main.js`**: Main sidepanel coordinator - manages global state, imports all modules, wires up event handlers and callbacks

### Core Modules

| Module | Purpose |
|--------|---------|
| `js/chat.js` | Chat logic: `sendUserMessage()`, `regenerateMessage()`, multi-model parallel calls |
| `js/ui.js` | DOM manipulation, message rendering, thinking animations, toast notifications |
| `js/api.js` | Unified API layer with adapter pattern, retry logic, streaming response handling |
| `js/modelManager.js` | Model definitions, user custom models, storage management |
| `js/providerManager.js` | Provider configurations (API hosts, types, icons) |
| `js/agent.js` | AI agent CRUD, system prompts, import/export |
| `js/settings.js` | Settings UI, language/theme/proxy configuration |
| `js/render.js` | Dynamic content rendering (KaTeX math, Mermaid diagrams) |
| `js/markdown-renderer.js` | Markdown-it based renderer with code highlighting |

### Provider Adapter Pattern

Located in `js/providers/adapters/`:
- `geminiAdapter.js` - Google Gemini API format
- `openaiAdapter.js` - OpenAI-compatible APIs (covers most providers)
- `anthropicAdapter.js` - Anthropic Claude API format

The `api.js` module selects the appropriate adapter based on provider type defined in `providerManager.js`.

### CSS Structure

`css/sidepanel.css` imports modular stylesheets:
- `_variables.css` - CSS custom properties
- `_base.css` - Global layout and components
- `_chat.css` - Message bubbles, thinking animations, input area
- `_settings.css` - Settings panel styles
- `_dark-mode.css` - Dark theme overrides
- `_markdown.css` - Rendered markdown content
- `_responsive.css` - Media queries

### State Management

Global state object in `js/main.js` includes:
- `chatHistory[]` - Conversation messages
- `selectedModels[]` - Multi-model selection for parallel calls
- `selectedContextTabs[]` - Tabs selected via @ mention for context
- `agents[]` - Custom AI agent configurations
- `isStreaming` - API call state flag

### i18n System

- `js/translations.js` - Translation dictionaries (zh-CN, en)
- `js/utils/i18n.js` - `tr(key, replacements, translations)` function
- Use `data-i18n` attributes in HTML for static text

### Key Patterns

**Callback-based UI updates**: Chat functions receive callbacks like `addMessageToChatCallback`, `restoreSendButtonAndInputCallback` to update UI from the coordinator in `main.js`.

**Multi-model parallel calls**: `sendMultiModelMessage()` and `regenerateMultiModelMessage()` in `chat.js` use `Promise.allSettled()` to call multiple models simultaneously with independent streaming updates.

**Streaming responses**: API module calls `updateStreamingMessage()` during streaming, then `finalizeBotMessage()` on completion. The `restoreSendButtonAndInput` callback must be called on both success and error to reset UI state.

## External Libraries (in `js/lib/`)

- Readability.js - Page content extraction
- markdown-it - Markdown parsing
- highlight.js - Code syntax highlighting
- KaTeX - LaTeX math rendering
- Mermaid - Diagram rendering
- Turndown - HTML to Markdown conversion
- PDF.js - PDF parsing
