export type AlertTarget =
  | { type: 'arrow'; from: string; to: string }
  | { type: 'box'; identity: string };

/**
 * Everything a notification may say. There is deliberately no operation,
 * status or member field: the type is what keeps that data out of messages.
 */
export interface AlertMessage {
  state: 'firing' | 'reminder' | 'resolved' | 'test';
  kind: 'failing' | 'slow' | 'silent' | null;
  ruleId: string | null;
  ruleName: string;
  projectName: string;
  target: AlertTarget | null;
  value: number | null;
  threshold: number | null;
  windowMinutes: number | null;
  calls: number | null;
  sinceMinutes: number | null;
  startedAt: string | null;
  durationMinutes: number | null;
  url: string;
}

const count = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

export function formatCount(value: number): string {
  return count.format(value);
}

/** `35 min`, `2 h`, `2 h 5 min`. */
export function formatMinutes(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** `95 ms`, `1.2 s`, `35 min`, `2 h 5 min`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${decimal.format(ms / 1000)} s`;
  return formatMinutes(ms / 60_000);
}

const STILL = { failing: 'Still failing', slow: 'Still slow', silent: 'Still silent' } as const;
const FIRST = { failing: 'Failing', slow: 'Slow', silent: 'Silent' } as const;

function detail(message: AlertMessage): string {
  const { kind, value, threshold, windowMinutes, calls, sinceMinutes } = message;
  const parts: string[] = [];
  if (kind === 'failing') {
    if (value !== null && calls !== null && windowMinutes !== null) {
      parts.push(`${decimal.format(value)}% of ${formatCount(calls)} calls failed in the last ${windowMinutes} min`);
    }
    if (threshold !== null) parts.push(`(threshold ${decimal.format(threshold)}%)`);
  } else if (kind === 'slow') {
    if (value !== null && calls !== null && windowMinutes !== null) {
      parts.push(`p95 ${formatDuration(value)} over ${formatCount(calls)} calls in the last ${windowMinutes} min`);
    }
    if (threshold !== null) parts.push(`(threshold ${formatDuration(threshold)})`);
  } else if (kind === 'silent') {
    if (sinceMinutes !== null) parts.push(`no calls for ${formatMinutes(sinceMinutes)}`);
    if (threshold !== null) parts.push(`(threshold ${formatMinutes(threshold)})`);
  }
  return parts.join(' ');
}

/** The first line of every notification. */
export function alertLine(message: AlertMessage): string {
  if (message.state === 'test') {
    return `Test · ${message.projectName} · FossFLOW alerts will arrive here`;
  }
  const { kind } = message;
  if (message.state === 'resolved') {
    const duration =
      message.durationMinutes === null ? '' : ` for ${formatMinutes(message.durationMinutes)}`;
    return `Resolved · ${message.ruleName} · ${kind ?? 'alert'}${duration}`;
  }
  const lead = kind === null ? 'Alert' : (message.state === 'reminder' ? STILL : FIRST)[kind];
  return `${lead} · ${message.ruleName} · ${detail(message)}`.trimEnd();
}

/** First line, then the link; the plain-text body shared by Slack. */
export function alertText(message: AlertMessage): string {
  return `${alertLine(message)}\n${message.url}`;
}
