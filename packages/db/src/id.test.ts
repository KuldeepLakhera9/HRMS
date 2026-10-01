import { describe, it, expect } from 'vitest';
import { generateUuidV7 } from './id.js';

describe('UUIDv7 Generator', () => {
  it('generates a valid UUIDv7 string with correct format', () => {
    const id = generateUuidV7();
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(id).toMatch(uuidRegex);
  });

  it('generates time-ordered UUIDs', async () => {
    const id1 = generateUuidV7();
    await new Promise(res => setTimeout(res, 2));
    const id2 = generateUuidV7();

    expect(id1 < id2).toBe(true);
  });
});
