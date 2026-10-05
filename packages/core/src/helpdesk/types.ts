export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface HelpdeskCategoryItem {
  id: string;
  companyId: string;
  name: string;
  code: string;
  defaultAssigneeRole: string;
  slaHours: number;
}

export interface HelpdeskTicketItem {
  id: string;
  companyId: string;
  ticketNumber: string;
  categoryId: string;
  categoryName?: string;
  subject: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  creatorUserId: string;
  creatorName?: string;
  assigneeUserId: string | null;
  assigneeName?: string | null;
  slaDueAt: Date;
  resolvedAt: Date | null;
  createdAt: Date;
  commentsCount?: number;
}

export interface HelpdeskCommentItem {
  id: string;
  companyId: string;
  ticketId: string;
  userId: string;
  userName?: string;
  commentMd: string;
  isInternal: boolean;
  createdAt: Date;
}

export interface CreateTicketInput {
  categoryId: string;
  subject: string;
  description: string;
  priority?: TicketPriority;
}

export interface AddCommentInput {
  commentMd: string;
  isInternal?: boolean;
}

export interface ListTicketsFilters {
  status?: TicketStatus;
  priority?: TicketPriority;
  categoryId?: string;
  assigneeUserId?: string;
}
