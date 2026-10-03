import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ArrowRight, GitBranch, MagnifyingGlass } from '@phosphor-icons/react'
import { useInvestigation } from '@/hooks/useInvestigation'
import { usePageReveal } from '@/animations/usePageReveal'
import { cn } from '@/lib/cn'
import { d, dist, EASE, fromToSafe, useGSAP } from '@/lib/motion'
import { tc } from '@/lib/format'
import { flagged } from '@/data/anomalies'
import { graphEdges, graphNodes } from '@/data/graph'
import { EmptyState, GlassBadge, GlassButton, GlassInput, GlassInspector, GlassPanel, GlassSheet } from '@/components/glass'
import { connected, EvidenceGraph, KIND_LABEL } from '@/components/graph/EvidenceGraph'
import { PageHeader } from '@/components/navigation/PageHeader'
import type { GraphNode } from '@/types'

const byId = new Map(graphNodes.map((n) => [n.id, n]))

function NodeDetail({ node, onPick, investigationId }: { node: GraphNode; onPick: (id: string) => void; investigationId: string }) {
  const inbound = graphEdges.filter((e) => e.to === node.id).map((e) => byId.get(e.from)!)
  const outbound = graphEdges.filter((e) => e.from === node.id).map((e) => byId.get(e.to)!)
  const link = (n: GraphNode) => (
    <li key={n.id}>
      <button type="button" onClick={() => onPick(n.id)} className="row-hover flex w-full items-center justify-between gap-3 rounded-[9px] px-2.5 py-2 text-left text-[0.8125rem] text-fg-2 hover:text-fg">
        <span className="truncate">{n.label}</span><span className="t-label shrink-0 text-[0.625rem]">{KIND_LABEL[n.kind]}</span>
      </button>
    </li>
  )
  return (
    <div>
      <GlassBadge tone={node.kind === 'anomaly' ? 'warn' : node.kind === 'external' ? 'info' : 'accent'}>{KIND_LABEL[node.kind]}</GlassBadge>
      <h2 className="mt-3 text-lg font-[540] tracking-[-0.02em]">{node.label}</h2>
      <p className="mt-2 text-sm leading-relaxed text-fg-2">{node.detail}</p>
      <GlassInspector dense className="mt-5" rows={[
        { label: 'Reference', value: node.ref, mono: true, copy: node.ref },
        ...(node.weight !== undefined ? [{ label: 'Detector confidence', value: `${Math.round(node.weight * 100)}%`, mono: true }] : []),
        { label: 'Path size', value: `${connected(node.id).size} nodes`, mono: true },
      ]} />
      {inbound.length > 0 && (<><h3 className="t-label mb-1 mt-6">Derived from</h3><ul>{inbound.map(link)}</ul></>)}
      {outbound.length > 0 && (<><h3 className="t-label mb-1 mt-5">Supports</h3><ul>{outbound.map(link)}</ul></>)}
      {node.kind === 'external' && <GlassButton className="mt-5" size="sm" to={`/verification/${investigationId}`} trailing={<ArrowRight size={14} weight="light" />}>Open verification</GlassButton>}
    </div>
  )
}

