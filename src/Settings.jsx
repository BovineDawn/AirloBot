import React, { useEffect, useState } from 'react';
import { Check, FolderOpen, Moon, ShieldCheck, Sparkles, Sun } from 'lucide-react';
import { api, Toggle } from './ui.jsx';

export default function Settings({ state, status, busy, attempt, refresh, notify }) {
  const s = state.settings;
  const [temperature, setTemperature] = useState(s.temperature), [tokens, setTokens] = useState(s.maxTokens), [prompt, setPrompt] = useState(s.systemPrompt), [intensity, setIntensity] = useState(s.glassIntensity);
  useEffect(() => setIntensity(s.glassIntensity), [s.glassIntensity]);
  const save = patch => attempt('settings', () => api.settings(patch));
  const caps = [...new Set([256, 512, 1024, 2048, 4096, 8192, 16384, 32768, ...(tokens > 0 ? [tokens] : [])])].sort((a, b) => a - b);
  return <div className="settings-page page">
    <div className="page-title"><h1>Settings</h1><p>Saved on this device.</p></div>
    <section className="settings-section"><h2>Responses</h2><p className="muted">Applies to the next chat reply. Project agents keep their own bounded work limits.</p>
      <label className="setting-row"><span><strong>Response length</strong><small>Unlimited removes AirloBot’s token cap. The model’s context and memory still apply.</small></span><select aria-label="Response token limit" value={tokens} onChange={e => setTokens(Number(e.target.value))}><option value={-1}>Unlimited (model context)</option>{caps.map(n => <option value={n} key={n}>{n.toLocaleString()} tokens</option>)}</select></label>
      <label className="setting-row"><span><strong>Creativity</strong><small>Lower stays focused; higher adds variety.</small></span><span className="range-control"><input aria-label="Temperature" type="range" min="0" max="2" step="0.05" value={temperature} onChange={e => setTemperature(Number(e.target.value))}/><output>{temperature.toFixed(2)}</output></span></label>
      <details className="advanced"><summary>Assistant instructions</summary><label className="field-label" htmlFor="system-prompt">Chat instructions</label><textarea id="system-prompt" value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={12000} rows={5}/></details>
      <div className="settings-actions"><button className="button primary" disabled={!!busy} onClick={() => attempt('preferences', async () => { await api.settings({ temperature, maxTokens: tokens, systemPrompt: prompt }); notify('Response preferences saved.'); })}>Save response preferences<Check size={15}/></button></div>
    </section>
    <section className="settings-section"><h2>Privacy and local engine</h2>
      <div className="privacy-summary"><ShieldCheck size={20}/><p>Prompts and project files go only to the model server on this computer. Hugging Face is contacted when you browse or download models. AirloBot has no analytics or cloud inference.</p></div>
      <div className="setting-row"><span><strong>Offline mode</strong><small>Block Hugging Face browsing and downloads. Local work stays available.</small></span><Toggle label="Offline mode" checked={s.offline} disabled={!!busy} onChange={offline => save({ offline })}/></div>
      <div className="setting-row"><span><strong>LM Studio</strong><small>{state.endpoint}</small></span><button className="button secondary" disabled={!!busy || !!state.activeTask || !!state.activeChat} onClick={() => attempt('runtime', async () => { await api.startRuntime(); await refresh(); })}>{status.connected ? 'Check connection' : 'Start engine'}</button></div>
      <p className="small muted">Project tools stay inside your selected folder, exclude credential files and links, and require your review before applying proposed edits. Ask mode has no file tools.</p>
      <details className="advanced"><summary>Local storage</summary><p>Conversations, drafts, preferences, and model downloads are stored locally. They are not encrypted by AirloBot; anyone with access to these files can read them.</p><code className="data-path">{state.dataDir}</code><button className="button secondary" onClick={() => attempt('open-data', () => api.openData())}><FolderOpen size={15}/>Open data folder</button></details>
    </section>
    <section className="settings-section appearance"><h2>Appearance</h2><p className="muted">Light, Dark, or a floating glass finish. Theme choices save automatically.</p>
      <div className="theme-options" role="group" aria-label="App theme">{[['light', 'Light', Sun, 'Clean, soft white.'], ['dark', 'Dark', Moon, 'Quiet charcoal.'], ['glass', 'Liquid Glass', Sparkles, 'Luminous edges. Fluid depth.']].map(([theme, label, Icon, description]) => <button className={'theme-option theme-' + theme} key={theme} aria-pressed={s.theme === theme} disabled={!!busy} onClick={() => save({ theme })}><span className="theme-preview"><span className="preview-rail"/><span className="preview-line"/><span className="preview-line short"/><span className="preview-composer"/></span><span className="theme-name"><Icon size={16}/>{label}{s.theme === theme && <Check size={15}/>}</span><small>{description}</small></button>)}</div>
      {s.theme === 'glass' && <label className="setting-row"><span><strong>Glass diffusion</strong><small>Higher values add frost while keeping the glass edges defined.</small></span><span className="range-control"><input aria-label="Glass intensity" type="range" min="20" max="90" value={intensity} disabled={!!busy} onChange={e => setIntensity(Number(e.target.value))} onPointerUp={e => save({ glassIntensity: Number(e.currentTarget.value) })} onKeyUp={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) save({ glassIntensity: Number(e.currentTarget.value) }); }} onBlur={() => { if (intensity !== s.glassIntensity) save({ glassIntensity: intensity }); }}/><output>{intensity}%</output></span></label>}
      <div className="setting-row"><span><strong>Reduce transparency</strong><small>Use solid surfaces for stronger contrast.</small></span><Toggle label="Reduce transparency" checked={s.reducedTransparency} disabled={!!busy} onChange={reducedTransparency => save({ reducedTransparency })}/></div>
      <div className="setting-row"><span><strong>Reduce motion</strong><small>System motion preferences are respected too.</small></span><Toggle label="Reduced motion" checked={s.reducedMotion} disabled={!!busy} onChange={reducedMotion => save({ reducedMotion })}/></div>
    </section>
    <p className="about">AirloBot 0.4 · Local models, reviewed actions.</p>
  </div>;
}
