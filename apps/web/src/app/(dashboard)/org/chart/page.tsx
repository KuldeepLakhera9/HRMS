'use client';

import React, { useEffect, useState, useRef } from 'react';
import {
  Network,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Search,
  ChevronDown,
  ChevronUp,
  User,
  Users,
  Building,
  Briefcase,
  Mail,
  Loader2,
} from 'lucide-react';

interface OrgChartNode {
  id: string;
  empCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  workEmail: string;
  departmentId: string | null;
  departmentName: string | null;
  designationId: string | null;
  designationName: string | null;
  managerId: string | null;
  directReportsCount: number;
  // UI state
  children?: OrgChartNode[];
  isExpanded?: boolean;
  isLoadingChildren?: boolean;
}

export default function OrgChartPage() {
  const [rootNodes, setRootNodes] = useState<OrgChartNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<OrgChartNode[]>([]);
  const [searching, setSearching] = useState(false);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Load root nodes
  useEffect(() => {
    const loadRootNodes = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/v1/org/chart');
        if (res.ok) {
          const json = await res.json();
          setRootNodes(json.data || []);
        }
      } finally {
        setLoading(false);
      }
    };
    loadRootNodes();
  }, []);

  // Search debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/v1/org/chart?search=${encodeURIComponent(searchQuery.trim())}`);
        if (res.ok) {
          const json = await res.json();
          setSearchResults(json.data || []);
        }
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Recursively toggle or load child nodes
  const toggleExpand = async (targetNode: OrgChartNode) => {
    // If already loaded and expanded, collapse it
    if (targetNode.isExpanded) {
      updateNodeInTree(targetNode.id, node => ({
        ...node,
        isExpanded: false,
      }));
      return;
    }

    // If children already loaded, simply expand
    if (targetNode.children && targetNode.children.length > 0) {
      updateNodeInTree(targetNode.id, node => ({
        ...node,
        isExpanded: true,
      }));
      return;
    }

    // Lazy load children from server
    updateNodeInTree(targetNode.id, node => ({
      ...node,
      isLoadingChildren: true,
    }));

    try {
      const res = await fetch(`/api/v1/org/chart?parentId=${targetNode.id}`);
      if (res.ok) {
        const json = await res.json();
        updateNodeInTree(targetNode.id, node => ({
          ...node,
          children: json.data || [],
          isExpanded: true,
          isLoadingChildren: false,
        }));
      } else {
        updateNodeInTree(targetNode.id, node => ({
          ...node,
          isLoadingChildren: false,
        }));
      }
    } catch {
      updateNodeInTree(targetNode.id, node => ({
        ...node,
        isLoadingChildren: false,
      }));
    }
  };

  // Helper to immutably update a node inside rootNodes hierarchy
  const updateNodeInTree = (
    id: string,
    updater: (node: OrgChartNode) => OrgChartNode,
  ) => {
    const updateRecursive = (nodes: OrgChartNode[]): OrgChartNode[] => {
      return nodes.map(node => {
        if (node.id === id) {
          return updater(node);
        }
        if (node.children && node.children.length > 0) {
          return {
            ...node,
            children: updateRecursive(node.children),
          };
        }
        return node;
      });
    };

    setRootNodes(prev => updateRecursive(prev));
  };

  // Pan canvas drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only primary button
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleZoomIn = () => setZoom(z => Math.min(z + 0.15, 2.0));
  const handleZoomOut = () => setZoom(z => Math.max(z - 0.15, 0.4));
  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const getInitials = (first: string, last: string) => {
    return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
  };

  // Render a node and its recursive children
  const renderNode = (node: OrgChartNode) => {
    const isHighlighted = highlightedNodeId === node.id;

    return (
      <div key={node.id} className="flex flex-col items-center">
        {/* Node Card */}
        <div
          className={`relative w-64 bg-card rounded-2xl border transition-all duration-200 shadow-md ${
            isHighlighted
              ? 'ring-2 ring-primary border-primary shadow-primary/20 shadow-lg scale-105'
              : 'border-border hover:border-primary/50 hover:shadow-lg'
          }`}
        >
          {/* Top banner accent */}
          <div className="h-2 w-full rounded-t-2xl bg-gradient-to-r from-primary/80 to-primary" />

          <div className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              {/* Initials Avatar */}
              <div className="h-10 w-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-primary text-xs shrink-0 shadow-inner">
                {getInitials(node.firstName, node.lastName)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-foreground text-sm truncate" title={node.fullName}>
                  {node.fullName}
                </div>
                <div className="text-[11px] font-mono text-muted-foreground flex items-center gap-1">
                  <span>{node.empCode}</span>
                </div>
              </div>
            </div>

            <div className="space-y-1 text-xs border-t border-border pt-2 text-muted-foreground">
              {node.designationName && (
                <div className="flex items-center gap-1.5 truncate text-foreground font-medium">
                  <Briefcase className="h-3 w-3 shrink-0 text-primary" />
                  <span className="truncate">{node.designationName}</span>
                </div>
              )}
              {node.departmentName && (
                <div className="flex items-center gap-1.5 truncate">
                  <Building className="h-3 w-3 shrink-0" />
                  <span className="truncate">{node.departmentName}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 truncate">
                <Mail className="h-3 w-3 shrink-0" />
                <span className="truncate text-[11px]">{node.workEmail}</span>
              </div>
            </div>

            {/* Direct Reports & Expand Button */}
            {node.directReportsCount > 0 && (
              <div className="pt-2 border-t border-border flex items-center justify-between">
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  <Users className="h-3 w-3" />
                  {node.directReportsCount} {node.directReportsCount === 1 ? 'report' : 'reports'}
                </span>
                <button
                  onClick={() => toggleExpand(node)}
                  disabled={node.isLoadingChildren}
                  className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md text-foreground hover:bg-muted transition"
                >
                  {node.isLoadingChildren ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  ) : node.isExpanded ? (
                    <>
                      <span>Collapse</span>
                      <ChevronUp className="h-3.5 w-3.5" />
                    </>
                  ) : (
                    <>
                      <span>Expand</span>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Children Subtree Connector Lines */}
        {node.isExpanded && node.children && node.children.length > 0 && (
          <div className="flex flex-col items-center">
            {/* Vertical connector down from parent */}
            <div className="w-0.5 h-6 bg-border" />

            {/* Horizontal rail across all children */}
            <div className="relative flex justify-center gap-8 pt-6">
              {node.children.length > 1 && (
                <div
                  className="absolute top-0 h-0.5 bg-border"
                  style={{
                    left: `calc(132px)`, // half of card width (w-64 = 256px / 2 = 128px + padding)
                    right: `calc(132px)`,
                  }}
                />
              )}

              {/* Children Nodes */}
              {node.children.map(child => (
                <div key={child.id} className="relative flex flex-col items-center">
                  {/* Vertical line connecting rail down to child card */}
                  <div className="absolute -top-6 w-0.5 h-6 bg-border" />
                  {renderNode(child)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Network className="h-7 w-7 text-primary" />
            Organization Hierarchy Chart
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Explore reporting structures, leadership chains, and team hierarchies across the company.
          </p>
        </div>

        {/* Controls Toolbar */}
        <div className="flex items-center gap-2 bg-card p-1.5 rounded-xl border border-border shadow-sm">
          <button
            onClick={handleZoomIn}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition"
            title="Zoom In"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <span className="text-xs font-mono font-medium px-1 text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={handleZoomOut}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition"
            title="Zoom Out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <div className="h-4 w-px bg-border mx-1" />
          <button
            onClick={handleReset}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition"
            title="Reset View"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Search Header Bar */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search employee in hierarchy..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition"
        />

        {/* Search Results Dropdown */}
        {searchQuery.trim().length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-xl z-30 max-h-72 overflow-y-auto divide-y divide-border">
            {searching ? (
              <div className="p-4 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" /> Searching...
              </div>
            ) : searchResults.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                No matching employees found.
              </div>
            ) : (
              searchResults.map(emp => (
                <button
                  key={emp.id}
                  onClick={() => {
                    setHighlightedNodeId(emp.id);
                    setSearchQuery('');
                  }}
                  className="w-full text-left p-3 hover:bg-muted/50 transition flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-semibold text-foreground">{emp.fullName}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {emp.empCode} • {emp.designationName || 'No designation'}
                    </div>
                  </div>
                  <span className="text-[11px] text-primary font-medium">Highlight</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Interactive Chart Canvas */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className={`w-full h-[650px] bg-muted/10 border border-border rounded-2xl overflow-hidden relative cursor-grab select-none shadow-inner ${
          isDragging ? 'cursor-grabbing' : ''
        }`}
      >
        {/* Background Grid Pattern */}
        <div
          className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05] pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle, currentColor 1px, transparent 1px)`,
            backgroundSize: '24px 24px',
          }}
        />

        {loading ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-sm">Loading organization hierarchy...</span>
          </div>
        ) : rootNodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <User className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <h3 className="text-base font-semibold text-foreground">No employees found</h3>
            <p className="text-sm text-muted-foreground max-w-sm mt-1">
              Add employees to your company directory to generate the live organization chart.
            </p>
          </div>
        ) : (
          <div
            className="absolute top-12 left-0 right-0 flex justify-center transition-transform duration-75"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'top center',
            }}
          >
            <div className="flex gap-12 pb-24">
              {rootNodes.map(rootNode => renderNode(rootNode))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
