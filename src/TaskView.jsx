import React from 'react';
import { Bot, Check, ChevronRight, FileText, GitPullRequest, Users, X } from 'lucide-react';
import { api, RichText, Robot } from './ui.jsx';

function ChangePreview({ before, after }) {
  const oldLines = before === null ? [] : before.split('\n'), newLines = after.split('\n');
  let start = 0, end = 0;
  while (start < Math.min(oldLines.length, newLines.length) && oldLines[start] === newLines[start]) start++;
  while (end < Math.min(oldLines.length, newLines.length) - start && oldLines.at(-end - 1) === newLines.at(-end - 1)) end++;
  const removed = oldLines.slice(start, oldLines.length - end), added = newLines.slice(start, newLines.length - end);
  return <div className="change-preview"><p className="small muted">Changed section · {removed.length} removed, {added.length} added</p>
    <pre aria-label="Changed lines">{removed.slice(0, 40).map((line, i) => <span className="removed" key={'old' + i}>− {line}{'\n'}</span>)}{added.slice(0, 40).map((line, i) => <span className="added" key={'new' + i}>+ {line}{'\n'}</span>)}</pre>
    {(removed.length > 40 || added.length > 40) && <p className="small muted">Preview shortened. Expand the full file below to review everything.</p>}</div>;
}

export function TaskView({ task, showPanel, reuseGoal }) {
  const pending = task.proposals.filter(p => p.status === 'pending').length;
  const helperCount = task.agents.filter(a => a.role !== 'primary').length;
  const latest = task.events.at(-1);
  return <div className="task-transcript">
    <article className="user-entry"><span className="author">You <small>{task.project.name}</small></span><p>{task.goal}</p></article>
    <article className="assistant-entry"><div className="author"><Robot/><strong>AirloBot</strong></div>
      <button className="activity-summary" onClick={() => showPanel('activity')}><span className={'status-dot ' + task.status}/>{task.status === 'running' ? (latest?.type === 'tool_start' ? 'Working with project files' : 'Working on your project') : task.status === 'completed' ? 'Task complete' : task.status}<span>· {helperCount} {helperCount === 1 ? 'helper' : 'helpers'}</span><ChevronRight size={14}/></button>
      {task.error && <div className="notice error" role="status">{task.error}</div>}
      {task.result ? <RichText>{task.result}</RichText> : task.status === 'running' ? <p className="muted">The result will appear here. You can inspect activity or stop the task.</p> : null}
      <div className="result-actions">
        {task.proposals.length > 0 && <button className={'button ' + (pending ? 'review-button' : 'secondary')} onClick={() => showPanel('changes')}><GitPullRequest size={16}/>{pending ? `Review ${pending} ${pending === 1 ? 'change' : 'changes'}` : 'View changes'}</button>}
        {helperCount > 0 && <button className="text-button" onClick={() => showPanel('helpers')}><Users size={15}/>Helpers</button>}
        {task.status !== 'running' && <button className="text-button" onClick={() => reuseGoal(task.goal)}>Use this goal</button>}
      </div>
    </article>
  </div>;
}

export function TaskPanel({ task, tab, setTab, close, locked, state, attempt }) {
  return <aside className="detail-panel" aria-label="Task details">
    <header className="detail-head"><h2>Task details</h2><button className="icon-button" onClick={close} aria-label="Close task details"><X size={18}/></button></header>
    <div className="tabs" aria-label="Task detail sections">{['changes', 'helpers', 'activity'].map(name => <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>{name[0].toUpperCase() + name.slice(1)}{name === 'changes' && task.proposals.length ? <span>{task.proposals.length}</span> : null}</button>)}</div>
    <div className="detail-scroll">
      {tab === 'changes' && <>{!task.proposals.length && <p className="muted">No changes proposed.</p>}{task.proposals.map(proposal => <section className="proposal" key={proposal.id}>
        <h3><FileText size={16}/>{proposal.path}</h3><span className={'proposal-state ' + proposal.status}>{proposal.status}</span><p>{proposal.reason}</p>
        <ChangePreview before={proposal.before} after={proposal.after}/>
        <details className="file-content"><summary>Review full before and after</summary><h4>{proposal.before === null ? 'New file' : 'Before'}</h4><pre>{proposal.before ?? '(does not exist)'}</pre><h4>Proposed</h4><pre>{proposal.after || '(empty file)'}</pre></details>
        {proposal.error && <p className="notice error">{proposal.error}</p>}
        {proposal.status === 'pending' && <><p className="small muted">{task.project.path !== state.project?.path ? 'Choose this task’s project folder before reviewing.' : 'Only this file will be written.'}</p><div className="proposal-actions"><button className="button secondary" disabled={locked || task.project.path !== state.project?.path} onClick={() => attempt('reject', () => api.reviewChange({ taskId: task.id, proposalId: proposal.id, decision: 'reject' }))}><X size={14}/>Reject</button><button className="button primary" disabled={locked || task.project.path !== state.project?.path} onClick={() => attempt('apply', () => api.reviewChange({ taskId: task.id, proposalId: proposal.id, decision: 'apply' }))}><Check size={14}/>Apply this file</button></div></>}
      </section>)}</>}
      {tab === 'helpers' && <><p className="small muted">One local model. Helpers run one at a time and can only read project files.</p>{task.agents.map(agent => <details className="helper" key={agent.id}><summary><Bot size={18}/><span>{agent.name}<small>{agent.status === 'waiting' ? 'Waiting for helper' : agent.status}</small></span></summary><p>{agent.goal}</p>{agent.error && <p className="notice error">{agent.error}</p>}{agent.result && <RichText>{agent.result}</RichText>}</details>)}</>}
      {tab === 'activity' && <><p className="small muted">{task.budget ? `${task.turns}${task.budget.maxTurns === -1 ? ' model turns · No turn cap' : `/${task.budget.maxTurns} model turns`} · ${task.budget.maxMinutes === -1 ? 'No time limit' : task.budget.maxMinutes + '-minute limit'}` : 'Historical task · Original work budget'} · {task.steps} actions · Up to 2 helpers</p>{task.eventsOmitted > 0 && <p className="small muted">Showing the latest 500 events. {task.eventsOmitted} older events were discarded to bound local storage.</p>}{task.events.map(event => <details className="event" key={event.id}><summary><span>{event.agent}<strong>{event.type.replaceAll('_', ' ')}</strong></span><time>{new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></summary><pre>{event.detail}</pre></details>)}{!task.events.length && <p className="muted">Waiting for the first activity.</p>}</>}
    </div>
  </aside>;
}
