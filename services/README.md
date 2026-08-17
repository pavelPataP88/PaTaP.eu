# Services

`services/` contains shared platform services.

Services are not modules. They provide capabilities used by modules through stable interfaces.

Current service areas:

- `ai/`
- `filesystem/`
- `logging/`
- `notifications/`
- `sync/`
- `updates/`

AI is a service, not a module. Future AI providers can include ChatGPT, Codex, DeepSeek, and Kimi without making any provider a business module.
