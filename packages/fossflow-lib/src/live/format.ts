/** Compact number formatting for the live overlay (language-neutral units). */

const oneDecimal = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function formatMemoryMb(megabytes: number): string {
  if (megabytes >= 1024) return `${oneDecimal(megabytes / 1024)} GB`;
  return `${Math.round(megabytes)} MB`;
}

export function formatBytesPerSec(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${oneDecimal(bytes / 1024 ** 3)} GB/s`;
  if (bytes >= 1024 ** 2) return `${oneDecimal(bytes / 1024 ** 2)} MB/s`;
  if (bytes >= 1024) return `${oneDecimal(bytes / 1024)} KB/s`;
  return `${Math.round(bytes)} B/s`;
}

export function formatUptime(seconds: number): string {
  if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)} d`;
  if (seconds >= 3_600) return `${Math.floor(seconds / 3_600)} h`;
  return `${Math.max(0, Math.floor(seconds / 60))} min`;
}
