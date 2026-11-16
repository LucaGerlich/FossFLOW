/** Injection token for the sender of alert messages. */
export const DELIVERIES = Symbol('DELIVERIES');

/** Tells a rule's channels about an event; the evaluator never waits for it. */
export interface Deliveries {
  notify(eventId: string, state: 'firing' | 'reminder' | 'resolved'): Promise<void>;
}
