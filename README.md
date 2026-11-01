<p align="center">
  <img src="assets/airlobot.png" alt="AirloBot robot" width="88" height="88">
</p>

<h1 align="center">AirloBot</h1>

<p align="center"><strong>An agent workspace powered by your local models.</strong></p>

<p align="center">
  Windows desktop · Local inference · Version 0.5 preview
</p>

<p align="center">
  <a href="#get-started">Get started</a> ·
  <a href="#see-it-in-action">See it in action</a> ·
  <a href="#privacy-and-control">Privacy</a> ·
  <a href="docs/USER_GUIDE.md">User guide</a>
</p>

<p align="center">
  <a href="https://github.com/BovineDawn/AirloBot/actions/workflows/ci.yml"><img src="https://github.com/BovineDawn/AirloBot/actions/workflows/ci.yml/badge.svg?branch=main" alt="Windows and Linux checks"></a>
</p>

![AirloBot in Liquid Glass, showing a completed project review and a change ready for approval](docs/media/workspace-glass.png)

<p align="center"><sub>Actual AirloBot interface with sample content. No personal conversations or project files are shown.</sub></p>

AirloBot brings local chat, project tools, and helper agents into one desktop workspace. Give it a goal, let your local model investigate, and review proposed file changes before they are applied. No cloud model account or AI API key is required.

## What you can do

- **Work on a project.** Explore folders, read files, search text, and propose focused changes.
- **Delegate locally.** The main agent can create researcher or reviewer helpers using the same installed model, with separate contexts and read-only tools.
- **Stay in control.** Inspect activity and file changes, apply or reject each proposal, and stop work at any time.
- **Build a model library.** Add a local GGUF or browse public Hugging Face repositories, with download progress, pause/resume, and SHA-256 verification.
- **Keep your place.** Saved drafts, searchable recent work, and confirmed task/chat deletion keep the workspace manageable.
- **Choose your finish.** Light, Dark, and macOS-inspired Liquid Glass include motion and transparency controls.

## Get started

**This is an early Windows preview built from source. A signed installer and automatic updater are not available yet.**

### 1. Prepare your local engine

Install [LM Studio](https://lmstudio.ai/) and a compatible text model that fits your hardware. For project agents, choose a model that supports tool calling. AirloBot uses LM Studio's local server at `http://127.0.0.1:1234` and its `lms` CLI. See the [local-server setup guide](https://lmstudio.ai/docs/developer/core/server).

### 2. Build and launch

Install [Git](https://git-scm.com/downloads) and [Node.js](https://nodejs.org/en/download) **22.12 or newer**. The project is tested with Node 22.23.4.

In PowerShell:

```powershell
git clone https://github.com/BovineDawn/AirloBot.git
cd AirloBot
npm ci
npx --no-install install-electron
npm run build
& ".\Start AirloBot.cmd"
```

The launcher stores your history, drafts, and preferences in this checkout's local `data` folder. After setup, double-click **Start AirloBot.cmd** to reopen the app.

### 3. Choose a model and a mode

Open **Model library → Installed**, then select **Use model**. The local-engine indicator turns green when the selected model is loaded.

| Mode | Use it for |
| --- | --- |
| **Ask** | Questions, explanations, and planning. No project folder or file tools. |
| **Work on project** | Goals that need project files. Choose a folder, enter a goal, then review the result. |

Try a first task:

> Inspect this project. Ask a reviewer helper to investigate one issue, then propose a small fix with file references.

Need more room? **Settings → Project tasks** offers **Unlimited turns** and **No time limit**. Chat response length has its own **Unlimited (model context)** option. Model context and resource limits still apply.

## See it in action

### Review the change before it reaches your files

Task results stay in the main workspace. Open **Review changes** to see the changed lines, expand the full before/after text, and choose **Apply this file** or **Reject**. Nothing is applied by a model tool itself.

![Dark theme with a proposed file change, readable diff, and explicit Apply and Reject controls](docs/media/review-dark.png)

### Bring your own local models

Use models already installed in LM Studio, import a GGUF, or find a public model on Hugging Face. Downloads are verified before import. The library currently supports public, ungated, single-file GGUF models.

![Light theme showing the local model library and model selection controls](docs/media/library-light.png)

<details>
<summary><strong>Preview the appearance options</strong></summary>

Choose Light, Dark, or Liquid Glass in **Settings → Appearance**. Adjust glass diffusion, reduce transparency, or reduce motion to suit your workspace.

![Appearance settings with Light, Dark, and Liquid Glass previews and accessibility controls](docs/media/appearance-glass.png)

</details>

## Privacy and control

- **Inference stays on this computer.** AirloBot sends prompts and project context only to the fixed local model endpoint. It has no cloud inference fallback, telemetry, or account login.
- **Network access is explicit.** Hugging Face receives library searches and download requests. **Offline mode** blocks those operations while installed models remain usable.
- **File access is scoped.** Project tools stay within the selected folder, block sensitive path patterns and links, and require review before writing changes.
- **Storage is local, not encrypted.** Conversations, drafts, task activity, and proposals are saved as readable local data. Anyone with access to those files can read them.
- **Private data stays out of the repository.** Runtime data and model weights are ignored by Git and excluded from app packages. Publishing checks help catch recognized private-data paths and credentials.

LM Studio is a separate application; its own networking and updates are outside AirloBot's controls. Read the [storage and privacy details](docs/USER_GUIDE.md#privacy-and-storage) before using sensitive projects.

## Current scope

AirloBot 0.5 supports text chat and small, reviewed file changes. Helpers run sequentially, with up to two helpers per task. New tasks default to **100 shared model turns and 60 minutes**, both configurable. Terminal execution, running project tests, large-file patch editing, and autonomous writes are not available yet.

The app is tested on Windows. CI checks the service and production build on Windows and Linux; this does not imply a supported Linux desktop release. See the [user guide](docs/USER_GUIDE.md) for model requirements, exact limits, and troubleshooting.

## Help shape AirloBot

[Report a bug or suggest a feature](https://github.com/BovineDawn/AirloBot/issues). Include the app version and a minimal example with private details removed.

For development setup, checks, and branch practices, read [Contributing](CONTRIBUTING.txt). For implementation history, see the [Focus update](docs/FOCUS_RELEASE_NOTES.txt) and [task controls update](docs/TASK_CONTROLS_AND_PRIVACY.txt).

**License:** A project license has not been selected yet. Dependencies and downloaded models retain their own licenses.
