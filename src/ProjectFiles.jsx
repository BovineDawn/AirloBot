import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileText, Folder, RefreshCw, X } from 'lucide-react';
import { api, Spinner } from './ui.jsx';

export default function ProjectFiles({ project, taskId, close, useFile }) {
  const [directory, setDirectory] = useState('.'), [listing, setListing] = useState(null), [file, setFile] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef(0);
  const list = async (dir = directory, cursor = 0) => {
    const id = ++request.current; setBusy(true); setError('');
    try { const result = await api.projectFiles({ taskId, directory: dir, cursor }); if (id !== request.current) return; setListing(old => cursor ? { ...result, entries: [...old.entries, ...result.entries] } : result); }
    catch (e) { if (id === request.current) setError(e.message); }
    finally { if (id === request.current) setBusy(false); }
  };
  useEffect(() => { setDirectory('.'); setFile(null); setListing(null); list('.'); return () => { request.current++; }; }, [project.path, taskId]);
  const openDirectory = dir => { setDirectory(dir); setFile(null); list(dir); };
  const read = async (name, startChar = 0) => {
    const id = ++request.current; setBusy(true); setError('');
    try { const result = await api.projectRead({ taskId, path: name, startChar }); if (id === request.current) setFile(result); }
    catch (e) { if (id === request.current) setError(e.message); }
    finally { if (id === request.current) setBusy(false); }
  };
  return <aside className="detail-panel file-browser" aria-label="Project files">
    <header className="detail-head"><h2>Project files</h2><button className="icon-button" onClick={close} aria-label="Close project files"><X size={18}/></button></header>
    <div className="detail-scroll"><p className="small muted">{project.name} · Local folder</p><code className="file-location">{file?.path || directory}</code>
      <div className="file-toolbar"><button className="text-button" disabled={busy || (!file && directory === '.')} onClick={() => file ? setFile(null) : openDirectory(directory.includes('/') ? directory.slice(0, directory.lastIndexOf('/')) : '.')}><ArrowLeft size={14}/>Back</button><button className="icon-button" aria-label="Refresh project files" disabled={busy} onClick={() => file ? read(file.path) : list()}><RefreshCw size={15}/></button></div>
      {error && <p className="notice error" role="alert">{error}</p>}{busy && <p className="small muted"><Spinner/> Reading local files…</p>}
      {file ? <><button className="button secondary" onClick={() => useFile(file.path)}>Use this file in my request</button><p className="small muted">Lines from {file.startLine} of {file.totalLines}</p><pre className="file-preview">{file.content || '(empty file)'}</pre>{file.next_start_char !== null && <button className="button secondary" disabled={busy} onClick={() => read(file.path, file.next_start_char)}>Read next section</button>}</> : <>
        <div className="file-tree">{listing?.entries.map(entry => <button key={entry.path} disabled={busy} onClick={() => entry.type === 'directory' ? openDirectory(entry.path) : read(entry.path)}>{entry.type === 'directory' ? <Folder size={16}/> : <FileText size={16}/>}<span>{entry.path.split('/').at(-1)}</span></button>)}</div>
        {listing && !listing.entries.length && <p className="muted">No accessible files in this folder.</p>}
        {listing?.next_cursor != null && <button className="button secondary" disabled={busy} onClick={() => list(directory, listing.next_cursor)}>Show more files</button>}
        {listing && <p className="small muted">{listing.total} visible entries · {listing.excluded} excluded. Open a folder to browse deeper. Credential paths, generated folders, and links stay excluded.</p>}
      </>}
    </div>
  </aside>;
}
