import { useMemo } from 'react';
import {
  buildOcclusionGraph,
  reachableBlockers,
  type Analysis,
  type LOSStatus,
  type Scene,
} from '../../shared/geometry';

interface GraphViewProps {
  scene: Scene;
  analysis: Analysis;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const STATUS_LABEL: Record<LOSStatus, string> = {
  clear: '通畅',
  tangent: '相切',
  blocked: '被遮挡',
  degenerate: '退化',
};

const STATUS_COLOR: Record<LOSStatus, string> = {
  clear: 'var(--clear)',
  tangent: 'var(--tangent)',
  blocked: 'var(--blocked)',
  degenerate: 'var(--degenerate)',
};

const NODE_R = 15;

/**
 * 遮挡关系图谱：每位演唱者一个节点（颜色 = 视线状态），
 * 被遮挡者向“沿视线最近的遮挡者”引一条有向边。
 * 选中节点后高亮其可达遮挡链路；互相遮挡形成的有向环用虚线圈标出并列出。
 * 图谱由 analysis 纯推导（useMemo），场景任何变化（拖动/导入/预设）都会立即重算。
 */
export function GraphView(props: GraphViewProps) {
  const { scene, analysis, selectedId } = props;

  const graph = useMemo(() => buildOcclusionGraph(analysis), [analysis]);

  // 环形布局：节点均匀分布在圆周上；人数多时增大半径避免重叠
  const layout = useMemo(() => {
    const n = scene.singers.length;
    const radius = Math.max(105, n * 9);
    const size = 2 * (radius + NODE_R + 16);
    const cx = size / 2;
    const cy = size / 2;
    const pos = new Map<string, { x: number; y: number }>();
    scene.singers.forEach((s, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, n);
      pos.set(s.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
    });
    return { pos, size };
  }, [scene.singers]);

  // 选中节点的可达遮挡链路（沿“最近遮挡者”边，含进入的环）
  const reach = useMemo(
    () => (selectedId ? reachableBlockers(graph, selectedId) : null),
    [graph, selectedId],
  );
  const reachActive = reach !== null && reach.nodes.size > 0;
  const reachEdgeKeys = useMemo(
    () => new Set((reach?.edges ?? []).map((e) => `${e.from}->${e.to}`)),
    [reach],
  );

  const cycleNodes = useMemo(() => new Set(graph.cycles.flat()), [graph.cycles]);
  const nameOf = (id: string) => graph.nodes.find((n) => n.id === id)?.name ?? id;

  if (graph.nodes.length === 0) {
    return (
      <section className="panel graph-panel">
        <h3>遮挡关系图谱</h3>
        <p className="hint">暂无演唱者：双击舞台空白处或点击「＋ 添加演唱者」后自动生成图谱。</p>
      </section>
    );
  }

  return (
    <section className="panel graph-panel">
      <h3>遮挡关系图谱</h3>
      <p className="hint graph-hint">
        箭头指向最近遮挡者；点击节点选中并高亮其遮挡链路，虚线圈为循环遮挡。
      </p>
      <svg
        className="graph-svg"
        viewBox={`0 0 ${layout.size} ${layout.size}`}
        onPointerDown={() => props.onSelect(null)}
      >
        <defs>
          <marker
            id="graph-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" className="graph-arrow-head" />
          </marker>
          <marker
            id="graph-arrow-hl"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" className="graph-arrow-head hl" />
          </marker>
        </defs>

        {/* 有向边：被遮挡者 → 最近遮挡者 */}
        {graph.edges.map((e) => {
          const a = layout.pos.get(e.from);
          const b = layout.pos.get(e.to);
          if (!a || !b) return null;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const key = `${e.from}->${e.to}`;
          const hl = reachActive && reachEdgeKeys.has(key);
          const dim = reachActive && !hl;
          return (
            <line
              key={key}
              x1={a.x + ux * NODE_R}
              y1={a.y + uy * NODE_R}
              x2={b.x - ux * (NODE_R + 4)}
              y2={b.y - uy * (NODE_R + 4)}
              className={`graph-edge${hl ? ' hl' : ''}`}
              opacity={dim ? 0.15 : 1}
              markerEnd={hl ? 'url(#graph-arrow-hl)' : 'url(#graph-arrow)'}
            />
          );
        })}

        {/* 节点：填充色 = 视线状态 */}
        {graph.nodes.map((node) => {
          const p = layout.pos.get(node.id);
          if (!p) return null;
          const isSel = selectedId === node.id;
          const inReach = reach?.nodes.has(node.id) ?? false;
          const dim = reachActive && !inReach;
          const inCycle = cycleNodes.has(node.id);
          return (
            <g
              key={node.id}
              className={`graph-node${isSel ? ' selected' : ''}${inReach && !isSel ? ' reach' : ''}`}
              opacity={dim ? 0.3 : 1}
              transform={`translate(${p.x} ${p.y})`}
              onPointerDown={(e) => {
                e.stopPropagation();
                props.onSelect(isSel ? null : node.id);
              }}
            >
              {inCycle && <circle r={NODE_R + 5} className="graph-cycle-ring" />}
              <circle
                r={NODE_R}
                className="graph-node-body"
                style={{ fill: STATUS_COLOR[node.status] }}
              />
              <text textAnchor="middle" dominantBaseline="central" className="graph-node-label">
                {node.name}
              </text>
              <title>{`${node.name}：${STATUS_LABEL[node.status]}`}</title>
            </g>
          );
        })}
      </svg>

      <div className="graph-legend">
        {(['clear', 'tangent', 'blocked', 'degenerate'] as const).map((st) => (
          <span key={st} className="graph-legend-item">
            <span className="dot" style={{ background: STATUS_COLOR[st] }} />
            {STATUS_LABEL[st]}
          </span>
        ))}
      </div>

      {graph.cycles.length > 0 && (
        <div className="graph-cycles">
          <h4>⚠ 循环遮挡（{graph.cycles.length}）</h4>
          <ul>
            {graph.cycles.map((cyc, i) => (
              <li key={i}>
                {cyc.map(nameOf).join(' → ')} → {nameOf(cyc[0])}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
