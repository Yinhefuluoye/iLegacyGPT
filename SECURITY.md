# Security

English | [简体中文](SECURITY.zh-CN.md)

## Reporting

- Ordinary bugs and feature requests: open an [issue](../../issues);
- Security problems (a leaked key, arbitrary code execution, sandbox escape, …): please **do not** open a public issue. Use GitHub's private vulnerability report (Security → Report a vulnerability), or contact the author directly first.

## Please keep these out of public threads

- your **API key**, `Authorization` headers, or a full base URL that carries a token;
- screenshots of conversations that contain personal data;
- device serial numbers or anything tied to your Apple ID.

If you must attach a log to an issue, redact the key, the host name and the message content first.

## Known security boundaries

- the API key is stored **in plain text** inside the app sandbox (`Library/Application Support/ChatAI/`), with no extra encryption. That is the trade-off of a local single-user tool: on a jailbroken device any process running as root can read it;
- the IPA is **unsigned**; installing it relies on AppSync or re-signing. Download it only from this repository's Releases, never from an unknown "repackaged" build;
- this project ships no proxy and forwards nothing — your traffic goes straight to the endpoint you configured.