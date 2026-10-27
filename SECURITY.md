# Security

English | [简体中文](SECURITY.zh-CN.md)

## 1. Reporting

1.1 Functional defects and feature requests: open an issue in the repository.

1.2 Security defects, including key disclosure, arbitrary code execution and sandbox escape: use the private vulnerability report under Security in the repository, or contact the maintainer directly. Do not open a public issue for these.

## 2. Information handling

2.1 Do not publish API keys, `Authorization` headers, or base URLs that contain a token.

2.2 Do not publish conversation screenshots that contain personal data.

2.3 Do not publish device serial numbers or Apple ID details.

2.4 When a log is required for a report, redact the key, the host name and the message content before attaching it.

## 3. Known boundaries

3.1 The API key is stored unencrypted inside the application sandbox at `Library/Application Support/ChatAI/`. On a jailbroken device, any process with root privileges can read it.

3.2 The IPA is unsigned. Installation requires AppSync Unified or a signing tool. Releases published by this repository are the only supported distribution; builds obtained elsewhere are unverified.

3.3 The application performs no request forwarding and operates no proxy.

## 4. Supported versions

Security fixes are applied to the latest release only. Older releases do not receive backports.