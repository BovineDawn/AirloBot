# Product image provenance

These four PNGs show the unmodified AirloBot 0.6 production renderer with fixed synthetic content. Conversation text, task results, project paths, model inventory, and connection status are demo fixtures. They do not claim a live model interaction or expose a user's saved state.

| Image | View |
| --- | --- |
| `workspace-glass.png` | Sample project conversation awaiting review in Liquid Glass. |
| `review-dark.png` | Sample file-change review in Dark. |
| `library-light.png` | Example local-model inventory in Light. |
| `appearance-glass.png` | Appearance options and accessibility controls. |

Recreate from the repository root:

```powershell
npm run build
npx --no-install electron scripts/capture-readme.cjs
```

The capture process uses its own ignored test profile, reads only the built app assets, and blocks every external network request. It does not read `data`, start an inference engine, or perform project file changes. No screenshot is taken from the user's running desktop app.

Before publishing regenerated images, inspect all four for layout and unintended content. Do not replace these images with real chats, local file paths, credentials, or personal project screenshots. Other private captures remain ignored by Git.
