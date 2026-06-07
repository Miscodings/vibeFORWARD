"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  ReactFlow,
  Background,
  Handle,
  Position,
  MarkerType,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  type NodeTypes,
  type EdgeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import type {
  CasePattern,
  NetworkPattern,
  NetworkNode,
  BarsPattern,
  TimelinePattern,
  TimelinePoint,
  CadencePattern,
  PatternTone,
} from "@/lib/pattern-data";

const TONE_COLOR: Record<PatternTone, string> = {
  primary: "var(--color-primary)",
  critical: "var(--color-severity-critical)",
  high: "var(--color-severity-high)",
  muted: "var(--color-muted-foreground)",
  success: "var(--color-success)",
};

function Mono({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`num ${className}`}>{children}</span>;
}

const formatCurrency = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : `$${n.toLocaleString("en-US")}`;

const formatExact = (n: number) => `$${n.toLocaleString("en-US")}`;

const formatValue = (unit: "currency" | "count", n: number) =>
  unit === "currency" ? formatCurrency(n) : n.toLocaleString("en-US");

interface TooltipEntry {
  value?: number | string;
  name?: string;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

function ChartTooltipShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[260px] rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-xs shadow-lg">
      {children}
    </div>
  );
}

function BarsTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  unit: "currency" | "count";
}) {
  if (!active || !payload?.length) return null;
  return (
    <ChartTooltipShell>
      <p className="mb-1.5 font-semibold text-foreground">{label}</p>
      <div className="flex flex-col gap-1">
        {payload.map((p) => (
          <p key={String(p.dataKey)} className="flex items-center gap-1.5 text-muted-foreground">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-foreground/75">{p.name}</span>
            <Mono className="ml-auto font-semibold text-foreground">
              {formatValue(unit, Number(p.value ?? 0))}
            </Mono>
          </p>
        ))}
      </div>
    </ChartTooltipShell>
  );
}

