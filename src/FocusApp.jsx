import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronDown, FileText, FolderOpen, Library, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Search, Settings2, ShieldCheck, Square, Terminal, Trash2, X } from 'lucide-react';
import { api, Modal, RichText, Robot, shortModelName, Spinner } from './ui.jsx';
import Settings from './Settings.jsx';
import ModelLibrary from './ModelLibrary.jsx';
import { TaskPanel, TaskView } from './TaskView.jsx';
import ProjectFiles from './ProjectFiles.jsx';
import useTranscriptScroll from './useTranscriptScroll.js';
import './focus.css';

const initialWorkspace = { selected: 'new:task', sidebarCollapsed: false, drafts: {} };
export default function FocusApp() {
  const [state, setState] = useState(null), [status, setStatus] = useState({ connected: false, models: [], loaded: [] });
  const [workspace, setWorkspace] = useState(initialWorkspace), [view, setView] = useState('work');
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [toast, setToast] = useState('');
  const [query, setQuery] = useState(''), [scope, setScope] = useState('all'), [panel, setPanel] = useState(null), [engineOpen, setEngineOpen] = useState(false), [deleteTarget, setDeleteTarget] = useState(null);
  const [narrow, setNarrow] = useState(window.innerWidth < 1180);
  const composer = useRef(null), workspaceQueue = useRef(Promise.resolve()), toastTimer = useRef(null), busyRef = useRef(false);
  const selectedKey = workspace.selected;
  const { scroller, onScroll, jumpToLatest, showLatest } = useTranscriptScroll(selectedKey, view === 'work' && !!state);
  const mode = selectedKey === 'new:chat' || selectedKey.startsWith('chat:') ? 'chat' : 'task';
  const selectedId = selectedKey.split(':')[1];
  const conversation = state?.conversations.find(c => c.id === selectedId && mode === 'chat');
  const task = state?.tasks.find(t => t.id === selectedId && mode === 'task');
  const draft = workspace.drafts[selectedKey] || '';
  const attachedProject = task?.project || state?.project;
  const activeWork = Boolean(state?.activeChat || state?.activeTask);
  const locked = Boolean(busy || activeWork || state?.reviewing);
  const notify = text => { clearTimeout(toastTimer.current); setToast(text); toastTimer.current = setTimeout(() => setToast(''), 4200); };
  const attempt = async (label, fn) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(label); setError('');
    try { return await fn(); } catch (e) { setError(String(e.message || e).replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const refresh = async () => { try { const result = await api.status(); setStatus(result); return result; } catch { setStatus({ connected: false, models: [], loaded: [] }); } };
  const persistWorkspace = patch => {
    workspaceQueue.current = workspaceQueue.current.catch(() => {}).then(() => api.workspace(patch)).catch(e => setError('Could not save the local draft or layout: ' + e.message));
    return workspaceQueue.current;
  };
  const select = key => {
    setWorkspace(w => ({ ...w, selected: key })); setView('work'); setPanel(null);
    persistWorkspace({ selected: key });
  };
  const setDraft = (text, key = selectedKey) => {
    setWorkspace(w => { const drafts = { ...w.drafts }; if (text) drafts[key] = text; else delete drafts[key]; return { ...w, drafts }; });
    persistWorkspace({ draft: { key, text } });
  };
  const toggleSidebar = () => setWorkspace(w => { const sidebarCollapsed = !w.sidebarCollapsed; persistWorkspace({ sidebarCollapsed }); return { ...w, sidebarCollapsed }; });
  useEffect(() => {
    api.snapshot().then(s => { setState(s); const saved = { ...initialWorkspace, ...s.workspace }; if (!['new:chat', 'new:task', ...s.conversations.map(c => 'chat:' + c.id), ...s.tasks.map(t => 'task:' + t.id)].includes(saved.selected)) saved.selected = 'new:task'; setWorkspace(saved); }).catch(e => setError(e.message));
    refresh();
    const unsubscribe = api.subscribe(event => {
      if (event.type === 'state') setState(event.state);
      if (event.type === 'engine') refresh();
      if (event.type === 'error') setError(event.message);
      if (event.type === 'token') setState(s => s && ({ ...s, conversations: s.conversations.map(c => c.id !== event.conversationId ? c : { ...c, messages: c.messages.map(m => m.id === event.message.id ? event.message : m) }) }));
      if (event.type === 'download') setState(s => s && ({ ...s, downloads: s.downloads.map(d => d.id === event.download.id ? event.download : d) }));
    });
    const interval = setInterval(refresh, 15000), resize = () => setNarrow(window.innerWidth < 1180);
    window.addEventListener('resize', resize);
    return () => { unsubscribe(); clearInterval(interval); clearTimeout(toastTimer.current); window.removeEventListener('resize', resize); };
  }, []);
  useEffect(() => {
    if (!state) return;
    const root = document.documentElement, s = state.settings;
    root.dataset.theme = s.theme; root.dataset.reducedMotion = String(s.reducedMotion); root.dataset.reducedTransparency = String(s.reducedTransparency);
    root.style.setProperty('--glass-blur', `${14 + s.glassIntensity * .4}px`);
    root.style.setProperty('--glass-opacity', String(.45 + s.glassIntensity * .003));
  }, [state?.settings.theme, state?.settings.glassIntensity, state?.settings.reducedMotion, state?.settings.reducedTransparency]);
  useEffect(() => {
    const handle = event => {
      if (document.querySelector('dialog[open]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); toggleSidebar(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'i') { event.preventDefault(); composer.current?.focus(); }
      if (event.key === 'Escape') setPanel(null);
    };
    window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle);
  }, []);
  async function load(key) { await attempt('load', async () => { setStatus(await api.loadModel(key)); notify('Model ready on this device.'); }); }
  async function send(event, override) {
    event?.preventDefault();
    const content = override ?? draft;
    if (locked || busyRef.current || !content.trim() || (mode === 'task' && !attachedProject)) return;
    const sourceKey = selectedKey;
    let destinationKey = sourceKey;
    await attempt('send', async () => {
      setStatus(await api.loadModel(state.settings.model));
      if (mode === 'chat') {
        const id = conversation?.id || await api.newConversation();
        if (!conversation) {
          destinationKey = 'chat:' + id;
          if (override === undefined) { setDraft(content, destinationKey); setDraft('', sourceKey); }
          select(destinationKey);
        }
        jumpToLatest(); await api.send({ conversationId: id, content });
      } else {
        const id = await api.startTask({ goal: content, taskId: task?.id }); select('task:' + id);
      }
      if (override === undefined) setDraft('', destinationKey);
    });
  }
  const stop = () => attempt('stop', () => state.activeTask ? api.stopTask(state.activeTask) : api.stopChat());
  if (!state) return <div className="boot"><Robot size={52}/><h1>AirloBot</h1><p>{error || 'Opening your workspace…'}</p></div>;
  const model = status.models.find(m => m.key === state.settings.model), ready = Boolean(status.connected && model?.loaded_instances?.length);
  const activeKey = state.activeTask ? 'task:' + state.activeTask : state.activeChat ? 'chat:' + state.activeChat : null;
  const transfer = state.downloads.some(d => ['downloading', 'verifying', 'importing'].includes(d.status));
  const history = [...state.conversations.map(c => ({ key: 'chat:' + c.id, title: c.title, type: 'chat', date: c.updatedAt, status: state.activeChat === c.id ? 'Working' : 'Ask', id: c.id })), ...state.tasks.map(t => ({ key: 'task:' + t.id, title: t.title || t.goal, type: 'task', date: t.updatedAt, project: t.project, status: [...t.runs || [], t].some(r => r.proposals.some(p => p.status === 'pending')) ? 'Review changes' : t.status, id: t.id }))].filter(item => (!query || item.title.toLowerCase().includes(query.toLowerCase())) && (scope === 'all' || item.type === 'chat' || item.project?.path === state.project?.path)).sort((a, b) => new Date(b.date) - new Date(a.date));
  const changeProject = () => attempt('project', async () => { const result = await api.chooseProject(); if (result) select('new:task'); });
  const useFile = name => { setDraft((draft ? draft + '\n' : '') + 'File: ' + name); composer.current?.focus(); };
  const detailPanel = panel === 'files' && attachedProject ? <ProjectFiles project={attachedProject} taskId={task?.id} close={() => setPanel(null)} useFile={useFile}/> : task && panel ? <TaskPanel {...{ task, tab: panel, setTab: setPanel, close: () => setPanel(null), locked, state, attempt }}/> : null;

  return <div className={'app-shell ' + (workspace.sidebarCollapsed ? 'sidebar-collapsed' : '')}>
    <aside className="sidebar glass-surface" aria-label="Workspace navigation"><div className="brand"><Robot size={34}/><strong>AirloBot</strong><button className="icon-button" aria-label={workspace.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title="Ctrl+B" onClick={toggleSidebar}>{workspace.sidebarCollapsed ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}</button></div>
      <button className="button new-work" onClick={() => select('new:' + mode)} title={mode === 'chat' ? 'New chat' : 'New task'}><Plus size={18}/><span>{mode === 'chat' ? 'New chat' : 'New task'}</span></button>
      <div className="history-tools"><label className="history-search"><Search size={15}/><input aria-label="Search recent work" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search recent work"/></label><select aria-label="History scope" value={scope} onChange={e => setScope(e.target.value)}><option value="all">All recent work</option><option value="project" disabled={!state.project}>Current project + chats</option></select></div>
      <nav className="history" aria-label="Recent work">{!history.length && <p className="history-empty">{query ? 'No matching work.' : 'Your tasks and chats will appear here.'}</p>}{history.map(item => <div className={'history-row ' + (selectedKey === item.key && view === 'work' ? 'selected' : '')} key={item.key}><button className="history-item" aria-current={selectedKey === item.key && view === 'work' ? 'page' : undefined} onClick={() => select(item.key)} title={item.title}>{item.type === 'task' ? <Terminal size={16}/> : <MessageSquare size={16}/>}<span><strong>{item.title}</strong><small className={item.status === 'Review changes' ? 'attention' : ''}>{item.status}{item.project ? ' · ' + item.project.name : ''}</small></span></button><button className="history-delete icon-button" disabled={activeKey === item.key || !!state.reviewing} aria-label={'Delete ' + item.title} title={'Delete ' + (item.type === 'task' ? 'task' : 'conversation')} onClick={() => setDeleteTarget(item)}><Trash2 size={13}/></button></div>)}</nav>
      <div className="sidebar-bottom"><button className={'nav-button ' + (view === 'library' ? 'selected' : '')} onClick={() => { setView('library'); setPanel(null); refresh(); }} title="Model library"><Library size={18}/><span>Model library</span>{transfer && <i className="status-dot running"/>}</button><button className={'nav-button ' + (view === 'settings' ? 'selected' : '')} onClick={() => { setView('settings'); setPanel(null); }} title="Settings"><Settings2 size={18}/><span>Settings</span></button></div>
    </aside>
    <main className="main-area"><header className="topbar glass-surface"><div className="project-context">{view === 'work' ? mode === 'task' ? <button className="project-control" disabled={locked} onClick={changeProject} title={attachedProject?.path || 'Select the folder for project work'}><FolderOpen size={17}/><span>{attachedProject?.name || 'Choose project'}</span><ChevronDown size={14}/></button> : <span className="small muted">Ask</span> : <button className="text-button" onClick={() => setView('work')}>← Workspace</button>}</div><div className="top-actions">{view === 'work' && mode === 'task' && attachedProject && <button className="text-button" onClick={() => setPanel(panel === 'files' ? null : 'files')}><FolderOpen size={16}/>Files</button>}{state.settings.offline && <span className="small muted">Offline mode</span>}{activeWork && <><button className="text-button active-work" onClick={() => select(activeKey)}>{activeKey === selectedKey ? 'Working' : 'View running work'}</button><button className="button secondary stop-button" disabled={!!busy} onClick={stop}><Square size={13}/>Stop</button></>}<button className={'connection ' + (ready ? 'online' : 'offline')} onClick={() => setEngineOpen(true)} aria-label="Local engine details"><span className="connection-dot" aria-hidden="true"/><span role="status" aria-live="polite">{ready ? 'Local engine connected' : status.phase === 'loading' ? 'Loading local model…' : 'No model loaded'}</span></button></div></header>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16}/></button></div>}
      {view === 'work' ? <div className="workspace-view"><div className="work-column"><div className="transcript-scroll" ref={scroller} onScroll={onScroll}>
        {task ? <TaskView task={task} showPanel={setPanel} continueTask={() => send(null, 'Continue the previous task using the saved findings. Re-read any file before editing it; do not repeat changes that were already applied.')}/> : conversation?.messages.length ? <div className="chat-transcript">{conversation.messages.map((message, index) => <article className={message.role === 'user' ? 'user-entry' : 'assistant-entry'} key={message.id}><div className="author">{message.role === 'assistant' && <Robot/>}<strong>{message.role === 'user' ? 'You' : 'AirloBot'}</strong></div>{message.reasoning && <details className="reasoning"><summary>{message.status === 'streaming' && !message.content ? 'Thinking locally…' : 'Model reasoning'}</summary><div>{message.reasoning}</div></details>}<RichText>{message.content}</RichText>{message.status === 'streaming' && <div className="generating"><Spinner/>{message.content ? 'Generating' : 'Thinking on your device'}</div>}{message.error && <p className="notice error">{message.error}</p>}{message.omittedMessages > 0 && <p className="context-note">{message.omittedMessages} earlier messages were left out of this reply’s context. Your full history stays saved.</p>}{message.role === 'assistant' && message.status !== 'streaming' && <div className="message-meta"><span>{message.status === 'complete' ? 'Generated locally' : message.status}{message.usage?.completion_tokens ? ` · ${message.usage.completion_tokens.toLocaleString()} tokens` : ''}</span>{message.finishReason === 'length' && <div className="truncated"><span>Response stopped at a token or context limit.</span>{index === conversation.messages.length - 1 && <button className="text-button" disabled={locked} onClick={() => send(null, 'Continue your previous response from where it stopped. Do not repeat the part already written.')}>Continue response →</button>}<button className="text-button" onClick={() => setView('settings')}>Response settings</button></div>}</div>}</article>)}</div> : <div className="welcome"><Robot size={48}/><h1>What should we work on?</h1><p>{mode === 'task' ? 'Give AirloBot a goal. Review the changes when it’s done.' : 'Ask a question. Your conversation stays on this device.'}</p><div className="starter-actions">{(mode === 'task' ? [['Explore project', 'Inspect this project and explain its structure, citing the relevant files.'], ['Review a file', 'Inspect this project. Ask a reviewer helper to investigate one likely issue, then propose a small fix if warranted.']] : [['Explain something', 'Help me understand a topic. Ask what I would like to learn.'], ['Plan an idea', 'Help me turn an idea into a practical plan. Start with one useful question.']]).map(([label, text]) => <button className="button secondary" key={label} onClick={() => { setDraft(text); composer.current?.focus(); }}>{label}</button>)}</div></div>}
      </div>{showLatest && <button className="button secondary jump-latest" onClick={jumpToLatest}><ChevronDown size={15}/>Jump to latest</button>}<div className="composer-area">{mode === 'task' && !attachedProject && <div className="choose-project"><FolderOpen size={17}/><span>Choose the folder AirloBot can work in.</span><button className="text-button" disabled={locked} onClick={changeProject}>Choose folder</button></div>}{task && <p className="context-note">Continuing in {task.project.name}. Follow-ups stay in this conversation.</p>}
        <form className="composer glass-surface" onSubmit={send}><label className="sr-only" htmlFor="work-prompt">{mode === 'task' ? 'Project task' : 'Message AirloBot'}</label><textarea id="work-prompt" ref={composer} value={draft} maxLength={mode === 'task' ? 4000 : 24000} placeholder={mode === 'task' ? task ? 'Continue this project conversation…' : 'What should AirloBot get done?' : 'Message AirloBot…'} rows={2} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}/><div className="composer-controls"><select aria-label="Work mode" value={mode} onChange={e => select('new:' + e.target.value)}><option value="task">Work on project</option><option value="chat">Ask</option></select><button type="button" className="model-control" title={model?.display_name || state.settings.model} onClick={() => setEngineOpen(true)}><span>{shortModelName(model)}</span><ChevronDown size={13}/></button><span className="composer-spacer"/>{activeWork ? <button type="button" className="button secondary" onClick={stop} disabled={!!busy}><Square size={14}/>Stop</button> : <button type="submit" className="button primary send-button" disabled={locked || !draft.trim() || (mode === 'task' && !attachedProject)}>{busy === 'send' ? <Spinner/> : <ArrowUp size={17}/>}<span>{mode === 'task' && !task ? 'Start task' : 'Send'}</span></button>}</div></form>
        <div className="composer-foot"><span>{mode === 'task' ? 'File changes require review' : 'Ask mode · no file tools'}</span><button className="text-button response-limit" onClick={() => setView('settings')}>{mode === 'task' ? (state.settings.taskMaxTurns === -1 ? 'Unlimited task turns' : state.settings.taskMaxTurns + ' task turns') : state.settings.maxTokens === -1 ? 'No app token cap' : state.settings.maxTokens.toLocaleString() + ' token limit'}</button><span className="foot-note">Local models can make mistakes.</span></div>
      </div></div>{detailPanel && !narrow && detailPanel}</div> : <div className="page-scroll">{view === 'library' ? <ModelLibrary state={state} status={status} busy={busy} attempt={attempt} refresh={refresh} load={load} notify={notify}/> : <Settings state={state} status={status} busy={busy} attempt={attempt} refresh={refresh} notify={notify}/>}</div>}
      {toast && <div className="toast" role="status"><Check size={16}/>{toast}</div>}
    </main>
    {detailPanel && narrow && <Modal title={panel === 'files' ? 'Project files' : 'Task details'} className="task-drawer" onClose={() => setPanel(null)}>{detailPanel}</Modal>}
    {engineOpen && <Modal title="Local engine" onClose={() => setEngineOpen(false)}><div className="engine-status"><span className={'status-dot ' + (ready ? 'completed' : 'failed')}/><strong>{ready ? 'Ready on this device' : status.connected ? 'Select and load a model' : 'Engine offline'}</strong></div><p className="muted">Models run on this device. AirloBot manages the engine.</p><label className="field-label" htmlFor="engine-model">Selected model</label><select id="engine-model" value={state.settings.model} disabled={locked} onChange={e => load(e.target.value)}>{status.models.length ? status.models.map(m => <option key={m.key} value={m.key}>{m.display_name}</option>) : <option value={state.settings.model}>{state.settings.model}</option>}</select>{model && <p className="model-metadata">{model.quantization?.name || 'GGUF'} · {model.params_string || 'Local model'} · Runs on your hardware</p>}<div className="dialog-actions"><button className="button secondary" disabled={!!busy} onClick={() => attempt('refresh', refresh)}><RefreshCw size={15}/>Refresh</button><button className="button primary" disabled={locked} onClick={() => load(state.settings.model)}>{busy === 'load' ? <Spinner/> : <Check size={15}/>}Load selected model</button></div><button className="text-button" onClick={() => { setEngineOpen(false); setView('library'); }}>Open model library →</button></Modal>}
    {deleteTarget && <Modal title={deleteTarget.type === 'task' ? 'Delete this task?' : 'Delete this conversation?'} onClose={() => setDeleteTarget(null)}><p>{deleteTarget.type === 'task' ? 'This removes the saved task, its draft, helper activity, and pending proposals from recent work. Your project files are kept, including changes you already applied.' : 'This removes the saved conversation and its draft from AirloBot on this computer.'}</p><div className="dialog-actions"><button className="button secondary" onClick={() => setDeleteTarget(null)}>Keep work</button><button className="button danger" disabled={!!busy || activeKey === deleteTarget.key || !!state.reviewing} onClick={() => attempt('delete', async () => {
      await workspaceQueue.current;
      if (deleteTarget.type === 'task') await api.deleteTask(deleteTarget.id); else await api.deleteConversation(deleteTarget.id);
      setWorkspace(w => { const drafts = { ...w.drafts }; delete drafts[deleteTarget.key]; return { ...w, drafts }; });
      if (selectedKey === deleteTarget.key) select('new:' + deleteTarget.type);
      setDeleteTarget(null);
    })}>{deleteTarget.type === 'task' ? 'Delete task' : 'Delete conversation'}</button></div></Modal>}
  </div>;
}
