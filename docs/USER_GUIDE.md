# AirloBot user guide

AirloBot 0.5 is a Windows desktop preview for local text models, project investigation, and reviewed file changes. Start with the [README](../README.md#get-started) for installation.

## Local engine and model setup

AirloBot requires a working LM Studio installation and the `lms` CLI. On Windows it looks for the CLI in the standard `.lmstudio/bin` directory under your user profile. The server address is fixed to `http://127.0.0.1:1234`; remote inference endpoints and cloud API keys are not supported.

1. Install a text model supported by your LM Studio runtime.
2. Open **Model library**. Use **Start engine** if the server is offline, or start the server from LM Studio's Developer tab.
3. Choose **Use model** on an installed model. You can also select one through the model control beneath the composer.
4. Confirm that **Local engine connected** is green. A running server without the selected model loaded is shown in red.

The initial default model identifier refers to the Gemma model used during development. You do not need that exact model: select your own installed model in the library. Project tasks require reliable tool calling, and results depend on the model. The development smoke test used `gemma-4-e4b-uncensored-hauhaucs-aggressive`; this is a compatibility result, not a recommendation for every use case.

Loading an unloaded model requests up to 8,192 context tokens, or the model's lower maximum. An already loaded model keeps its runtime configuration. **Unload from memory** releases a model; closing AirloBot leaves the shared local engine running.

Official references: [LM Studio server](https://lmstudio.ai/docs/developer/core/server), [chat-completions compatibility](https://lmstudio.ai/docs/developer/openai-compat/chat-completions).

## Ask and project work

**Ask** is a conversation without file tools. The folder picker is hidden. **Work on project** uses the folder you select at the top of the workspace. Switching modes preserves each draft and does not submit it.

The main agent can list files, read UTF-8 text, search literal text, create researcher/reviewer helpers, and propose small files. Helpers use the same loaded model with separate contexts. They run one at a time, can only read, and cannot create more helpers.

Open **Helpers** to inspect findings or the compact activity row to inspect tool activity. If a proposal is available, **Review changes** opens a side panel or, on smaller windows, a drawer. The changed section is a preview; expand **Review full before and after** for the complete file. A shortened preview is labeled.

**Apply this file** writes only the approved file. AirloBot rejects stale proposals if the file has changed since it was read. **Reject** leaves the file untouched. Historical proposals require selecting the original project folder again.

## Work budgets and longer replies

| Control | Default | Options and behavior |
| --- | --- | --- |
| Chat response length | Unlimited (model context) | Remove the app token cap or choose a fixed cap up to 32,768 tokens. |
| Task work budget | 100 model turns | Shared by the main agent and helpers. Tool actions do not consume additional model turns. Unlimited is available. |
| Task time limit | 60 minutes | Independent of the turn budget. No time limit is available. |
| Individual task request | 120 seconds | A stalled request times out. |
| Task reply capacity | 4,096 tokens per request | Model context and runtime limits still apply. |

Task settings apply to new tasks; a running task keeps its starting budget. Stop cancels parent and helper work. Six consecutive identical tool exchanges with unchanged results stop a stuck agent, including in Unlimited mode. The most recent 500 activity events are retained, with an omitted-event count; results and proposals remain saved.

For chat, **Continue response** appears when the runtime reports a token/context cutoff. It sends a follow-up only when clicked. Older complete turns may be omitted to fit the 24,000-character request budget, including assistant instructions; the reply reports omissions without deleting saved history. This is an approximate character budget, not a tokenizer. Reasoning may consume output tokens even when the request asks to disable it.

An unfinished task is marked interrupted after restart. **Use this goal** starts a fresh attempt; it does not resume an old execution or replay writes. A write interrupted at an uncertain point is marked for manual inspection.

## File-tool scope

The current tools suit investigation and small changes:

- At most two helpers and five file proposals per task.
- UTF-8 files up to 64 KiB for reading; each read returns at most 120 lines or 6,000 characters.
- Replacing an existing file requires a complete current read; existing replacement files are limited to 6,000 characters.
- Proposed content is limited to 12,000 characters. New files require an existing parent directory.
- Discovery covers up to 200 entries and four directory levels. Use a narrower directory when results are truncated.
- Generated folders, sensitive filename patterns, model weights, symlinks, and junctions are excluded.

There is no terminal, command execution, test runner, autonomous write, browser tool, scheduled job, or nested helper delegation. The project boundary is an application-level restriction, not an operating-system sandbox against other processes modifying the filesystem.

## Model library

Open **Model library → Find models** and search by name or enter `publisher/repository`. Choose a suitable single-file GGUF and select **Download**. Downloads use a pinned revision and check size and SHA-256 before import. Follow progress in **Downloads**, where pause/resume retains partial data.

After import, open **Installed**, refresh if needed, and choose **Use model**. Downloading a GGUF does not guarantee that your runtime supports its architecture or that it fits available memory. Repository licenses are shown; the model's license governs its use.

This preview supports public, ungated, single-file GGUF downloads. Split files are disabled. Vision projectors can be saved separately, but this release is text-only and does not automatically register multimodal models.

**Add local GGUF** and verified downloads use LM Studio hard-link imports. The source and runtime library must be on the same drive. If import fails, the verified file remains available and **Add to runtime** retries the import without silently copying multiple gigabytes.

## Privacy and storage

Using **Start AirloBot.cmd** stores local state under the checkout's `data` directory:

| Location | Contents |
| --- | --- |
| `data/state.json` | Chats, drafts, tasks, helper activity, source excerpts, file proposals, and preferences. |
| `data/models/` | Downloaded model files and partial downloads. |
| `data/electron-profile/` | Electron/Chromium preferences and cache. |

These files are readable local data, not encrypted storage. Back up the data folder before replacing an application build. Running `npm start` or the executable directly uses Electron's standard AirloBot user-data location instead; use the launcher consistently to retain the same history.

Inference requests go only to the fixed loopback server, with redirects rejected. Hugging Face receives model searches and downloads, never conversation payloads from AirloBot. Download redirects are restricted to HTTPS Hugging Face/CDN hosts. The renderer blocks remote connections, navigation, and embedded remote images. AirloBot has no telemetry or cloud model fallback.

**Offline mode** blocks AirloBot's Hugging Face operations. It is not an OS firewall and does not change LM Studio's separate networking or updater behavior.

Runtime data, models, logs, backups, and private captures are ignored by Git and excluded from Windows packages. Repository publishing checks look for known sensitive paths, personal home paths, tokens, and private keys; they are not comprehensive personal-data detection. The README images are the only deliberate product captures: they use fixed synthetic fixtures, not the user's data. See [media provenance](media/README.md).

## History, drafts, and appearance

Each recent task/chat has a trash control and confirmation. Deleting a task removes its saved record, draft, activity, and proposals. Project files—including changes already applied—stay intact. Running work cannot be deleted until stopped. This does not erase separate backups or securely wipe disk sectors.

Drafts are saved per work item. **Ctrl+B** toggles the sidebar, **Ctrl+I** focuses the composer, **Enter** submits, and **Shift+Enter** adds a line. A failed first send keeps its draft.

Choose **Light**, **Dark**, or **Liquid Glass** in **Settings → Appearance**. Glass diffusion, reduced transparency, and reduced motion save automatically. System accessibility preferences are respected. Liquid Glass is an independent CSS interpretation, not Apple's native macOS material.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Engine offline | Start LM Studio's local server on port 1234. Confirm the CLI is installed in its standard location. |
| No model connected | Open Installed and choose Use model; a running server alone is not enough. |
| Tool calls fail or are malformed | Use a compatible tool-capable local model, or make the goal more specific. |
| Task reaches a work/time limit | Adjust Project tasks in Settings, then use the goal for a fresh run. |
| Reply hits a context limit | Shorten the prompt/instructions or start a fresh conversation. Unlimited does not enlarge the model's context. |
| A proposed change will not apply | Re-select its original project and check whether the file changed. Generate a fresh proposal rather than overwriting newer edits. |
| Download verified but import failed | Confirm both locations are on the same drive, then choose Add to runtime. |
| Model hash mismatch | The unverified file is not imported. Remove only the affected `.part` file from the model library, then Resume. |
| Electron binary missing after installing dependencies | Run `npx --no-install install-electron`, then rebuild. See [Electron installation](https://www.electronjs.org/docs/latest/tutorial/installation). |
| Windows blocks the executable | Use your normal organization/admin approval process. Do not disable Windows protection to run it. |

## Build a Windows package

```powershell
npm run package
```

The output is `release/AirloBot-win32-x64`. Keep that entire folder together. Packaging does not overwrite an existing release; close it and archive the old build first. Retain the separate `data` folder and use the launcher for the same history. Builds are unsigned and do not include a signed installer or auto-update mechanism.

For development checks and contribution workflow, see [Contributing](../CONTRIBUTING.txt).
