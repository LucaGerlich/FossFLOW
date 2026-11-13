import { fill, formatMs, formatPct, formatRate } from 'src/traffic/format';

describe('traffic format', () => {
  it('formats a rate with one decimal below 10', () => {
    expect(formatRate(210)).toBe('210/min');
    expect(formatRate(4.2)).toBe('4.2/min');
    expect(formatRate(209.6)).toBe('210/min');
  });

  it('formats durations in ms, or seconds from 1000', () => {
    expect(formatMs(95)).toBe('95 ms');
    expect(formatMs(999.4)).toBe('999 ms');
    expect(formatMs(1000)).toBe('1.0 s');
    expect(formatMs(1234)).toBe('1.2 s');
  });

  it('formats a percentage with one decimal', () => {
    expect(formatPct(4.1)).toBe('4.1%');
    expect(formatPct(6.095)).toBe('6.1%');
  });

  it('fills {placeholders} and keeps unknown ones', () => {
    expect(fill('{a}-{b}', { a: '1', b: '2' })).toBe('1-2');
    expect(fill('{a}-{c}', { a: '1' })).toBe('1-{c}');
  });
});
