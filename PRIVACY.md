# Privacy

English | [简体中文](PRIVACY.zh-CN.md)

In one sentence: **this app collects nothing and has no server of its own.**

## What is stored, and where

| Data | Location | Notes |
| --- | --- | --- |
| API key, provider, base URL, port, model name, font size, reasoning level | app sandbox `Library/Application Support/ChatAI/config` | device only, removed when the app is deleted |
| Sessions and messages (including 320 px image thumbnails) | app sandbox `Library/Application Support/ChatAI/store.json` | device only; history is capped at the latest 120 entries per session and 200 messages |
| Debug log | a log file inside the app sandbox | device only, used for troubleshooting |

## Requests it makes

- A request is sent **only when you press send**, and only to the endpoint **you configured**;
- Request content: the text you typed, the image you attached (downscaled so the long side is at most 1568 px), and the conversation history;
- Destination: the base URL and port you entered. The author of this project is not involved and cannot see those requests.

## What it does not do

- no account, no login;
- no telemetry, no analytics, no crash reporting;
- no access to contacts, location or the clipboard;
- no upload to any third-party server, other than the endpoint you configured yourself.

## Keep in mind

The provider you configure may log your requests according to its own privacy policy; that is outside this project. Do not send sensitive data through a gateway you do not trust.