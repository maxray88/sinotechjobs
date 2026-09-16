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

const VALID_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  applied: ['screening', 'interview', 'offer', 'rejected'],
  screening: ['interview', 'offer', 'rejected'],
  interview: ['offer', 'rejected'],
  offer: ['rejected'],
  rejected: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  if (from === to) return false;
  return VALID_TRANSITIONS[from].includes(to);
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
  return VALID_TRANSITIONS[status];
}

export function isTerminalStatus(status: ApplicationStatus): boolean {
  return VALID_TRANSITIONS[status].length === 0;
}

export { VALID_TRANSITIONS };
