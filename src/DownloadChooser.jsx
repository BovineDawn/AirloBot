import React, { useEffect, useState } from 'react';
import { Download, ShieldCheck } from 'lucide-react';
import { api, formatBytes, Spinner } from './ui.jsx';
import { chooseVariants, freshHardware, modelCompatibility, quantizationName, suggestedVariant } from '../shared/model-compatibility.mjs';
import { FitBadge, useAssessmentClock } from './ModelCompatibility.jsx';
import { memorySize } from './HardwareSettings.jsx';

export default function DownloadChooser({ repo, state, busy, transfer, onDownload }) {
  const variants = chooseVariants(repo.files), [selected, setSelected] = useState(variants[0]?.file.name || ''), [metadata, setMetadata] = useState({}), [checking, setChecking] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const now = useAssessmentClock();
  const ready = freshHardware(state.hardwareProfile, state.settings, now);
  const source = repo.files.find(f => f.name === selected), file = source && { ...source, ...metadata[selected] };
  useEffect(() => {
    setChecking(false); setError('');
    if (!source || source.split || source.projector || state.settings.offline) return;
    let active = true; setChecking(!metadata[selected]);
    const queue = [selected, ...(ready ? variants.map(v=>v.file.name) : [])].filter((name,i,all)=>all.indexOf(name)===i && !metadata[name]);
    (async () => { for (const name of queue) {
      if (!active) break;
      try { const value = await api.previewModel({ repo:repo.repo, filename:name, revision:repo.revision }); if (active) setMetadata(old=>({...old,[name]:value})); }
      catch { if (active && name === selected) setError('Requirements could not be checked. You can retry or download a supported file without an estimate.'); }
      finally { if (active && name === selected) setChecking(false); }
    } })();
    return () => { active = false; };
  }, [selected, retry, state.settings.offline, ready]);
  const suggestion = suggestedVariant(repo.files.map(f=>({...f,...metadata[f.name]})), state.hardwareProfile, state.settings, now);
  const assessment = file ? modelCompatibility(file, state.hardwareProfile, state.settings, now) : null;
  const unavailable = !file || file.projector || file.split || !file.sha256 || file.metadataError === 'format';
  return <div className="download-chooser"><p className="small muted">Choose a version. Select a card to check its requirements; filenames and technical details stay available below.</p>
    {suggestion && <div className="fit-suggestion" role="status"><span>Suggested for memory fit: <strong>{suggestion.quantization || quantizationName(suggestion.name)}</strong>. This checked version leaves comfortable headroom at your context setting.</span>{suggestion.name !== selected && <button className="text-button" onClick={()=>setSelected(suggestion.name)}>Select suggestion</button>}</div>}
    <div className="variant-options">{variants.map(({ file: candidate, label }) => <button key={candidate.name} className={'variant-card' + (selected === candidate.name ? ' selected' : '')} aria-pressed={selected === candidate.name} onClick={() => setSelected(candidate.name)}><span className="variant-label">{label}</span><strong>{candidate.quantization || quantizationName(candidate.name)}</strong><span>{formatBytes(candidate.size)}</span>{ready && metadata[candidate.name] && <FitBadge result={modelCompatibility({...candidate,...metadata[candidate.name]},state.hardwareProfile,state.settings,now)}/>}</button>)}</div>
    {!variants.length && <div className="notice">This repository has no downloadable single-file GGUFs with verifiable size and checksum information.</div>}
    <details className="all-versions"><summary>All {repo.files.length} versions</summary><div>{repo.files.map(candidate => <label className="version-option" key={candidate.name}><input type="radio" name="model-version" checked={selected === candidate.name} disabled={candidate.split || candidate.projector || !candidate.sha256} onChange={() => setSelected(candidate.name)}/><span><strong>{candidate.name}</strong><small>{formatBytes(candidate.size)} · {candidate.projector ? 'Vision projector · Unsupported' : candidate.split ? 'Split file · Unsupported' : !candidate.sha256 ? 'Verification metadata unavailable' : candidate.quantization || quantizationName(candidate.name)}</small></span></label>)}</div></details>
    {file && <section className="selected-download" aria-label="Selected model download"><div className="selected-download-heading"><div><span className="small muted">Selected version</span><h3>{file.name}</h3></div><strong>{formatBytes(file.size)}</strong></div>
      {checking && !metadata[selected] ? <p className="requirements-loading"><Spinner/>Reading model requirements…</p> : <><FitBadge result={assessment}/><p className="fit-reason">{assessment.reason}</p>{assessment.estimate && <p className="small muted">Estimated memory: {memorySize(assessment.estimate.bytes)} at {assessment.estimate.context.toLocaleString()} context tokens. Includes weights, context cache and working buffers; speed and agent ability are untested.</p>}</>}
      {file.metadataError === 'unavailable' && <p className="small muted">Detailed metadata could not be read within the preview limits. No complete model was downloaded. <button className="text-button" disabled={checking || state.settings.offline} onClick={() => { setMetadata(old => { const next = { ...old }; delete next[selected]; return next; }); setRetry(n => n + 1); }}>Retry requirements</button></p>}
      {error && <div className="notice"><span>{error}</span><button className="text-button" onClick={() => setRetry(n => n + 1)}>Retry check</button></div>}
      <div className="selected-download-footer"><p className="small muted"><ShieldCheck size={14}/>SHA-256 verified after download · Uses your configured context and acceleration settings</p><button className="button primary" disabled={unavailable || !!transfer || !!busy || state.settings.offline || checking} onClick={() => onDownload(file)}><Download size={15}/>Download selected</button></div>
      {['tight','slow','disk'].includes(assessment.level) && <p className="small muted">You can still choose this version. Memory warnings are estimates; the actual disk-space check runs before downloading.</p>}
    </section>}
  </div>;
}
