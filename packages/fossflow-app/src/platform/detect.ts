export interface PlatformStatus {
  platform: true;
  setupRequired: boolean;
  mailEnabled: boolean;
}

/**
 * Platform mode when a FossFLOW server answers; otherwise the app runs as the
 * plain local editor (static hosting, no backend).
 */
export async function detectPlatform(timeoutMs = 3000): Promise<PlatformStatus | null> {
  try {
    const response = await fetch('/api/platform/status', {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<PlatformStatus>;
    return body.platform === true ? (body as PlatformStatus) : null;
  } catch {
    return null;
  }
}
