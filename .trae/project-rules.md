## Project Rules

- When the user asks to submit or push to GitHub, include all current local changes by default (tracked and untracked), including local diagnostic/helper files, unless the user explicitly excludes specific files.
- This rule supersedes the previous local-only convention for `.trae/` and diagnostic helper scripts.
- Treat WeChat Channels support as a protected stable path. Changes for other platforms must not alter its capture, target matching, `decodeKey` decryption, or download behavior unless the user explicitly requests it or a confirmed WeChat bug requires it. Shared-infrastructure changes require WeChat regression verification.
