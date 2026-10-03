'use client';

import React from 'react';
import { AlertCircle, Inbox, RefreshCw } from 'lucide-react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({
  icon = <Inbox className="h-10 w-10 text-muted-foreground/60" />,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center rounded-2xl border border-dashed border-border bg-card/40 my-4">
      <div className="p-3 bg-muted/30 rounded-2xl mb-3 shadow-inner">{icon}</div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export interface LoadingSkeletonProps {
  rows?: number;
  columns?: number;
}

export function TableLoadingSkeleton({ rows = 5, columns = 5 }: LoadingSkeletonProps) {
  return (
    <div className="w-full space-y-3 py-2 animate-pulse">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 py-3 px-4 border-b border-border/50">
          {Array.from({ length: columns }).map((_, c) => (
            <div
              key={c}
              className="h-4 bg-muted/60 rounded-md"
              style={{ width: `${Math.max(15, (c + 1) * 18)}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export interface ErrorAlertProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorAlert({ title = 'Error', message, onRetry }: ErrorAlertProps) {
  return (
    <div className="p-4 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-3 my-3">
      <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
      <div className="flex-1 text-xs">
        <strong className="font-semibold block text-sm">{title}</strong>
        <span>{message}</span>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-destructive/20 hover:bg-destructive/30 transition"
        >
          <RefreshCw className="h-3 w-3" /> Retry
        </button>
      )}
    </div>
  );
}
