/**
 * Job application status state machine (pure functions).
 *
 * Ported from the design reference application-state-machine.ts.
 * Flow: applied → screening → interview → offer, with rejection
 * possible from any non-terminal state. `rejected` is terminal.
 */

export type ApplicationStatus =
  | 'applied'
  | 'screening'
  | 'interview'
  | 'offer'
  | 'rejected';

/** Freezes a transition list while keeping the ApplicationStatus literal type. */
function frozenTransitions(...items: ApplicationStatus[]): readonly ApplicationStatus[] {
  return Object.freeze(items);
}

// Frozen so no importer can mutate the table through the re-export, and so
// getValidTransitions can never hand out the live inner arrays.
const VALID_TRANSITIONS = Object.freeze({
  applied: frozenTransitions('screening', 'interview', 'offer', 'rejected'),
  screening: frozenTransitions('interview', 'offer', 'rejected'),
  interview: frozenTransitions('offer', 'rejected'),
  offer: frozenTransitions('rejected'),
  rejected: frozenTransitions(),
}) satisfies Readonly<Record<ApplicationStatus, readonly ApplicationStatus[]>>;

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  if (from === to) return false;
  // `from` is typed as ApplicationStatus, but these values arrive from a DB
  // column at runtime. An unknown source status is not a valid transition.
  const next = VALID_TRANSITIONS[from];
  return next ? next.includes(to) : false;
}

export function transition(
  currentStatus: ApplicationStatus,
  newStatus: ApplicationStatus,
): ApplicationStatus {
  if (!canTransition(currentStatus, newStatus)) {
    throw new Error(`Invalid status transition: ${currentStatus} → ${newStatus}`);
  }
  return newStatus;
}

export function getValidTransitions(status: ApplicationStatus): ApplicationStatus[] {
  const next = VALID_TRANSITIONS[status];
  // Return a copy: callers must not be able to mutate the table in place.
  return next ? [...next] : [];
}

export function isTerminalStatus(status: ApplicationStatus): boolean {
  // An unknown status is deliberately NOT terminal: it is an unrecognised
  // value, not a confirmed end state, so failing safe keeps the workflow open
  // rather than silently retiring a candidate's application.
  const next = VALID_TRANSITIONS[status];
  return next ? next.length === 0 : false;
}

export { VALID_TRANSITIONS };