export default function Evidence() {
  const { id = '' } = useParams()
  const scope = useRef<HTMLDivElement>(null)
  const side = useRef<HTMLDivElement>(null)
  const { investigation, gate } = useInvestigation(id, 'evidence graph')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [isolate, setIsolate] = useState(false)
  const [pathOf, setPathOf] = useState<string | null>(null)
  const [wide, setWide] = useState(() => matchMedia('(min-width: 1180px)').matches)
  usePageReveal(scope, [investigation, gate])

  useEffect(() => {
    const mq = matchMedia('(min-width: 1180px)')
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useGSAP(() => {
    if (selectedId && side.current) fromToSafe(side.current, { autoAlpha: 0, x: dist(14) }, { autoAlpha: 1, x: 0, duration: d(0.35), ease: EASE.out })
  }, [selectedId])

  const node = selectedId ? byId.get(selectedId) ?? null : null
  const highlight = useMemo(() => flagged.find((a) => a.id === pathOf)?.graphPath ?? null, [pathOf])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? graphNodes.filter((n) => `${n.label} ${n.ref} ${KIND_LABEL[n.kind]}`.toLowerCase().includes(q)) : []
  }, [query])
  const pick = (nodeId: string) => { setSelectedId(nodeId); setFocusId(nodeId) }
  const clear = () => { setSelectedId(null); setPathOf(null); setQuery(''); setIsolate(false); setFocusId(null) }

  if (gate || !investigation) return <div ref={scope}><PageHeader title="Evidence graph" />{gate}</div>

  return (
    <div ref={scope}>
      <PageHeader title="Evidence graph" description="How each finding was reached, from the uploaded file to the final assessment. Select a node to trace the evidence through it."
        actions={<GlassButton to={`/reports/${investigation.id}`}>Forensic report</GlassButton>} />

      <div data-reveal className="mb-4 flex flex-wrap items-center gap-3">
        <GlassInput label="Search evidence" hideLabel type="search" placeholder="Search evidence" value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) pick(matches[0].id) }}
          leading={<MagnifyingGlass size={15} weight="light" />} className="w-full sm:w-64" hint={query ? `${matches.length} matching ${matches.length === 1 ? 'node' : 'nodes'}. Enter opens the first.` : undefined} />
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Focus investigation path">
          <span className="t-label mr-1">Focus path</span>
          {flagged.map((a) => (
            <button key={a.id} type="button" className="btn" data-size="sm" aria-pressed={pathOf === a.id}
              onClick={() => { setSelectedId(null); setPathOf(pathOf === a.id ? null : a.id) }}>{tc(a.start)}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" className="btn" data-size="sm" aria-pressed={isolate} onClick={() => setIsolate((v) => !v)} disabled={!selectedId && !pathOf}>
            <GitBranch size={14} weight="light" />Isolate path
          </button>
          <GlassButton size="sm" variant="quiet" onClick={clear}>Reset</GlassButton>
        </div>
      </div>

      <div className={cn('grid gap-5', wide && 'grid-cols-[minmax(0,1fr)_340px]')}>
        <GlassPanel data-reveal level={3} as="section" aria-label="Evidence graph" className="overflow-hidden">
          <EvidenceGraph selectedId={selectedId} onSelect={setSelectedId} highlightPath={highlight} isolate={isolate} query={query} focusId={focusId}
            className="h-[min(64vh,620px)] min-h-[380px]" />
          <ul className="flex flex-wrap gap-x-5 gap-y-2 border-t border-line px-5 py-3" aria-label="Legend">
            {([['Source and fusion', 'bg-accent'], ['Anomaly', 'bg-warn'], ['Finding', 'bg-magenta'], ['External evidence', 'bg-info'], ['Feature', 'bg-fg-3']] as const).map(([label, color]) => (
              <li key={label} className="flex items-center gap-2 text-[0.75rem] text-fg-3"><span aria-hidden className={cn('h-2 w-3 rounded-[2px]', color)} />{label}</li>
            ))}
          </ul>
        </GlassPanel>

        {wide && (
          <GlassPanel data-reveal as="aside" aria-label="Node inspector" aria-live="polite" className="self-start">
            {node ? <div ref={side} className="pad-lg"><NodeDetail node={node} onPick={pick} investigationId={investigation.id} /></div>
              : <EmptyState title="No node selected" body="Hover a node to light up everything connected to it. Select one to inspect it and its sources." />}
          </GlassPanel>
        )}
      </div>

      {!wide && (
        <GlassSheet open={!!node} onClose={() => setSelectedId(null)} title="Evidence node">
          {node && <NodeDetail node={node} onPick={pick} investigationId={investigation.id} />}
        </GlassSheet>
      )}
    </div>
  )
}
