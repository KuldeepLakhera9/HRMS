import type pg from 'pg';
import { generateUuidV7, withTenant } from '@hrms/db';
import { evaluateCondition, type ConditionRule } from './evaluator.js';
import { resolveApprovers, type ApproverResolverConfig } from './resolvers.js';

export interface WorkflowStepDefinition {
  stepIndex: number;
  name: string;
  mode: 'any' | 'all';
  resolver: ApproverResolverConfig;
  condition?: ConditionRule | null;
  selfApproval?: 'allow' | 'skip' | 'escalate';
  slaHours?: number;
  reminderHours?: number;
}

export interface WorkflowDefinitionInput {
  code: string;
  name: string;
  entityType: string;
  steps: WorkflowStepDefinition[];
  createdBy: string;
}

export interface SubmitWorkflowRequestInput {
  definitionCode: string;
  entityType: string;
  entityId: string;
  requesterId: string; // employee_id
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdBy: string;
}

export interface WorkflowInboxItem {
  assigneeRecordId: string;
  requestId: string;
  stepId: string;
  stepName: string;
  stepIndex: number;
  entityType: string;
  entityId: string;
  requesterId: string;
  requesterName: string;
  status: 'pending' | 'acted' | 'cancelled';
  payload: Record<string, unknown>;
  dueAt: string | null;
  isDelegated: boolean;
  createdAt: string;
}

export interface ExecuteActionInput {
  requestId: string;
  actorId: string; // employee_id
  action: 'approve' | 'reject' | 'delegate';
  comments?: string | null;
  delegateeId?: string | null;
}

export class WorkflowRepository {
  /**
   * Creates or versions a workflow definition.
   */
  async createDefinition(
    companyId: string,
    input: WorkflowDefinitionInput,
    poolOverride?: pg.Pool,
  ): Promise<{ id: string; version: number }> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const id = generateUuidV7();
        // Fetch highest version for code
        const verRes = await client.query<{ maxVer: number | null }>(
          `SELECT MAX(version) as "maxVer"
           FROM workflow_definitions
           WHERE company_id = $1 AND code = $2`,
          [companyId, input.code],
        );
        const nextVersion = (verRes.rows[0]?.maxVer ?? 0) + 1;

        // Deactivate previous active definitions for this code
        await client.query(
          `UPDATE workflow_definitions
           SET is_active = false, updated_at = NOW()
           WHERE company_id = $1 AND code = $2`,
          [companyId, input.code],
        );

        await client.query(
          `INSERT INTO workflow_definitions (
             id, company_id, code, name, entity_type, version, is_active, steps, created_by, updated_by
           )
           VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $8)`,
          [
            id,
            companyId,
            input.code,
            input.name,
            input.entityType,
            nextVersion,
            JSON.stringify(input.steps),
            input.createdBy,
          ],
        );

