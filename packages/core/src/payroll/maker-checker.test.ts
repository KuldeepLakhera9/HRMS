import { describe, it, expect } from 'vitest';
import { ForbiddenError, ValidationError } from '@hrms/shared';
import { assertSegregationOfDuties, assertCanApproveStatus } from './maker-checker.js';

describe('Maker-Checker & Segregation of Duties', () => {
  it('allows approval when maker and approver are different users', () => {
    expect(() => {
      assertSegregationOfDuties('user-maker-1', 'user-checker-2', 'salary structure');
    }).not.toThrow();
  });

  it('throws ForbiddenError when maker attempts to approve their own record', () => {
    expect(() => {
      assertSegregationOfDuties('user-maker-1', 'user-maker-1', 'salary structure');
    }).toThrow(ForbiddenError);

    expect(() => {
      assertSegregationOfDuties('user-maker-1', 'user-maker-1', 'salary structure');
    }).toThrow(/Segregation of duties violation/);
  });

  it('allows approval when maker is not set', () => {
    expect(() => {
      assertSegregationOfDuties(null, 'user-checker-2', 'salary structure');
    }).not.toThrow();
  });

  it('bypasses SoD when strict mode is explicitly set to false', () => {
    expect(() => {
      assertSegregationOfDuties('user-maker-1', 'user-maker-1', 'salary structure', { strict: false });
    }).not.toThrow();
  });

  it('validates allowed status transitions for approval', () => {
    expect(() => {
      assertCanApproveStatus('pending_approval', ['draft', 'pending_approval']);
    }).not.toThrow();

    expect(() => {
      assertCanApproveStatus('approved', ['draft', 'pending_approval']);
    }).toThrow(ValidationError);
  });
});
