# Product image provenance

These nine PNGs show the unmodified AirloBot 0.8.2 production renderer with fixed synthetic content. Conversation text, task results, project paths, hardware descriptions, model inventory, popularity counts, dates, and connection status are demo fixtures. They do not claim a live model interaction or expose a user's saved state.

| Image | View |
| --- | --- |
| `workspace-glass.png` | Sample project conversation awaiting review in Liquid Glass. |
| `review-dark.png` | Sample file-change review in Dark. |
| `review-in-progress.png` | Approval lock explanation and Stop and review while a sample task is running. |
| `chat-follow-scroll.png` | Jump to latest while reading earlier text in a sample streaming chat. |
| `library-light.png` | Example local-model inventory in Light. |
| `appearance-glass.png` | Appearance options and accessibility controls. |
| `library-downloads.png` | Download chooser and estimated memory fit using synthetic hardware. |
| `library-search.png` | Search metrics, per-file size range, and checked memory guidance. |
| `settings-models.png` | Category panels, local engine controls, and optional hardware guidance. |

Recreate from the repository root:

```powershell
npm run build
npx --no-install electron scripts/capture-readme.cjs
npx --no-install electron scripts/library-ui-test.cjs
Copy-Item test-results/library-ui/chooser-dark.png docs/media/library-downloads.png
Copy-Item test-results/library-ui/search-dark.png docs/media/library-search.png
Copy-Item test-results/library-ui/settings-models-glass.png docs/media/settings-models.png
```

The capture process uses its own ignored test profile, reads only the built app assets, and blocks every external network request. It does not read `data`, start an inference engine, or perform project file changes. No screenshot is taken from the user's running desktop app.

Before publishing regenerated images, inspect all nine for layout and unintended content. Do not replace these images with real chats, hardware profiles, local file paths, credentials, or personal project screenshots. Other private captures remain ignored by Git.
