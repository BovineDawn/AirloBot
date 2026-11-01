import React, { useEffect, useState } from 'react';
import { api, formatBytes } from './ui.jsx';
import { chooseVariants, freshHardware, modelCompatibility } from '../shared/model-compatibility.mjs';
import { FitBadge, useAssessmentClock } from './ModelCompatibility.jsx';
import ModelMetrics from './ModelMetrics.jsx';

export default function ModelSearchResults({ results, state, inspect, finding, openHardware }) {
  const [page, setPage] = useState(0), [details, setDetails] = useState({}), [metadata, setMetadata] = useState({}), [checking, setChecking] = useState(false), [progress, setProgress] = useState(0), [retry, setRetry] = useState(0);
  const now = useAssessmentClock(), ready = freshHardware(state.hardwareProfile, state.settings, now), shown = results.slice(page * 6, page * 6 + 6);
  useEffect(() => {
    if (state.settings.offline) return;
    let active = true, cursor = 0;
    const rows = results.slice(page * 6, page * 6 + 6).filter(m => !m.gated && !details[m.id]);
    async function worker() {
      while (active && cursor < rows.length) {
        const row = rows[cursor++];
        try { const value = await api.modelFiles(row.id); if (active) setDetails(old => ({...old, [row.id]:value})); }
        catch { if (active) setDetails(old => ({...old, [row.id]:{error:true}})); }
      }
    }
    worker(); worker(); return () => { active = false; };
  }, [results, page, retry, state.settings.offline]);
  useEffect(() => {
    setChecking(false); setProgress(0);
  }, [page, results, ready, state.settings.offline]);
  // One serial comparison at a time; unmount/offline/page changes discard late UI results.
  const comparison = React.useRef(0);
  useEffect(() => { comparison.current++; return () => { comparison.current++; }; }, [page, results, ready, state.settings.offline]);
  const compare = async () => {
    if (!ready) { openHardware(); return; }
    const run = ++comparison.current; setChecking(true); setProgress(0);
    for (const row of shown) {
      if (run !== comparison.current) return;
      const info = details[row.id], file = info?.files && chooseVariants(info.files)[0]?.file;
      if (file) {
        try { const value = await api.previewModel({ repo:info.repo, filename:file.name, revision:info.revision }); if (run === comparison.current) setMetadata(old => ({...old,[row.id]:{...file,...value}})); }
        catch { if (run === comparison.current) setMetadata(old => ({...old,[row.id]:{...file, metadataError:'unavailable'}})); }
      }
      if (run === comparison.current) setProgress(n => n + 1);
    }
    if (run === comparison.current) setChecking(false);
  };
  const loading = shown.some(m => !m.gated && !details[m.id]);
  const matches = ready ? shown.filter(m => metadata[m.id] && modelCompatibility(metadata[m.id], state.hardwareProfile, state.settings, now).level === 'good') : [];
  return <div className="model-results">
    <div className="results-toolbar"><p className="small muted">Popularity reflects community activity, not speed or agent ability. Compare starting versions on this page; the chooser checks other versions.</p>{checking ? <><span className="small muted" role="status">Checking {progress} / {shown.length}…</span><button className="button secondary" onClick={() => {comparison.current++;setChecking(false);}}>Stop comparison</button></> : <button className="button secondary" disabled={loading || state.settings.offline} onClick={compare}>Compare memory fit</button>}</div>
    {matches.length > 0 && <p className="fit-suggestion" role="status">{matches.length} {matches.length===1 ? 'model has' : 'models have'} a checked starting version that likely fits comfortably. Look for the green labels below.</p>}
    <div className="search-results">{shown.map(m => {
      const info = details[m.id], file = metadata[m.id] || (info?.files && chooseVariants(info.files)[0]?.file);
      const assessment = file && modelCompatibility(file, state.hardwareProfile, state.settings, now);
      return <article className="search-result-card" key={m.id}>
        <button className="model-result-title" disabled={finding || state.settings.offline} onClick={() => inspect(m.id)}>{m.id}</button>
        <ModelMetrics model={m} files={info?.files} loading={!info && !m.gated}/>
        {m.gated ? <p className="small muted">Access restricted · Public ungated models are supported.</p> : info?.error ? <p className="small muted">File sizes unavailable. <button className="text-button" disabled={state.settings.offline} onClick={() => { setDetails(old => {const copy={...old}; delete copy[m.id]; return copy;}); setRetry(n=>n+1); }}>Retry details</button></p> : file ? <div className="result-fit"><p className="small muted">Starting version: {file.quantization || file.name} · {formatBytes(file.size)}</p><FitBadge result={assessment}/><p className="small muted">{assessment.reason}</p></div> : info && <p className="small muted">No supported single-file GGUF. Try another repository.</p>}
        <button className="text-button" disabled={finding || state.settings.offline} onClick={() => inspect(m.id)}>Choose a version →</button>
      </article>;
    })}</div>
    <div className="results-pagination"><button className="button secondary" disabled={page === 0} onClick={() => setPage(n=>n-1)}>Previous</button><span className="small muted">{page * 6 + 1}–{Math.min(results.length,(page+1)*6)} of {results.length} results</span><button className="button secondary" disabled={(page+1)*6 >= results.length} onClick={() => setPage(n=>n+1)}>Next</button></div>
  </div>;
}
