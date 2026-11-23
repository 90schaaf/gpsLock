/**
 * Commands of other extensions known from their public manifests (2026-11-23).
 * Used by the config page before a lock exists; at runtime the worker discovers the
 * lock's real capabilities via GET /api/extensions/sessions/{id}/capabilities.
 */
export interface KnownCommand {
  id: string;
  extension: string;
  title: string;
  description: string;
  exampleInput: Record<string, unknown>;
}

export const KNOWN_COMMANDS: KnownCommand[] = [
  {
    id: 'tasks.assign',
    extension: 'Tasks',
    title: 'Assign a task',
    description: 'Assigns a task to the wearer (prefer the dedicated "Task" consequence).',
    exampleInput: { task: { task: 'Walk 2 km', points: 1 } },
  },
  {
    id: 'penalty.increment',
    extension: 'Penalties',
    title: 'Increment a penalty counter',
    description: 'Counts a punishable action for a habit configured in the Penalties extension.',
    exampleInput: {},
  },
  {
    id: 'verification-picture.request',
    extension: 'Verification picture',
    title: 'Request verification picture',
    description: 'Asks the wearer for a new verification picture.',
    exampleInput: {},
  },
  {
    id: 'temporary-opening.open',
    extension: 'Hygiene opening',
    title: 'Temporary opening',
    description: 'Temporarily opens the lock (e.g. as a reward).',
    exampleInput: {},
  },
];

/**
 * Extensions the product owner wants to control but which publish no commands yet.
 * Shown in the UI as "coming soon – will appear automatically once available".
 */
export const PLANNED_EXTENSIONS = ['Find the key', 'Jigsaw puzzle', 'Reward store', 'Typing lines'];
