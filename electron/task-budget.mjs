export const DEFAULT_TASK_BUDGET = Object.freeze({ maxTurns: 100, maxMinutes: 60 });
export const validTaskTurns = value => value === -1 || (Number.isInteger(value) && value >= 10 && value <= 1000);
export const validTaskMinutes = value => value === -1 || (Number.isInteger(value) && value >= 1 && value <= 1440);
export class TaskLimitError extends Error {
  constructor(message) { super(message); this.name = 'TaskLimitError'; }
}
