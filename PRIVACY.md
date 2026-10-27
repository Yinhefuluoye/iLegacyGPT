# Privacy

English | [简体中文](PRIVACY.zh-CN.md)

## 1. Scope

The application runs entirely on the device. It contains no server component, no account system and no analytics.

## 2. Data stored locally

| Data | Location | Retention |
| --- | --- | --- |
| API key, provider, base URL, port, model, font size, reasoning level, search settings | `Library/Application Support/ChatAI/config` | until the application is deleted |
| Sessions and messages, including 320 px image thumbnails | `Library/Application Support/ChatAI/store.json` | history is capped per session |
| Diagnostic log | log file in the application sandbox | until deleted by the user |

## 3. Network requests

3.1 A request is issued only when the user submits a message.

3.2 The destination is the endpoint configured by the user in Settings.

3.3 A request contains the message text, the conversation history, and the attached image when present. Images are downscaled so that the long side does not exceed 1568 px.

3.4 When web search is enabled, the search API configured by the user is called with the generated query.

3.5 The project provides no proxy, relay or intermediary; requests are not routed through any infrastructure operated by the project.

## 4. Third parties

The operator of the configured endpoint, and the operator of the configured search API, may retain request data under their own policies. That processing is outside the control of this project.

## 5. Changes

This document is versioned with the repository; changes are visible in its history.