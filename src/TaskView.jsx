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

const labels = { completed: 'Investigation finished', awaiting_review: 'Changes ready for review', needs_input: 'Awaiting your direction', needs_attention: 'Needs attention', applied: 'Changes applied', reviewed: 'Review finished', reverted: 'Changes undone', cancelled: 'Stopped', interrupted: 'Interrupted', limited: 'Work limit reached' };
const actionLabels = { list_files: 'Browsing', read_file: 'Reading', search_text: 'Searching', propose_file: 'Preparing file', propose_directory: 'Preparing folder', propose_edit: 'Preparing edit', spawn_agent: 'Delegating to a helper' };
export function TaskView({ task, showPanel, continueTask }) {
  const runs = [...task.runs || [], task];
  return <div className="task-transcript">{runs.map((run, index) => {
    const pending = run.proposals.filter(p => p.status === 'pending').length, helperCount = run.agents.filter(a => a.role !== 'primary').length, latest = index === runs.length - 1;
    return <React.Fragment key={run.runId || index}>
      <article className="user-entry"><span className="author">You <small>{task.project.name}</small></span><p>{run.goal}</p></article>
      <article className="assistant-entry"><div className="author"><Robot/><strong>AirloBot</strong></div>
        <button className="activity-summary" onClick={() => showPanel('activity')}><span className={'status-dot ' + run.status}/>{run.status === 'running' ? run.currentAction ? `${actionLabels[run.currentAction.tool] || 'Working'} ${run.currentAction.path}` : 'Inspecting your project…' : labels[run.status] || run.status}<ChevronRight size={14}/></button>
        {run.error && <div className="notice error" role="status">{run.error}</div>}
        {run.result && <RichText>{run.result}</RichText>}{run.status === 'needs_attention' && <div className="notice error">Some tool actions did not succeed. Review the errors before continuing.<ul>{Object.entries(run.unresolvedErrors || {}).map(([key, value]) => <li key={key}>{key}: {value}</li>)}</ul></div>}
        {run.status === 'needs_input' && <p className="context-note">No file contents were read and no changes were prepared in this turn. Give a specific file or action to continue.</p>}
        {!!Object.keys(run.filesRead || {}).length && <details className="sources"><summary>Read {Object.keys(run.filesRead).length} local {Object.keys(run.filesRead).length === 1 ? 'file' : 'files'}</summary>{Object.keys(run.filesRead).map(name => <code key={name}>{name}</code>)}</details>}
        {run.contextOmitted > 0 && <p className="context-note">{run.contextOmitted} earlier turns were left out of this reply’s context. Your saved history is still here.</p>}
        <div className="result-actions">
          {run.proposals.length > 0 && <button className={'button ' + (pending ? 'review-button' : 'secondary')} onClick={() => showPanel('changes')}><GitPullRequest size={16}/>{pending ? `Review ${pending} ${pending === 1 ? 'change' : 'changes'}` : 'View changes'}</button>}
          {helperCount > 0 && <button className="text-button" onClick={() => showPanel('helpers')}><Users size={15}/>{helperCount} {helperCount === 1 ? 'helper' : 'helpers'}</button>}
          {latest && ['cancelled', 'interrupted', 'limited', 'failed', 'needs_attention'].includes(run.status) && <button className="text-button" onClick={continueTask}>Continue saved work</button>}
        </div>
      </article>
    </React.Fragment>;
  })}</div>;
}

export function TaskPanel({ task, tab, setTab, close, locked, state, attempt }) {
  const runs = [...task.runs || [], task], proposals = runs.flatMap(r => r.proposals), agents = runs.flatMap(r => r.agents);
  return <aside className="detail-panel" aria-label="Task details">
    <header className="detail-head"><h2>Task details</h2><button className="icon-button" onClick={close} aria-label="Close task details"><X size={18}/></button></header>
    <div className="tabs" aria-label="Task detail sections">{['changes', 'helpers', 'activity'].map(name => <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>{name[0].toUpperCase() + name.slice(1)}{name === 'changes' && proposals.length ? <span>{proposals.length}</span> : null}</button>)}</div>
    <div className="detail-scroll">
      {tab === 'changes' && <>{!proposals.length && <p className="muted">No changes proposed.</p>}{proposals.map(proposal => <section className="proposal" key={proposal.id}>
        <h3><FileText size={16}/>{proposal.path}</h3><span className={'proposal-state ' + proposal.status}>{proposal.status}</span><p>{proposal.reason}</p>
        <p className="small muted">{proposal.operation === 'mkdir' ? 'Create folder and any missing parents' : proposal.operation === 'edit' ? 'Edit existing document' : proposal.before === null ? 'Create file' : 'Replace file'}</p>{proposal.operation !== 'mkdir' && <ChangePreview before={proposal.before} after={proposal.after}/>}
        {proposal.operation !== 'mkdir' && <details className="file-content"><summary>Review full before and after</summary><h4>{proposal.before === null ? 'New file' : 'Before'}</h4><pre>{proposal.before ?? '(does not exist)'}</pre><h4>Proposed</h4><pre>{proposal.after || '(empty file)'}</pre></details>}
        {proposal.error && <p className="notice error">{proposal.error}</p>}
        {proposal.status === 'pending' && <><p className="small muted">{proposal.needsDirectory ? 'Apply the folder proposal first: ' + proposal.needsDirectory : 'Applies only inside ' + task.project.name + '.'}</p><div className="proposal-actions"><button className="button secondary" disabled={locked} onClick={() => attempt('reject', () => api.reviewChange({ taskId: task.id, proposalId: proposal.id, decision: 'reject' }))}><X size={14}/>Reject</button><button className="button primary" disabled={locked} onClick={() => attempt('apply', () => api.reviewChange({ taskId: task.id, proposalId: proposal.id, decision: 'apply' }))}><Check size={14}/>Apply change</button></div></>}{proposal.status === 'applied' && <button className="button secondary" disabled={locked} onClick={() => attempt('undo', () => api.reviewChange({ taskId: task.id, proposalId: proposal.id, decision: 'undo' }))}>Undo this change</button>}
      </section>)}</>}
      {tab === 'helpers' && <><p className="small muted">One local model. Helpers run one at a time and can only read project files.</p>{agents.map(agent => <details className="helper" key={agent.id}><summary><Bot size={18}/><span>{agent.name}<small>{agent.status === 'waiting' ? 'Waiting for helper' : agent.status}</small></span></summary><p>{agent.goal}</p>{agent.error && <p className="notice error">{agent.error}</p>}{agent.result && <RichText>{agent.result}</RichText>}</details>)}</>}
      {tab === 'activity' && <><p className="small muted">{task.budget ? `${task.turns}${task.budget.maxTurns === -1 ? ' model turns · No turn cap' : `/${task.budget.maxTurns} model turns`} · ${task.budget.maxMinutes === -1 ? 'No time limit' : task.budget.maxMinutes + '-minute limit'}` : 'Historical task · Original work budget'} · {task.steps} actions · Up to 2 helpers</p>{task.eventsOmitted > 0 && <p className="small muted">Showing the latest 500 events. {task.eventsOmitted} older events were discarded to bound local storage.</p>}{runs.flatMap(r => r.events).map(event => <details className="event" key={event.id}><summary><span>{event.agent}<strong>{event.type.replaceAll('_', ' ')}</strong></span><time>{new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></summary><pre>{event.detail}</pre></details>)}{!task.events.length && <p className="muted">Waiting for the first activity.</p>}</>}
    </div>
  </aside>;
}
