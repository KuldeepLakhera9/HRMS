import { describe, it, expect } from 'vitest';
import { getLogger, createChildLogger } from './logger.js';

describe('Structured Logger', () => {
  it('creates and returns singleton logger instance', () => {
    const logger1 = getLogger();
    const logger2 = getLogger();
    expect(logger1).toBe(logger2);
  });

  it('creates child logger with context properties', () => {
    const child = createChildLogger({ requestId: 'req-456', companyId: 'comp-1' });
    expect(child).toBeDefined();
    expect(child.bindings().requestId).toBe('req-456');
    expect(child.bindings().companyId).toBe('comp-1');
  });
});
