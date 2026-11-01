CROCBOT 0.1
An independent local desktop assistant, built from the architectural research
in the parent grokbotclone folder. No original Grok Bot application code/assets
or production services are used by this implementation.

OPEN THE APP

Double-click "Start CrocBot.cmd" in this folder. It starts the packaged app and
keeps your data in this project's data folder. The first development session
may already be running; close it before launching the packaged version.

Launcher:
<project folder>\Start CrocBot.cmd

Packaged Windows executable:
<project folder>\release\CrocBot-win32-x64\CrocBot.exe

Keep the entire CrocBot-win32-x64 folder together. The executable depends on the
other files beside it. Use the launcher above to share the data from this first
session. Running the executable directly uses Electron's standard CrocBot user
data directory instead. This build is unsigned and has no installer/updater yet.

YOUR LOCAL MODEL

Configured model: gemma-4-e4b-uncensored-hauhaucs-aggressive
Original model directory:
%USERPROFILE%\.lmstudio\models\HauhauCS\Gemma-4-E4B-Uncensored-HauhauCS-Aggressive

The Q4_K_M GGUF is approximately 5.34 GB. Its existing vision projector is also
present, but this CrocBot release provides text chat only. No model weights were
copied into the application package. CrocBot uses the installed LM Studio local
runtime and lms CLI, with inference restricted in code to http://127.0.0.1:1234.
No cloud model provider, cloud fallback, remote inference URL, or AI API key is
configured. An OpenAI-compatible API format is used on that LOCAL endpoint; it
does not call OpenAI. The model's own reasoning behavior may use part of the
response token budget and is displayed in a collapsible section.

If the engine is stopped, click Start local engine in Model library or Settings.
Choose Use model to load an installed model. Loading defaults to an 8192-token
context (or the model's lower maximum). The shared engine remains running when
CrocBot closes; use Unload from memory to release a selected model's memory.

AVAILABLE NOW

- Streaming local chat, Markdown answers, cancellation, and local history.
- Installed model discovery, selection, loading and unloading.
- Hugging Face repository search and GGUF file selection with size/license info.
- Download progress, pause/resume, pinned revisions, size and SHA-256 checks.
- Downloads stored under data/models/publisher/repository.
- Verified model files imported into LM Studio using hard links, so the runtime
  can discover them without duplicating their disk usage on the same drive.
- Add local GGUF through the native file picker; this also creates a hard link.
- Offline mode blocks Hugging Face operations while local chat continues.
- Temperature, response-token limit and assistant instructions.
- A dedicated CrocBot name, geometric icon, and green desktop interface.

MODEL LIBRARY WORKFLOW

1. Open Model library > Hugging Face.
2. Search by model name, or enter publisher/repository to open it directly.
3. Choose one suitable single-file GGUF quantization and click Download.
4. Follow progress in Downloads. Pause and Resume retain partial data.
5. After SHA-256 verification and runtime import, open Installed, refresh if
   necessary, and click Use model. Use Chat when the selected model is ready.

This first version supports PUBLIC, UNGATED, SINGLE-FILE GGUF models. Split GGUFs
are identified and disabled. A GGUF download is not a guarantee that the local
engine supports its architecture. Vision projectors can be saved separately but
are not automatically registered as multimodal models in this text-only release.

If a runtime import fails, the verified file stays in CrocBot's library and the
download row offers Add to runtime. Hard-link imports require the two locations
to be on the same drive. Filesystem/engine errors are shown rather than silently
copying multiple gigabytes. For a hash mismatch, delete only the affected .part
file in data/models, then Resume; the unverified file is never imported.

PRIVACY AND STORAGE

Conversation payloads are sent only to the fixed loopback inference endpoint.
Hugging Face receives model searches and file-download requests, never chat
history. Downloads may follow HTTPS redirects to huggingface.co or hf.co CDN
subdomains. The renderer blocks remote connections, external navigation and
embedded remote images. It has no Node integration and uses a narrow preload
bridge, context isolation, sandboxing and sender validation.

CrocBot itself has no telemetry, cloud inference code or account login. The
installed LM Studio/Bionic runtime is a separate application; its own updater,
model management and settings are not controlled by CrocBot. Offline mode is
an application-level network restriction for CrocBot's model-library features,
not an operating-system firewall or a change to other applications.

data/state.json contains local conversation history and preferences in readable
JSON. It is not encrypted. data/electron-profile contains Chromium preferences
and cache. This data is excluded from the Windows package. Keep the data folder
when updating the application if you want to retain your conversations.

VALIDATION

npm test: 8 passing tests covering local-only request routing, Hub redirects,
path confinement, split UTF-8 streaming, offline mode, persistence, cancellation,
duplicate sends, resumed downloads, and rejection of corrupted model data.

scripts/live-test.mjs: Real inference on the requested Gemma model with offline
mode enabled; actual Hugging Face search; a 1,185,376-byte public GGUF download
with SHA-256 verification; conversation restoration after restart. Results in
test-results/live-report.json. The small test model is retained only inside
test-results and is not the selected chat model.

scripts/import-smoke.mjs: Actual LM Studio hard-link import and discovery, followed
by removal of only the newly created test link. The verified source is retained.
Results in test-results/import-report.json.

The desktop interface was opened and a real test prompt was submitted through
its chat controls. Gemma produced a completed response in approximately 4.9 s.
This is a functional smoke test, not a comprehensive security/performance audit.

DEVELOPMENT

Requires Node >=22.12 and the existing LM Studio runtime/lms installation.
  npm install
  npx install-electron
  npm run build
  npm start
  npm test
  npm run test:live
  npm run package

The package command creates release/CrocBot-win32-x64. It does not overwrite an
existing release. Close that app and archive the previous build before packaging
an update. For this workstation, Node 22.23.4 also exists under the parent REA
.tools folder. npm install requires internet; installed-model inference does not.

SOURCE MAP

electron/core.mjs       Local engine, stream handling, storage, model downloads.
electron/main.cjs       Window, local asset protocol, IPC validation, file picker.
electron/preload.cjs    Explicit renderer capabilities.
src/main.jsx           Conversation, library and settings UI.
src/style.css          Original CrocBot visual design.
test/core.test.mjs     Meaningful service and download tests.
scripts/               Live tests and repeatable icon generation.
assets/                Original CrocBot application icons.

NEXT DEVELOPMENT TARGETS

This is a working first slice, not full Grok Bot feature parity. Suggested next
work: durable per-conversation drafts, text/file attachments, context management,
more download recovery controls, and carefully permissioned local tools. There
are currently no autonomous tools, terminal execution, connectors, voice, image
inputs, scheduled jobs or account/team services in CrocBot.

REFERENCE DOCUMENTATION CONSULTED

LM Studio local server: https://lmstudio.ai/docs/developer/core/server
Model listing/loading: https://lmstudio.ai/docs/developer/rest/list
https://lmstudio.ai/docs/developer/rest/load
Chat compatibility: https://lmstudio.ai/docs/developer/openai-compat/chat-completions
Hugging Face Hub API: https://huggingface.co/docs/hub/api
File downloads: https://huggingface.co/docs/huggingface_hub/package_reference/file_download
Electron security: https://www.electronjs.org/docs/latest/tutorial/security
