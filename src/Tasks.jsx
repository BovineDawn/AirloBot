import React, { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { Bot, Check, ChevronRight, FileText, FolderOpen, Play, Square, Users, X } from 'lucide-react';

const api = window.airlo;
const MarkdownResult = ({ children }) => <div className="markdown"><Markdown components={{ a: ({ children }) => <span className="text-link">{children}</span>, img: () => null }}>{children}</Markdown></div>;

export default function Tasks({ state, status, busy, attempt, refresh }) {
  const [goal, setGoal] = useState(''), [selected, setSelected] = useState(state.tasks[0]?.id || null);
  useEffect(() => { if (!selected && state.tasks.length) setSelected(state.tasks[0].id); }, [state.tasks.length, selected]);
  const task = state.tasks.find(t => t.id === selected), running = Boolean(state.activeTask);
  const locked = Boolean(busy || running || state.activeChat || state.reviewing);
  const start = async event => {
    event.preventDefault();
    if (locked || !goal.trim()) return;
    await attempt('task', async () => {
      await api.loadModel(state.settings.model); await refresh();
      const id = await api.startTask({ goal }); setSelected(id); setGoal('');
    });
  };
  return <div className="page-scroll"><div className="page tasks-page">
    <div className="eyebrow">LOCAL MODELS. REAL PROJECTS.</div>
    <h1>Give your project a goal.</h1>
    <p className="page-subtitle">AirloBot investigates files, brings in helpers, and proposes changes you can review.</p>
    <section className="project-picker task-surface">
      <FolderOpen size={23}/><div><strong>{state.project?.name || 'Choose your project'}</strong><p title={state.project?.path}>{state.project?.path || 'Select the folder AirloBot and its helpers can work in.'}</p></div>
      <button className="button secondary" disabled={locked} onClick={() => attempt('project', () => api.chooseProject())}>{state.project ? 'Change folder' : 'Choose folder'}<ChevronRight size={14}/></button>
    </section>
    <form className="task-composer task-surface" onSubmit={start}>
      <label htmlFor="task-goal">What should AirloBot get done?</label>
      <textarea id="task-goal" aria-label="Project task" value={goal} maxLength={4000} rows={3} onChange={e => setGoal(e.target.value)} placeholder="Explore this project, ask a reviewer to find one issue, then propose a fix with evidence."/>
      <div className="task-presets">{[
        ['Explore project', 'Inspect the project files and explain its structure, entry points and purpose. Cite files and line numbers.'],
        ['Delegate a review', 'Inspect this project. Create a reviewer helper to investigate one likely bug. Use its findings to propose a small fix if warranted. Cite evidence and do not claim to run tests.']
      ].map(([label, value]) => <button type="button" key={label} disabled={locked} onClick={() => setGoal(value)}>{label}</button>)}</div>
      <div className="task-composer-actions"><div className="task-model"><Bot size={16}/><select aria-label="Agent model" value={state.settings.model} disabled={locked} onChange={e => attempt('agent-model', async () => { await api.loadModel(e.target.value); await refresh(); })}>
        {status.models.length ? status.models.map(m => <option value={m.key} key={m.key}>{m.display_name}</option>) : <option value={state.settings.model}>{state.settings.model}</option>}
      </select></div><button className="button primary" disabled={locked || !state.project || !goal.trim()}><Play size={14}/>{busy === 'task' ? 'Preparing…' : 'Run task'}</button></div>
      <div className="task-note">One local model · Up to 2 helpers · Proposed edits require your review</div>
      {state.activeChat && <p className="notice">Finish or stop the chat response before starting a project task.</p>}
    </form>
    <div className="task-workspace">
      <aside className="task-history"><div className="section-title"><h2>Tasks</h2><span>{state.tasks.length}</span></div>
        {!state.tasks.length && <p className="muted">Your tasks and results will appear here.</p>}
        {state.tasks.map(t => <button className={'task-history-item ' + (t.id === selected ? 'selected' : '')} key={t.id} onClick={() => setSelected(t.id)}><strong>{t.goal}</strong><span>{t.project.name} · {t.status}</span></button>)}
      </aside>
      <section className="task-detail" aria-live="polite">
        {!task ? <div className="task-empty task-surface"><Users size={30}/><h2>Your local team, one clear goal.</h2><p>AirloBot can read and search project files, delegate focused investigations, and prepare small file changes. You stay in control of what gets applied.</p><p>No terminal commands or internet tools run in this first agent release.</p></div> : <>
          <div className="task-heading"><div><h2>{task.goal}</h2><p>{task.project.name} · <span className="task-status">{task.status}</span> · {task.steps}/20 steps</p></div>
            {state.activeTask === task.id ? <button className="button secondary small" onClick={() => attempt('stop-task', () => api.stopTask(task.id))}><Square size={13}/> Stop</button> : <button className="button secondary small" disabled={locked} onClick={() => setGoal(task.goal)}>Use this goal</button>}
          </div>
          {task.error && <div className="notice" role="status">{task.error}</div>}
          <div className="agent-cards">{task.agents.map(agent => <details className="agent-card task-surface" key={agent.id}><summary><Bot size={19}/><span><strong>{agent.name}</strong><small>{agent.status === 'waiting' ? 'Waiting for helper' : agent.status}</small></span></summary><p>{agent.goal}</p>{agent.error && <p className="message-error">{agent.error}</p>}{agent.result && <MarkdownResult>{agent.result}</MarkdownResult>}</details>)}</div>
          {task.result && <section className="task-result task-surface"><div className="section-title"><h2>Result</h2><Check size={17}/></div><MarkdownResult>{task.result}</MarkdownResult></section>}
          {task.proposals.length > 0 && <section className="task-proposals"><div className="section-title"><h2>Proposed changes</h2><span>Review before applying</span></div>{task.proposals.map(proposal => <details className="proposal task-surface" key={proposal.id}>
            <summary><FileText size={17}/><strong>{proposal.path}</strong><span>{proposal.status}</span></summary>
            <p>{proposal.reason}</p><div className="file-compare"><div><h3>{proposal.before === null ? 'New file' : 'Before'}</h3><pre>{proposal.before ?? '(does not exist)'}</pre></div><div><h3>Proposed content</h3><pre>{proposal.after || '(empty file)'}</pre></div></div>
            {proposal.error && <div className="message-error">{proposal.error}</div>}
            {proposal.status === 'pending' && <div className="proposal-actions"><span>{task.project.path !== state.project?.path ? 'Select this project to review changes.' : 'Only this file will be written.'}</span><button className="button secondary small" disabled={locked || task.project.path !== state.project?.path} onClick={() => attempt('reject', () => api.reviewChange({ taskId: task.id, proposalId: proposal.id, decision: 'reject' }))}><X size={13}/> Reject</button><button className="button primary small" disabled={locked || task.project.path !== state.project?.path} onClick={() => attempt('apply', () => api.reviewChange({ taskId: task.id, proposalId: proposal.id, decision: 'apply' }))}><Check size={13}/> Apply this file</button></div>}
          </details>)}</section>}
          <details className="task-activity task-surface" open={task.status === 'running'}><summary>Activity <span>{task.events.length} events</span></summary><div className="activity-list">{task.events.map(event => <details key={event.id}><summary><span>{event.agent}</span><strong>{event.type.replaceAll('_', ' ')}</strong><time>{new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></summary><pre>{event.detail}</pre></details>)}</div></details>
        </>}
      </section>
    </div>
  </div></div>;
}