function TimelineTooltip({
  active,
  payload,
  unit,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  unit: "currency" | "count";
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as TimelinePoint | undefined;
  if (!point) return null;
  return (
    <ChartTooltipShell>
      <p className="mb-1 font-semibold text-foreground">{point.label}</p>
      <p className="text-muted-foreground">
        {unit === "currency" ? "Balance" : "Running total"}{" "}
        <Mono className="font-semibold text-foreground">{formatValue(unit, point.value)}</Mono>
      </p>
    </ChartTooltipShell>
  );
}

const tickStyle = { fontSize: 11, fill: "var(--color-muted-foreground)" };
const axisLine = { stroke: "var(--color-border)" };

// ---------------------------------------------------------------------------
// Bars
// ---------------------------------------------------------------------------

function PatternBars({ pattern }: { pattern: BarsPattern }) {
  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={pattern.bars} margin={{ top: 8, right: 12, left: 0, bottom: 4 }} barGap={6}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={tickStyle}
            tickLine={false}
            axisLine={axisLine}
            interval={0}
            angle={pattern.bars.length > 6 ? -22 : 0}
            textAnchor={pattern.bars.length > 6 ? "end" : "middle"}
            height={pattern.bars.length > 6 ? 48 : 28}
          />
          <YAxis
            tick={tickStyle}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v: number) => formatValue(pattern.unit, v)}
          />
          <Tooltip content={<BarsTooltip unit={pattern.unit} />} cursor={{ fill: "var(--color-accent)" }} />
          {pattern.series.length > 1 && (
            <Legend
              wrapperStyle={{ fontSize: 12, color: "var(--color-muted-foreground)" }}
              iconType="circle"
              iconSize={8}
            />
          )}
          {pattern.referenceLine && (
            <ReferenceLine
              y={pattern.referenceLine.value}
              stroke="var(--color-severity-critical)"
              strokeDasharray="6 4"
              strokeWidth={1.5}
              label={{
                value: pattern.referenceLine.label,
                position: "insideTopRight",
                fill: "var(--color-severity-critical)",
                fontSize: 11,
                fontWeight: 600,
              }}
            />
          )}
          {pattern.series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={TONE_COLOR[s.tone]}
              radius={[6, 6, 0, 0]}
              maxBarSize={46}
              animationDuration={650}
              animationBegin={i * 110}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

function PatternTimeline({ pattern }: { pattern: TimelinePattern }) {
  const maxT = Math.max(...pattern.points.map((p) => p.t));
  const isMinutes = pattern.xLabel.toLowerCase().includes("minute");
  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={pattern.points} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          <defs>
            <linearGradient id={`timelineFill-${pattern.label.replace(/\s+/g, "-")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.32} />
              <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          {pattern.burstFrom != null && (
            <ReferenceArea
              x1={pattern.burstFrom}
              x2={maxT}
              fill="var(--color-severity-critical)"
              fillOpacity={0.07}
              label={{
                value: "burst window",
                position: "insideTopRight",
                fill: "var(--color-severity-critical)",
                fontSize: 11,
                fontWeight: 600,
              }}
            />
          )}
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tick={tickStyle}
            tickLine={false}
            axisLine={axisLine}
            tickFormatter={(v: number) => (isMinutes ? `+${v}m` : `d${v}`)}
          />
          <YAxis
            tick={tickStyle}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v: number) => formatValue(pattern.unit, v)}
          />
          <Tooltip content={<TimelineTooltip unit={pattern.unit} />} cursor={{ stroke: "var(--color-primary)", strokeDasharray: "4 4" }} />
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--color-primary)"
            strokeWidth={2.5}
            fill={`url(#timelineFill-${pattern.label.replace(/\s+/g, "-")})`}
            dot={{ r: 3, strokeWidth: 0, fill: "var(--color-primary)" }}
            activeDot={{ r: 5 }}
            animationDuration={900}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cadence grid
// ---------------------------------------------------------------------------

function PatternCadence({ pattern }: { pattern: CadencePattern }) {
  const max = Math.max(1, ...pattern.cells.map((c) => c.value ?? (c.active ? 1 : 0)));
  return (
    <div className="flex h-[320px] w-full flex-col justify-center gap-5">
      <div className="flex flex-wrap gap-2.5">
        {pattern.cells.map((cell, i) => {
          const intensity = cell.active ? Math.max(0.32, (cell.value ?? 1) / max) : 0;
          return (
            <motion.div
              key={`${cell.label}-${i}`}
              initial={{ opacity: 0, scale: 0.75, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.32, delay: i * 0.045, ease: [0.16, 1, 0.3, 1] }}
              className={`flex min-w-[82px] flex-1 flex-col items-center gap-1.5 rounded-2xl border px-3 py-3.5 text-center transition-colors duration-200 ${
                cell.active ? "border-primary/35" : "border-border/70"
              }`}
              style={
                cell.active
                  ? { backgroundColor: `color-mix(in srgb, var(--color-primary) ${Math.round(intensity * 50)}%, var(--color-surface))` }
                  : { backgroundColor: "var(--color-surface)" }
              }
            >
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{cell.label}</span>
              {cell.active ? (
                <Mono className={`text-sm font-bold ${intensity > 0.6 ? "text-white" : "text-foreground"}`}>
                  {cell.value != null ? formatValue(pattern.unit, cell.value) : "●"}
                </Mono>
              ) : (
                <span className="text-sm text-muted-foreground/35">—</span>
              )}
            </motion.div>
          );
        })}
      </div>
      <p className="text-center text-[11px] uppercase tracking-wider text-muted-foreground">{pattern.axisLabel}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Network diagram (React Flow)
// ---------------------------------------------------------------------------

type Side = "top" | "right" | "bottom" | "left";
const OPPOSITE_SIDE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };
const HANDLE_SIDES: { id: Side; position: Position }[] = [
  { id: "top", position: Position.Top },
  { id: "right", position: Position.Right },
  { id: "bottom", position: Position.Bottom },
  { id: "left", position: Position.Left },
];

function sideBetween(a: { x: number; y: number }, b: { x: number; y: number }): Side {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

const ROLE_LABEL: Record<NetworkNode["role"], string> = {
  origin: "origin",
  relay: "relay",
  sink: "endpoint",
};

const ROLE_CLASS: Record<NetworkNode["role"], string> = {
  origin: "border-primary bg-primary/12 text-primary",
  relay: "border-border bg-surface text-foreground",
  sink: "border-severity-critical/35 bg-severity-critical-bg text-severity-critical",
};

type PatternNodeType = Node<{ label: string; role: NetworkNode["role"] }, "pattern">;
type PatternEdgeType = Edge<{ amount?: number; date?: string; label?: string }, "pattern">;

function PatternFlowNode({ data }: NodeProps<PatternNodeType>) {
  return (
    <div className={`relative rounded-2xl border px-4 py-2.5 text-center shadow-sm transition-colors duration-200 ${ROLE_CLASS[data.role]}`}>
      {HANDLE_SIDES.flatMap(({ id, position }) => [
        <Handle
          key={`source-${id}`}
          type="source"
          position={position}
          id={`source-${id}`}
          className="!h-px !w-px !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0"
        />,
        <Handle
          key={`target-${id}`}
          type="target"
          position={position}
          id={`target-${id}`}
          className="!h-px !w-px !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0"
        />,
      ])}
      <Mono className="text-sm font-semibold tracking-tight">{data.label}</Mono>
      <div className="mt-0.5 text-[9px] uppercase tracking-[0.2em] opacity-60">{ROLE_LABEL[data.role]}</div>
    </div>
  );
}

function PatternFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
}: EdgeProps<PatternEdgeType>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const caption = data?.amount != null ? `${formatExact(data.amount)}${data.date ? ` · ${data.date}` : ""}` : data?.label;
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {caption && (
        <EdgeLabelRenderer>
          <div
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className="pointer-events-none absolute rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm"
          >
            {caption}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const flowNodeTypes: NodeTypes = { pattern: PatternFlowNode };
const flowEdgeTypes: EdgeTypes = { pattern: PatternFlowEdge };

const CANVAS = { width: 560, height: 360 };
const CENTER = { x: CANVAS.width / 2, y: CANVAS.height / 2 };

function layoutPositions(pattern: NetworkPattern): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  if (pattern.layout === "hub") {
    const origin = pattern.nodes.find((n) => n.role === "origin") ?? pattern.nodes[0];
    const rest = pattern.nodes.filter((n) => n.id !== origin.id);
    positions[origin.id] = { ...CENTER };
    const radius = 155;
    rest.forEach((n, i) => {
      const angle = (i / rest.length) * Math.PI * 2 - Math.PI / 2;
      positions[n.id] = { x: CENTER.x + radius * Math.cos(angle), y: CENTER.y + radius * Math.sin(angle) };
    });
  } else {
    const radius = 145;
    pattern.nodes.forEach((n, i) => {
      const angle = (i / pattern.nodes.length) * Math.PI * 2 - Math.PI / 2;
      positions[n.id] = { x: CENTER.x + radius * Math.cos(angle), y: CENTER.y + radius * Math.sin(angle) };
    });
  }
  return positions;
}

function PatternNetwork({ pattern }: { pattern: NetworkPattern }) {
  const positions = useMemo(() => layoutPositions(pattern), [pattern]);

  const nodes = useMemo<PatternNodeType[]>(
    () =>
      pattern.nodes.map((n) => ({
        id: n.id,
        type: "pattern",
        position: positions[n.id],
        data: { label: n.label, role: n.role },
        draggable: false,
      })),
    [pattern.nodes, positions],
  );

  const edges = useMemo<PatternEdgeType[]>(
    () =>
      pattern.edges.map((e, i) => {
        const side = sideBetween(positions[e.source], positions[e.target]);
        return {
          id: `e-${i}`,
          source: e.source,
          target: e.target,
          sourceHandle: `source-${side}`,
          targetHandle: `target-${OPPOSITE_SIDE[side]}`,
          type: "pattern",
          animated: true,
          data: { amount: e.amount, date: e.date, label: e.label },
          style: { stroke: "var(--color-border)", strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-primary)", width: 16, height: 16 },
        };
      }),
    [pattern.edges, positions],
  );

  return (
    <div className="h-[360px] w-full overflow-hidden rounded-2xl border border-border bg-surface [&_.react-flow__attribution]:hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={flowNodeTypes}
        edgeTypes={flowEdgeTypes}
        nodeOrigin={[0.5, 0.5]}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        panOnDrag
        minZoom={0.7}
        maxZoom={1.3}
      >
        <Background color="var(--color-border)" gap={26} size={1} />
      </ReactFlow>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------

export function PatternChart({ pattern }: { pattern: CasePattern }) {
  switch (pattern.kind) {
    case "network":
      return <PatternNetwork pattern={pattern} />;
    case "bars":
      return <PatternBars pattern={pattern} />;
    case "timeline":
      return <PatternTimeline pattern={pattern} />;
    case "cadence":
      return <PatternCadence pattern={pattern} />;
  }
}