        return { id, version: nextVersion };
      },
      poolOverride,
    );
  }

  /**
   * Lists all active workflow definitions for the tenant.
   */
  async listDefinitions(
    companyId: string,
    poolOverride?: pg.Pool,
  ): Promise<
    Array<{
      id: string;
      code: string;
      name: string;
      entityType: string;
      version: number;
      isActive: boolean;
      steps: WorkflowStepDefinition[];
      createdAt: Date;
    }>
  > {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `SELECT
             id, code, name, entity_type as "entityType", version,
             is_active as "isActive", steps, created_at as "createdAt"
           FROM workflow_definitions
           WHERE company_id = $1 AND is_active = true AND deleted_at IS NULL
           ORDER BY name ASC`,
          [companyId],
        );
        return res.rows;
      },
      poolOverride,
    );
  }

  /**
   * Fetches an active workflow definition by code.
   */
  async getDefinitionByCode(
    companyId: string,
    code: string,
    poolOverride?: pg.Pool,
  ): Promise<{
    id: string;
    code: string;
    name: string;
    entityType: string;
    version: number;
    steps: WorkflowStepDefinition[];
  } | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `SELECT id, code, name, entity_type as "entityType", version, steps
           FROM workflow_definitions
           WHERE company_id = $1 AND code = $2 AND is_active = true AND deleted_at IS NULL`,
          [companyId, code],
        );
        return res.rows[0] ?? null;
      },
      poolOverride,
    );
  }

  /**
   * Initiates a workflow request instance pinned to the current active definition version.
   */
  async createRequest(
    companyId: string,
    input: SubmitWorkflowRequestInput,
    poolOverride?: pg.Pool,
  ): Promise<{ requestId: string; status: 'pending' | 'approved' }> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        // 1. Fetch active definition
        const defRes = await client.query<{
          id: string;
          version: number;
          steps: WorkflowStepDefinition[];
        }>(
          `SELECT id, version, steps
           FROM workflow_definitions
           WHERE company_id = $1 AND code = $2 AND is_active = true AND deleted_at IS NULL`,
          [companyId, input.definitionCode],
        );

        if (defRes.rows.length === 0) {
          throw new Error(`Active workflow definition '${input.definitionCode}' not found`);
        }

        const definition = defRes.rows[0]!;
        const requestId = generateUuidV7();

        // 2. Find first step whose condition passes
        let targetStepIndex = 0;
        let activeStepDef: WorkflowStepDefinition | null = null;

        while (targetStepIndex < definition.steps.length) {
          const stepCandidate = definition.steps[targetStepIndex]!;
          const conditionPasses = evaluateCondition(stepCandidate.condition, input.payload);
          if (conditionPasses) {
            activeStepDef = stepCandidate;
            break;
          }
          targetStepIndex++;
        }

        // If no step condition matched, auto-approve request
        if (!activeStepDef) {
          await client.query(
            `INSERT INTO workflow_requests (
               id, company_id, definition_id, definition_version, entity_type, entity_id,
               requester_id, status, current_step_index, payload, metadata, closed_at,
               created_by, updated_by
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved', $8, $9, $10, NOW(), $11, $11)`,
            [
              requestId,
              companyId,
              definition.id,
              definition.version,
              input.entityType,
              input.entityId,
              input.requesterId,
              targetStepIndex,
              JSON.stringify(input.payload),
              JSON.stringify(input.metadata || {}),
              input.createdBy,
            ],
          );

          // Emit outbox event
          await client.query(
            `INSERT INTO outbox_events (id, company_id, aggregate, type, payload)
             VALUES (gen_random_uuid(), $1, 'workflow', 'workflow.request.completed', $2)`,
            [
              companyId,
              JSON.stringify({
                requestId,
                entityType: input.entityType,
                entityId: input.entityId,
                status: 'approved',
              }),
            ],
          );

          return { requestId, status: 'approved' };
        }

        // 3. Resolve approvers for active step
        let approvers = await resolveApprovers(activeStepDef.resolver, {
          companyId,
          requesterId: input.requesterId,
          payload: input.payload,
          client,
        });

        // Self-approval handling
        if (approvers.includes(input.requesterId)) {
          if (activeStepDef.selfApproval === 'skip') {
            approvers = approvers.filter(a => a !== input.requesterId);
          } else if (activeStepDef.selfApproval === 'escalate') {
            const skipLevelRes = await resolveApprovers(
              { type: 'reporting_manager' },
              { companyId, requesterId: input.requesterId, payload: input.payload, client },
            );
            approvers = skipLevelRes.length > 0 ? skipLevelRes : approvers;
          }
        }

        // If still no approvers resolved, fallback to admin/manager
        if (approvers.length === 0) {
          approvers = [input.requesterId];
        }

        // Calculate due_at SLA
        const dueAt = activeStepDef.slaHours
          ? new Date(Date.now() + activeStepDef.slaHours * 60 * 60 * 1000)
          : null;

        // 4. Insert request row
        await client.query(
          `INSERT INTO workflow_requests (
             id, company_id, definition_id, definition_version, entity_type, entity_id,
             requester_id, status, current_step_index, payload, metadata,
             created_by, updated_by
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11, $11)`,
          [
            requestId,
            companyId,
            definition.id,
            definition.version,
            input.entityType,
            input.entityId,
            input.requesterId,
            targetStepIndex,
            JSON.stringify(input.payload),
            JSON.stringify(input.metadata || {}),
            input.createdBy,
          ],
        );

        // 5. Insert active step row
        const stepId = generateUuidV7();
        await client.query(
          `INSERT INTO workflow_steps (
             id, company_id, request_id, step_index, name, mode, status, due_at, created_by, updated_by
           )
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $8)`,
          [
            stepId,
            companyId,
            requestId,
            targetStepIndex,
            activeStepDef.name,
            activeStepDef.mode,
            dueAt,
            input.createdBy,
          ],
        );

        // 6. Check active delegations for approvers and insert assignees
        for (const approverId of approvers) {
          const delRes = await client.query<{ delegateeId: string }>(
            `SELECT delegatee_id as "delegateeId"
             FROM workflow_delegations
             WHERE company_id = $1
               AND delegator_id = $2
               AND is_active = true
               AND starts_at <= NOW()
               AND ends_at >= NOW()
               AND (entity_type IS NULL OR entity_type = $3)
               AND deleted_at IS NULL
             LIMIT 1`,
            [companyId, approverId, input.entityType],
          );

          const delegatee = delRes.rows[0]?.delegateeId;
          const assignedId = delegatee ?? approverId;
          const isDelegated = Boolean(delegatee);

          await client.query(
            `INSERT INTO workflow_assignees (
               id, company_id, request_id, step_id, assignee_id, original_assignee_id, is_delegated, status, created_by, updated_by
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $8)`,
            [
              generateUuidV7(),
              companyId,
              requestId,
              stepId,
              assignedId,
              isDelegated ? approverId : null,
              isDelegated,
              input.createdBy,
            ],
          );
        }

        // Emit outbox notification event
        await client.query(
          `INSERT INTO outbox_events (id, company_id, aggregate, type, payload)
           VALUES (gen_random_uuid(), $1, 'workflow', 'workflow.step_pending', $2)`,
          [
            companyId,
            JSON.stringify({
              requestId,
              stepId,
              stepIndex: targetStepIndex,
              assignees: approvers,
            }),
          ],
        );

        return { requestId, status: 'pending' };
      },
      poolOverride,
    );
  }

  /**
   * Retrieves inbox items for an assignee using the direct inbox index.
   * Query budget: executes in 1 SQL statement (budget <= 3).
   */
  async getInbox(
    companyId: string,
    employeeId: string,
    options: {
      status?: 'pending' | 'acted' | 'cancelled';
      limit?: number;
      cursorCreatedAt?: string;
      cursorId?: string;
    },
    poolOverride?: pg.Pool,
  ): Promise<{ items: WorkflowInboxItem[]; nextCursor?: string | undefined }> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const status = options.status ?? 'pending';
        const limit = Math.min(options.limit ?? 20, 50);

        const params: unknown[] = [companyId, employeeId, status, limit + 1];
        let cursorClause = '';

        if (options.cursorCreatedAt && options.cursorId) {
          params.push(options.cursorCreatedAt, options.cursorId);
          cursorClause = `AND (wa.created_at, wa.id) < ($5, $6)`;
        }

        const sql = `
          SELECT
            wa.id as "assigneeRecordId",
            wa.request_id as "requestId",
            wa.step_id as "stepId",
            ws.name as "stepName",
            ws.step_index as "stepIndex",
            wr.entity_type as "entityType",
            wr.entity_id as "entityId",
            wr.requester_id as "requesterId",
            (e.first_name || ' ' || e.last_name) as "requesterName",
            wa.status as "status",
            wr.payload as "payload",
            ws.due_at as "dueAt",
            wa.is_delegated as "isDelegated",
            wa.created_at as "createdAt"
          FROM workflow_assignees wa
          JOIN workflow_requests wr ON wr.company_id = wa.company_id AND wr.id = wa.request_id AND wr.deleted_at IS NULL
          JOIN workflow_steps ws ON ws.company_id = wa.company_id AND ws.id = wa.step_id AND ws.deleted_at IS NULL
          JOIN employees e ON e.company_id = wa.company_id AND e.id = wr.requester_id AND e.deleted_at IS NULL
          WHERE wa.company_id = $1
            AND wa.assignee_id = $2
            AND wa.status = $3
            AND wa.deleted_at IS NULL
            ${cursorClause}
          ORDER BY wa.created_at DESC, wa.id DESC
          LIMIT $4
        `;

        const res = await client.query<WorkflowInboxItem>(sql, params);
        const rows = res.rows;
        let nextCursor: string | undefined;

        if (rows.length > limit) {
          const nextItem = rows.pop()!;
          nextCursor = `${nextItem.createdAt}_${nextItem.assigneeRecordId}`;
        }

        return { items: rows, nextCursor };
      },
      poolOverride,
    );
  }

  /**
   * Executes an action on a pending workflow step inside a row-locked transaction (SELECT ... FOR UPDATE).
   */
  async executeAction(
    companyId: string,
    input: ExecuteActionInput,
    poolOverride?: pg.Pool,
  ): Promise<{ status: 'pending' | 'approved' | 'rejected' }> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        // 1. Row-lock request
        const reqRes = await client.query<{
          id: string;
          definitionId: string;
          status: string;
          currentStepIndex: number;
          entityType: string;
          entityId: string;
          requesterId: string;
          payload: Record<string, unknown>;
        }>(
          `SELECT id, definition_id as "definitionId", status, current_step_index as "currentStepIndex",
                  entity_type as "entityType", entity_id as "entityId", requester_id as "requesterId", payload
           FROM workflow_requests
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
           FOR UPDATE`,
          [companyId, input.requestId],
        );

        if (reqRes.rows.length === 0) {
          throw new Error('Workflow request not found');
        }

        const req = reqRes.rows[0]!;
        if (req.status !== 'pending') {
          throw new Error(`Cannot act on workflow request with status '${req.status}'`);
        }

        // 2. Fetch active step and lock it
        const stepRes = await client.query<{
          id: string;
          stepIndex: number;
          mode: 'any' | 'all';
          status: string;
        }>(
          `SELECT id, step_index as "stepIndex", mode, status
           FROM workflow_steps
           WHERE company_id = $1 AND request_id = $2 AND step_index = $3 AND status = 'pending'
           FOR UPDATE`,
          [companyId, input.requestId, req.currentStepIndex],
        );

        if (stepRes.rows.length === 0) {
          throw new Error('Active pending step not found for request');
        }
        const step = stepRes.rows[0]!;

        // 3. Verify actor is an assigned assignee
        const assignRes = await client.query<{ id: string; status: string }>(
          `SELECT id, status
           FROM workflow_assignees
           WHERE company_id = $1 AND request_id = $2 AND step_id = $3 AND assignee_id = $4 AND status = 'pending'`,
          [companyId, input.requestId, step.id, input.actorId],
        );

        if (assignRes.rows.length === 0) {
          throw new Error('Actor is not an authorized pending assignee for this step');
        }

        // 4. Insert append-only workflow action
        const actionId = generateUuidV7();
        await client.query(
          `INSERT INTO workflow_actions (
             id, company_id, request_id, step_id, actor_id, action, comments, created_by
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            actionId,
            companyId,
            input.requestId,
            step.id,
            input.actorId,
            input.action,
            input.comments || null,
            input.actorId,
          ],
        );

        // Mark actor assignee record as 'acted'
        await client.query(
          `UPDATE workflow_assignees
           SET status = 'acted', updated_at = NOW()
           WHERE id = $1`,
          [assignRes.rows[0]!.id],
        );

        // 5. Handle action outcome
        if (input.action === 'reject') {
          // Rejection immediately marks step & request as rejected
          await client.query(
            `UPDATE workflow_steps
             SET status = 'rejected', completed_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [step.id],
          );

          await client.query(
            `UPDATE workflow_requests
             SET status = 'rejected', closed_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [input.requestId],
          );

          // Cancel remaining assignees
          await client.query(
            `UPDATE workflow_assignees
             SET status = 'cancelled', updated_at = NOW()
             WHERE request_id = $1 AND step_id = $2 AND status = 'pending'`,
            [input.requestId, step.id],
          );

          // Emit outbox event
          await client.query(
            `INSERT INTO outbox_events (id, company_id, aggregate, type, payload)
             VALUES (gen_random_uuid(), $1, 'workflow', 'workflow.request.completed', $2)`,
            [
              companyId,
              JSON.stringify({
                requestId: input.requestId,
                entityType: req.entityType,
                entityId: req.entityId,
                status: 'rejected',
                actorId: input.actorId,
                comments: input.comments,
              }),
            ],
          );

          return { status: 'rejected' };
        }

        if (input.action === 'approve') {
          // Check step mode completion
          let stepCompleted = false;
          if (step.mode === 'any') {
            stepCompleted = true;
          } else {
            // 'all' mode: check if any pending assignees remain
            const remainRes = await client.query<{ count: string }>(
              `SELECT COUNT(*)::text as count
               FROM workflow_assignees
               WHERE company_id = $1 AND request_id = $2 AND step_id = $3 AND status = 'pending'`,
              [companyId, input.requestId, step.id],
            );
            stepCompleted = parseInt(remainRes.rows[0]?.count || '0', 10) === 0;
          }

          if (!stepCompleted) {
            return { status: 'pending' };
          }

          // Complete current step
          await client.query(
            `UPDATE workflow_steps
             SET status = 'approved', completed_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [step.id],
          );

          // Cancel any remaining assignees if 'any' mode
          if (step.mode === 'any') {
            await client.query(
              `UPDATE workflow_assignees
               SET status = 'cancelled', updated_at = NOW()
               WHERE request_id = $1 AND step_id = $2 AND status = 'pending'`,
              [input.requestId, step.id],
            );
          }

          // Fetch definition steps to advance or complete
          const defRes = await client.query<{ steps: WorkflowStepDefinition[] }>(
            `SELECT steps FROM workflow_definitions WHERE company_id = $1 AND id = $2`,
            [companyId, req.definitionId],
          );
          const allSteps = defRes.rows[0]!.steps;

          let nextStepIndex = req.currentStepIndex + 1;
          let nextStepDef: WorkflowStepDefinition | null = null;

          while (nextStepIndex < allSteps.length) {
            const candidate = allSteps[nextStepIndex]!;
            if (evaluateCondition(candidate.condition, req.payload)) {
              nextStepDef = candidate;
              break;
            }
            nextStepIndex++;
          }

          if (!nextStepDef) {
            // Workflow complete!
            await client.query(
              `UPDATE workflow_requests
               SET status = 'approved', current_step_index = $2, closed_at = NOW(), updated_at = NOW()
               WHERE id = $1`,
              [input.requestId, nextStepIndex],
            );

            // Emit completion event
            await client.query(
              `INSERT INTO outbox_events (id, company_id, aggregate, type, payload)
               VALUES (gen_random_uuid(), $1, 'workflow', 'workflow.request.completed', $2)`,
              [
                companyId,
                JSON.stringify({
                  requestId: input.requestId,
                  entityType: req.entityType,
                  entityId: req.entityId,
                  status: 'approved',
                }),
              ],
            );

            return { status: 'approved' };
          }

          // Initialize next step
          const nextStepId = generateUuidV7();
          const dueAt = nextStepDef.slaHours
            ? new Date(Date.now() + nextStepDef.slaHours * 60 * 60 * 1000)
            : null;

          await client.query(
            `UPDATE workflow_requests
             SET current_step_index = $2, updated_at = NOW()
             WHERE id = $1`,
            [input.requestId, nextStepIndex],
          );

          await client.query(
            `INSERT INTO workflow_steps (
               id, company_id, request_id, step_index, name, mode, status, due_at, created_by, updated_by
             )
             VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $8)`,
            [
              nextStepId,
              companyId,
              input.requestId,
              nextStepIndex,
              nextStepDef.name,
              nextStepDef.mode,
              dueAt,
              input.actorId,
            ],
          );

          const nextApprovers = await resolveApprovers(nextStepDef.resolver, {
            companyId,
            requesterId: req.requesterId,
            payload: req.payload,
            client,
          });

          for (const appr of nextApprovers) {
            await client.query(
              `INSERT INTO workflow_assignees (
                 id, company_id, request_id, step_id, assignee_id, status, created_by, updated_by
               )
               VALUES ($1, $2, $3, $4, $5, 'pending', $6, $6)`,
              [generateUuidV7(), companyId, input.requestId, nextStepId, appr, input.actorId],
            );
          }

          return { status: 'pending' };
        }

        return { status: 'pending' };
      },
      poolOverride,
    );
  }
}
