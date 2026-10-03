'use client';

import React, { useState, useMemo } from 'react';
import {
  Search,
  SlidersHorizontal,
  Download,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
} from 'lucide-react';
import { EmptyState, TableLoadingSkeleton } from './States.js';

export interface ColumnDef<T> {
  id: string;
  header: string;
  cell?: (row: T) => React.ReactNode;
  accessorKey?: keyof T;
  sortable?: boolean;
  defaultVisible?: boolean;
}

export interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  loading?: boolean;
  total?: number;
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  searchPlaceholder?: string;
  filterSlot?: React.ReactNode;
  exportFilename?: string;
  hasMore?: boolean;
  onNextPage?: () => void;
  onPrevPage?: () => void;
  pageIndex?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
}

export function DataTable<T>({
  columns,
  data,
  loading = false,
  total,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  filterSlot,
  exportFilename = 'export.csv',
  hasMore = false,
  onNextPage,
  onPrevPage,
  pageIndex = 0,
  emptyTitle = 'No records found',
  emptyDescription = 'Try adjusting your search or filters.',
  emptyAction,
}: DataTableProps<T>) {
  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    columns.forEach(col => {
      initial[col.id] = col.defaultVisible !== false;
    });
    return initial;
  });

  const [columnChooserOpen, setColumnChooserOpen] = useState(false);

  // Filter visible columns
  const activeColumns = useMemo(
    () => columns.filter(col => visibleColumns[col.id] !== false),
    [columns, visibleColumns],
  );

  // Export to CSV
  const handleExportCSV = () => {
    if (!data.length) return;

    const headers = activeColumns.map(c => `"${c.header.replace(/"/g, '""')}"`).join(',');
    const rows = data.map(row => {
      return activeColumns
        .map(c => {
          const val = c.accessorKey ? row[c.accessorKey] : '';
          const str = typeof val === 'object' ? JSON.stringify(val) : String(val ?? '');
          return `"${str.replace(/"/g, '""')}"`;
        })
        .join(',');
    });

    const csvContent = [headers, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', exportFilename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleColumn = (colId: string) => {
    setVisibleColumns(prev => ({
      ...prev,
      [colId]: !prev[colId],
    }));
  };

  return (
    <div className="space-y-4">
      {/* Top Toolbar: Search, Filters, Column Chooser, Export */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-3">
          {onSearchChange && (
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={searchValue || ''}
                onChange={e => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-border bg-card/60 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition"
              />
            </div>
          )}
          {filterSlot}
        </div>

        <div className="flex items-center gap-2">
          {/* Column Chooser Popover */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setColumnChooserOpen(!columnChooserOpen)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-border bg-card/60 hover:bg-muted/40 transition text-muted-foreground hover:text-foreground"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Columns
            </button>

            {columnChooserOpen && (
              <div className="absolute right-0 mt-2 w-52 p-3 rounded-xl border border-border bg-card shadow-xl z-30 space-y-2 animate-in fade-in">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block">
                  Toggle Columns
                </span>
                <div className="max-h-48 overflow-y-auto space-y-1.5 pt-1">
                  {columns.map(col => (
                    <label
                      key={col.id}
                      className="flex items-center gap-2 text-xs text-foreground cursor-pointer select-none hover:bg-muted/30 p-1 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={visibleColumns[col.id] !== false}
                        onChange={() => toggleColumn(col.id)}
                        className="rounded border-border text-primary focus:ring-primary"
                      />
                      <span>{col.header}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Export CSV */}
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={!data.length}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-border bg-card/60 hover:bg-muted/40 transition text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-muted-foreground">
                {activeColumns.map(col => (
                  <th
                    key={col.id}
                    className="py-3 px-4 font-semibold whitespace-nowrap select-none"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>{col.header}</span>
                      {col.sortable && <ArrowUpDown className="h-3 w-3 text-muted-foreground/60" />}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {loading ? (
                <tr>
                  <td colSpan={activeColumns.length} className="p-0">
                    <TableLoadingSkeleton rows={5} columns={activeColumns.length} />
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={activeColumns.length} className="py-8">
                    <EmptyState
                      title={emptyTitle}
                      description={emptyDescription}
                      action={emptyAction}
                    />
                  </td>
                </tr>
              ) : (
                data.map((row, rIdx) => (
                  <tr
                    key={String((row as { id?: unknown })?.id ?? rIdx)}
                    className="hover:bg-muted/20 transition-colors group"
                  >
                    {activeColumns.map(col => (
                      <td key={col.id} className="py-3.5 px-4 text-foreground/90 whitespace-nowrap">
                        {col.cell
                          ? col.cell(row)
                          : col.accessorKey
                            ? String((row as Record<string, unknown>)[col.accessorKey as string] ?? '-')
                            : '-'}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer / Keyset Pagination */}
        <div className="p-4 border-t border-border flex items-center justify-between gap-4 text-xs text-muted-foreground">
          <div>
            {total !== undefined ? (
              <span>
                Showing <strong className="text-foreground">{data.length}</strong> of{' '}
                <strong className="text-foreground">{total}</strong> records
              </span>
            ) : (
              <span>
                Showing <strong className="text-foreground">{data.length}</strong> records
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onPrevPage && (
              <button
                type="button"
                onClick={onPrevPage}
                disabled={pageIndex === 0}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted/40 transition disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Previous
              </button>
            )}
            {onNextPage && (
              <button
                type="button"
                onClick={onNextPage}
                disabled={!hasMore}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted/40 transition disabled:opacity-40"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
