import { Compass } from '@phosphor-icons/react'
import { EmptyState, GlassButton, GlassPanel } from '@/components/glass'

export default function NotFound() {
  return (
    <GlassPanel level={1} className="mx-auto mt-10 max-w-xl">
      <EmptyState icon={<Compass size={22} weight="light" />} title="Page not found" body="This address does not match any view in the workspace."
        action={<GlassButton variant="primary" to="/overview">Go to overview</GlassButton>} />
    </GlassPanel>
  )
}
