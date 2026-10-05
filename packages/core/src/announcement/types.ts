export interface AnnouncementItem {
  id: string;
  companyId: string;
  title: string;
  contentMd: string;
  audienceType: 'all' | 'department' | 'location';
  targetDeptId: string | null;
  targetLocId: string | null;
  isPinned: boolean;
  publishedAt: Date;
  expiresAt: Date | null;
  isRead?: boolean;
  readAt?: Date | null;
  createdAt: Date;
  createdBy: string;
}

export interface CreateAnnouncementInput {
  title: string;
  contentMd: string;
  audienceType?: 'all' | 'department' | 'location';
  targetDeptId?: string | null;
  targetLocId?: string | null;
  isPinned?: boolean;
  publishedAt?: Date;
  expiresAt?: Date | null;
}

export interface ListAnnouncementsFilters {
  includeExpired?: boolean;
  departmentId?: string;
  locationId?: string;
}
