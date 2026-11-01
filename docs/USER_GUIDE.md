# AirloBot user guide

AirloBot 0.6 is a standalone Windows desktop preview. See the [README](../README.md#get-started) for installation.

## Local engine and models

AirloBot bundles and manages llama.cpp. LM Studio is not required. Source checkouts install the pinned Windows Vulkan/CPU engine explicitly with `npm run runtime:install`. Packages already include it; the app never downloads executable updates itself.

1. Open **Model library → Add local GGUF** and select a model.
2. Choose **Use model**. AirloBot starts its own engine and loads the file directly.
3. Confirm that **Local engine connected** is green.

GGUF files stay in their original location, including on another drive. During migration, AirloBot discovers compatible files in the standard `.lmstudio/models` folder and its own library once. This is local file discovery only: it never launches LM Studio or calls its API. Use Add local GGUF for files elsewhere or added later.

The existing Gemma 4 E4B model is a compatibility target. Other models require supported architectures/templates; agents also need reliable tool calling. Downloading a model does not guarantee compatibility or enough available memory.

**Settings → Privacy and local engine** offers context sizes from 4,096 to 65,536 tokens and Auto GPU / CPU acceleration. Default: 16,384 tokens. Project tools require at least 8,192. Higher values use more memory; the model's maximum also applies. Settings take effect at the next load/send. Unload releases memory; normal app shutdown stops the engine.

Engine reference: [llama.cpp server](https://github.com/ggml-org/llama.cpp/blob/b11960/tools/server/README.md). Build provenance and the archive checksum are pinned in `scripts/runtime-lock.json`.

## Project conversations

**Ask** has no file tools and hides the folder picker. **Work on project** binds a conversation to its folder. Follow-ups stay in that conversation. **New task** starts separate work. Choosing another folder starts new work; reopening an old conversation retains its original folder.

**Files** opens a local directory browser. Open subfolders, show more entries, preview text, and choose **Use this file in my request**. Pages contain up to 100 entries; there is no former four-level discovery cutoff. Excluded entries are counted. Unsupported documents produce an error instead of invented content.

The progress row describes the current action. **Read local files** lists actual reads. **Helpers** and **Activity** show tool outcomes. A response without file evidence or proposals is labeled as needing direction, not completed file work.

Helpers use the same local model, separate contexts, and read-only tools. Up to two run sequentially per submitted turn. Their suggestions cannot authorize writes or override user instructions. Models can still make mistakes; inspect the actual proposals.

Follow-ups include recent goals, results, change states, and file references. Up to six recent turns are shortened to fit the context budget; older history remains saved. Files must be read again before editing because prior evidence can become stale.

## Reviewed folders and document edits

Try: “Read README.md, create a docs folder, and write a summary in docs/overview.md.”

Open **Review changes**, inspect paths and before/after text, then choose **Apply change** or **Reject**. Apply folder proposals before dependent files. Approvals target the conversation's original folder even if the picker has since changed. Model tools never apply writes themselves.

Targeted edits replace one uniquely matching passage after it has been read. Unrelated text stays unchanged, and CRLF line endings are preserved. Entire replacements require reading the full current file; reading can span multiple pages. Proposals are rejected if the source changed after reading.

**Undo this change** restores the saved previous content, removes an unchanged newly created file, or removes only empty directories that operation created. Undo refuses to overwrite newer edits and never recursively deletes folders. Undo child changes before their folder. Deleting a conversation also removes its saved undo information; it never deletes project files.

Editing supports UTF-8 text, Markdown, and source/configuration files. Word, PDF, spreadsheets, images, and other binary documents require their native editor or a text export. AirloBot rejects attempts to create these formats as plain text.

## Limits and recovery

| Control | Default / limit | Behavior |
| --- | --- | --- |
| Chat response length | Unlimited (model context) | Removes the app output cap; context and memory still apply. |
| Project budget | 100 model turns / 60 minutes | Shared by main agent and helpers per submitted turn. Unlimited turns and No time limit are available. |
| Individual task request | 300 seconds / 4,096 output tokens | A stalled request times out. |
| Text file size | 1 MiB | Each read returns up to 200 lines / 6,000 raw characters. |
| New/replacement content | 24,000 characters | Use targeted edits for larger existing files. |
| Proposals | 20 per submitted turn | Every change requires review. |

Stop cancels parent and helper work. Six identical tool exchanges with unchanged results stop a loop. Empty replies receive at most two recovery requests. The latest 500 activity events per turn are kept; results and proposals remain saved.

**Continue saved work** submits a follow-up after a stop, failure, limit, or restart using saved findings. It does not restore an exact in-flight model execution or replay writes. Interrupted writes are marked uncertain for inspection.

Chat's **Continue response** appears when the engine reports a cutoff. Earlier turns may be omitted from a request's approximate context budget without deleting history. Unlimited output does not enlarge model context.

## Model downloads

Offline mode is on by default for new installations. Disable it explicitly to use **Find models**. Search by name or `publisher/repository`, choose a public, ungated, single-file GGUF, and follow progress in **Downloads**. Downloads pin a revision and verify size and SHA-256. Pause/resume retains partial bytes; verified files register directly with AirloBot.

Split GGUFs and vision projectors are disabled in the interface. This release supports text only. Downloaded models retain their own licenses.

## Privacy and storage

The launcher uses the checkout's `data` directory. Direct executable/npm launches use Electron's standard AirloBot user-data directory; use the launcher consistently to retain the same history.

| Location | Contents |
| --- | --- |
| `data/state.json` | Conversations, drafts, task turns, helper activity, source excerpts, before/after proposals, local model paths, settings. |
| `data/models/` | Downloads and partial model files. |
| `data/backups/` | Pre-migration backup when upgrading older state. |
| `data/electron-profile/` | Electron preferences and cache. |

Storage is readable local data, not encryption. Proposal contents provide undo records. Back up this folder before replacing builds. Deleting recent work does not erase separate backups or securely wipe disk sectors.

Only AirloBot's owned engine receives prompts and project content. It binds to `127.0.0.1` on a dynamic port and requires a random session key, kept out of renderer state and saved conversations. Redirects are rejected. Remote binding, native engine agent tools, its web UI, and request logging are disabled. Inherited environment variables cannot enable remote hosts or command tools.

The renderer blocks remote requests, navigation, and embedded remote images. There is no telemetry, account login, or cloud inference fallback. Offline mode blocks Hugging Face operations while local inference remains usable. When enabled, Hugging Face receives search terms and download requests, never conversation payloads. This setting is not an OS firewall for other applications.

Project tools stay within their folder and exclude sensitive paths, generated folders, symlinks, and junctions. This application boundary is not a complete OS sandbox against other processes changing files.

Runtime data, model weights, native binaries, logs, backups, and private captures are ignored by Git. Packages exclude user data and research artifacts. Publishing checks detect recognized private-data paths and credentials; they are not comprehensive personal-data detection. Product screenshots use synthetic fixtures only. See [media provenance](media/README.md).

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Engine missing | Run `npm run runtime:install` in source checkouts; packaged apps need their complete `resources/llama` folder. |
| Model cannot load | Confirm the GGUF exists. Try CPU or smaller context. Check architecture support. |
| Weak agent results | Use specific paths/instructions, inspect tool evidence, or select another tool-capable model. |
| Task reaches a limit | Increase project budgets and Continue saved work. |
| File not visible | Browse deeper or show another page; excluded paths stay restricted. |
| Proposal is stale | Ask for a fresh read and edit; newer work will not be overwritten silently. |
| New file has no parent | Apply the folder proposal first. |
| Undo refuses | Resolve newer edits or undo child files first. |
| Download did not register | Choose Add to library; check metadata and architecture. |
| Windows blocks a binary | Use your normal Windows/admin approval process; do not disable Windows protection. |

## Packaging and preferences

Run `npm run runtime:install`, then `npm run package`. Output: `release/standalone/AirloBot-win32-x64`, including engine licenses. Keep the entire folder together. Builds are unsigned, with no automatic updater. The existing launcher prefers `release/AirloBot-win32-x64`; deploy a reviewed build there or use source mode in a checkout without that installation.

Light, Dark, and Liquid Glass are under **Settings → Appearance** with motion/transparency controls. Glass is an independent CSS interpretation. **Ctrl+B** toggles the sidebar, **Ctrl+I** focuses the composer, **Enter** submits, and **Shift+Enter** inserts a line. Drafts are saved per conversation.

For contribution checks and protected-branch practices, see [Contributing](../CONTRIBUTING.txt).
