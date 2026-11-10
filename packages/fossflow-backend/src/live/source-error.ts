/** Error whose message is safe to show to API clients and logs. */
export class LiveSourceError extends Error {
  override name = 'LiveSourceError';
}
