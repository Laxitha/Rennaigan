import {
  Brain, ChartDonut, FileText, FolderOpen, Gear, Graph, ListMagnifyingGlass, ScanSmiley, ShieldCheck, Stack, Timer, UserFocus, Scales,
} from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import { PRIMARY_ID } from '@/data/investigations'

export interface NavItem { label: string; to: string; icon: Icon; match: RegExp }

/** Primary navigation, in console order. */
export const NAV: NavItem[] = [
  { label: 'Overview', to: '/overview', icon: ChartDonut, match: /^\/overview/ },
  { label: 'Investigations', to: '/investigations', icon: ListMagnifyingGlass, match: /^\/(investigations|analysis|timeline|verification|audit|review)/ },
  { label: 'Analyze', to: '/analyze', icon: ScanSmiley, match: /^\/analyze/ },
  { label: 'Evidence', to: `/evidence/${PRIMARY_ID}`, icon: Graph, match: /^\/evidence/ },
  { label: 'Cases', to: '/cases', icon: FolderOpen, match: /^\/cases/ },
  { label: 'Reports', to: `/reports/${PRIMARY_ID}`, icon: FileText, match: /^\/reports/ },
  { label: 'Bulk Verify', to: '/bulk', icon: Stack, match: /^\/bulk/ },
]

export const SECONDARY: NavItem[] = [
  { label: 'Models', to: '/models', icon: Brain, match: /^\/models/ },
  { label: 'Settings', to: '/settings', icon: Gear, match: /^\/settings/ },
]

/** Views of a single investigation. Shown as the contextual bar under the top navigation. */
export const INVESTIGATION_VIEWS: Array<{ label: string; segment: string; icon: Icon }> = [
  { label: 'Analysis', segment: 'analysis', icon: ScanSmiley },
  { label: 'Timeline', segment: 'timeline', icon: Timer },
  { label: 'Evidence', segment: 'evidence', icon: Graph },
  { label: 'Verification', segment: 'verification', icon: Scales },
  { label: 'Report', segment: 'reports', icon: FileText },
  { label: 'Audit', segment: 'audit', icon: ShieldCheck },
  { label: 'Review', segment: 'review', icon: UserFocus },
]

export const INVESTIGATION_ROUTE = /^\/(analysis|timeline|evidence|verification|reports|audit|review)\/([^/]+)/
