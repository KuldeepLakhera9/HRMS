# ADR 0014: Payroll Run State Transition Permission Mapping

## Status
Accepted

## Context
Phase 4 Spec section 3 defines the payroll run lifecycle with the following states:
`draft -> inputs_ready -> calculating -> calculated -> review -> approved -> locking -> locked -> published -> paid` (and terminal `cancelled`).
In the Phase 4 permission catalog, permissions exist for `payroll.run.create`, `payroll.run.read`, `payroll.run.calculate`, `payroll.run.review`, `payroll.run.approve`, `payroll.run.lock`, and `payroll.run.publish`. However, there is no discrete `payroll.run.pay` permission defined prior to Sprint 4.4 banking/payout integrations.

## Decision
1. **Target Permission Mapping (`TARGET_PERMISSIONS`)**:
   - `draft`: `payroll.run.create`, `payroll.run.calculate`
   - `inputs_ready`: `payroll.run.create`, `payroll.run.calculate`
   - `calculating`: `payroll.run.calculate`
   - `calculated`: `payroll.run.calculate`
   - `review`: `payroll.run.review`, `payroll.run.calculate`
   - `approved`: `payroll.run.approve` (Maker-Checker enforced: approver cannot be the run creator)
   - `locking`: `payroll.run.lock`
   - `locked`: `payroll.run.lock`
   - `published`: `payroll.run.publish`
   - `paid`: `payroll.run.publish` (mapped to `payroll.run.publish` pending dedicated banking/payout file generation permissions in Sprint 4.4)
   - `cancelled`: `payroll.run.create`, `payroll.run.calculate`

2. **Unlock Transition (`locked -> review`)**:
   - Requires `payroll.run.lock` and must satisfy dual-authorization: either a different user with `payroll.run.approve` as `secondApproverId`, or elevated emergency authorization, with step-up MFA and audit logging.

## Consequences
- Clean separation of duties between makers, reviewers, and approvers.
- Fully compatible with future Sprint 4.4 banking payout permission extensions.
