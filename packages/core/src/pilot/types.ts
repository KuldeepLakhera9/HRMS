export interface FeatureFlagRules {
  departments?: string[];
  users?: string[];
  percentage?: number;
}

export interface FeatureFlagItem {
  id: string;
  companyId: string;
  key: string;
  name: string;
  description?: string | null;
  isEnabled: boolean;
  rules: FeatureFlagRules;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFeatureFlagInput {
  key: string;
  name: string;
  description?: string | null;
  isEnabled?: boolean;
  rules?: FeatureFlagRules;
}

export interface UpdateFeatureFlagInput {
  name?: string;
  description?: string;
  isEnabled?: boolean;
  rules?: FeatureFlagRules;
}

export interface FeedbackSubmissionItem {
  id: string;
  companyId: string;
  userId: string;
  userEmail?: string;
  rating: number;
  category: string;
  pageContext?: string | null;
  message: string;
  createdAt: Date;
}

export interface CreateFeedbackInput {
  rating: number;
  category?: string;
  pageContext?: string | null;
  message: string;
}

export interface PilotMetrics {
  adoptionRate: number; // 0-100 %
  activeEmployees: number;
  totalEmployees: number;
  channelSplit: {
    mobile: number;
    web: number;
    kiosk: number;
  };
  regularizationRate: number; // 0-100 %
  avgApprovalTurnaroundHours: number;
  csatScore: number; // 1-5 scale
  totalFeedbackCount: number;
  failureReasons: Array<{ reason: string; count: number }>;
}
