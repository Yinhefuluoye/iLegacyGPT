# Documentation style

Applies to every Markdown file in this repository.

## Voice

- English is the primary language; `X.md` is English and `X.zh-CN.md` is the Chinese mirror.
- Both versions must have the same heading structure and the same number of list items and table rows.
- State facts. Do not narrate the process of discovering them, and do not describe what was tried or rejected.
- Use third person. First person (`I`, `we`, `我的`, `我们`) is not allowed.
- No metaphors, jokes, exclamation marks or self-assessment ("surprisingly", "顺便", "其实").

## Document types

| File | Audience | Form |
| --- | --- | --- |
| `README.md` | first-time visitor | description, tables, commands, one-line feature list |
| `docs/*.md` | developer | normative reference: channels, fields, constraints |
| `docs/release-notes/*.md` | user upgrading | `Added` / `Changed` / `Fixed` / `Known issues` only |
| `PRIVACY.md`, `SECURITY.md` | user | numbered clauses, declarative sentences |

## Formatting

- One sentence per line is not required; keep paragraphs short.
- Tables over prose for enumerable facts.
- Verification status belongs in a table cell (`Tested`, `Untested`, `Not supported`), never in body text.
- Do not hard-code the current version in prose; the release badge resolves it.
- Emoji are not used, including in status tables.
- Historically relevant details belong in commit messages, not in documents.

## Checks

`node tools/doc_lint.mjs` verifies the rules above and reports violations.