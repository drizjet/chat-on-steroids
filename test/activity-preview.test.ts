import { describe, expect, it } from 'vitest';
import { activityStoredPreview } from '../src/main/bridge/activity-view.js';

type Stored = Parameters<typeof activityStoredPreview>[0];
const stored = (text: string): Stored => ({ text, chars: text.length, truncated: false } as unknown as Stored);

describe('activity preview scrubbing', () => {
  it('omits base64 image bodies', () => {
    const preview = activityStoredPreview(stored('data:image/png;base64,' + 'A'.repeat(400)), true);
    expect(preview.text).toContain('binary payload omitted');
    expect(preview.text).not.toContain('A'.repeat(60));
  });

  it('keeps readable MCP text and drops media blocks', () => {
    const text = JSON.stringify({ content: [{ type: 'text', text: 'hello' }, { type: 'image', data: 'x'.repeat(300) }] });
    const preview = activityStoredPreview(stored(text), true);
    expect(preview.text).toContain('hello');
    expect(preview.text).not.toContain('x'.repeat(60));
  });

  it('leaves ordinary prose untouched', () => {
    const prose = 'The quick brown fox jumps over the lazy dog. '.repeat(40);
    expect(activityStoredPreview(stored(prose)).text).toBe(prose);
  });
});
