import { useEffect, useRef } from 'react'
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, EdgesGeometry, Group, IcosahedronGeometry, LineBasicMaterial, LineSegments,
  Mesh, MeshBasicMaterial, PerspectiveCamera, Points, PointsMaterial, Scene, ShaderMaterial, SphereGeometry, TorusGeometry, WebGLRenderer,
} from 'three'
import { lensFragment, lensVertex } from '@/shaders/lens'
import { usePrefs } from '@/hooks/usePrefs'
import { mulberry32 } from '@/lib/format'
import { cn } from '@/lib/cn'

interface Props {
  className?: string
  /** 0 idle, 1 analysing. Raises ring speed and surface activity. */
  energy?: number
  /** Follow page scroll with a slow rotation and drift. */
  scrollLinked?: boolean
}

/**
 * Abstract forensic lens: a fresnel glass orb, tilted iris rings and a field of
 * evidence particles tethered to it. One draw-light scene, paused when off screen.
 */
export default function ForensicLens({ className, energy = 0, scrollLinked }: Props) {
  const mount = useRef<HTMLDivElement>(null)
  const energyRef = useRef(energy)
  energyRef.current = energy
  const { reduced } = usePrefs()

  useEffect(() => {
    const host = mount.current
    if (!host) return
    const nav = navigator as Navigator & { deviceMemory?: number }
    const low = (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4

    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: !low, alpha: true, powerPreference: 'high-performance' })
    } catch {
      return // WebGL unavailable: the hero still reads without the lens
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1 : 1.75))
    renderer.setClearColor(0x000000, 0)
    host.appendChild(renderer.domElement)
    renderer.domElement.setAttribute('aria-hidden', 'true')

    const scene = new Scene()
    const camera = new PerspectiveCamera(38, 1, 0.1, 50)
    camera.position.set(0, 0, 8.4)
    const rig = new Group()
    scene.add(rig)
    const disposables: Array<{ dispose: () => void }> = []
    const keep = <T extends { dispose: () => void }>(x: T) => { disposables.push(x); return x }

    const pink = new Color('#ff4d94')
    const soft = new Color('#ffc2da')

    // glass orb
    const uniforms = { uRim: { value: soft }, uCore: { value: new Color('#6b1d45') }, uTime: { value: 0 }, uEnergy: { value: 0 } }
    const orb = new Mesh(
      keep(new SphereGeometry(1.55, low ? 40 : 64, low ? 28 : 48)),
      keep(new ShaderMaterial({ uniforms, vertexShader: lensVertex, fragmentShader: lensFragment, transparent: true, depthWrite: false })),
    )
    rig.add(orb)

    // faceted cage
    const cageGeo = keep(new EdgesGeometry(keep(new IcosahedronGeometry(1.92, 1))))
    const cage = new LineSegments(cageGeo, keep(new LineBasicMaterial({ color: pink, transparent: true, opacity: 0.16 })))
    rig.add(cage)

    // iris rings
    const rings: Mesh[] = []
    const ringSpec: Array<[number, number, number, number]> = [[1.02, 0.005, 0.2, 0.6], [0.72, 0.006, -0.5, 0.5], [0.42, 0.008, 0.9, 0.85], [2.45, 0.004, 1.15, 0.3]]
    for (const [radius, tube, tilt, opacity] of ringSpec) {
      const ring = new Mesh(keep(new TorusGeometry(radius, tube, 8, low ? 64 : 120)), keep(new MeshBasicMaterial({ color: radius > 2 ? pink : soft, transparent: true, opacity })))
      ring.rotation.set(tilt, tilt * 0.6, 0)
      rings.push(ring)
      rig.add(ring)
    }
    const core = new Mesh(keep(new IcosahedronGeometry(0.09, 1)), keep(new MeshBasicMaterial({ color: soft })))
    rig.add(core)

    // evidence particles and tethers
    const r = mulberry32(8811)
    const count = low ? 150 : 320
    const positions = new Float32Array(count * 3)
    const tethers: number[] = []
    for (let i = 0; i < count; i++) {
      const u = r() * 2 - 1
      const th = r() * Math.PI * 2
      const rad = 2.5 + r() * 2.1
      const s = Math.sqrt(1 - u * u)
      const x = s * Math.cos(th) * rad
      const y = u * rad * 0.74
      const z = s * Math.sin(th) * rad
      positions.set([x, y, z], i * 3)
      if (i % (low ? 14 : 11) === 0) {
        const k = 1.92 / Math.hypot(x, y, z)
        tethers.push(x, y, z, x * k, y * k, z * k)
      }
    }
    const cloudGeo = keep(new BufferGeometry())
    cloudGeo.setAttribute('position', new BufferAttribute(positions, 3))
    const cloud = new Points(cloudGeo, keep(new PointsMaterial({ color: soft, size: 0.034, transparent: true, opacity: 0.75, blending: AdditiveBlending, depthWrite: false })))
    rig.add(cloud)
    const tetherGeo = keep(new BufferGeometry())
    tetherGeo.setAttribute('position', new BufferAttribute(new Float32Array(tethers), 3))
    const lines = new LineSegments(tetherGeo, keep(new LineBasicMaterial({ color: pink, transparent: true, opacity: 0.16 })))
    rig.add(lines)

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
    const onPointer = (e: PointerEvent) => {
      pointer.tx = (e.clientX / window.innerWidth) * 2 - 1
      pointer.ty = (e.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener('pointermove', onPointer, { passive: true })

    const resize = () => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      // keep the whole particle field in frame on narrow or portrait containers
      camera.position.z = w / h < 1 ? 8.4 / Math.max(0.62, w / h) : 8.4
      camera.updateProjectionMatrix()
      render(0)
    }

    let time = 0
    const render = (dt: number) => {
      const e = energyRef.current
      time += dt * (1 + e * 1.6)
      uniforms.uTime.value = time
      uniforms.uEnergy.value = e
      pointer.x += (pointer.tx - pointer.x) * 0.05
      pointer.y += (pointer.ty - pointer.y) * 0.05
      const scroll = scrollLinked ? Math.min(1.5, window.scrollY / window.innerHeight) : 0
      rig.rotation.y = time * 0.07 + pointer.x * 0.42 + scroll * 0.9
      rig.rotation.x = pointer.y * 0.26 + scroll * 0.25
      rig.position.y = scroll * 0.7
      rig.scale.setScalar(1 - scroll * 0.12)
      rings[0].rotation.z = time * 0.22
      rings[1].rotation.z = -time * 0.34
      rings[2].rotation.z = time * 0.55
      rings[3].rotation.z = -time * 0.05
      cage.rotation.y = -time * 0.045
      cloud.rotation.y = lines.rotation.y = time * 0.02
      core.scale.setScalar(1 + Math.sin(time * 2.2) * 0.08 + e * 0.35)
      renderer.render(scene, camera)
    }

    let raf = 0
    let last = 0
    let visible = true
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      render(dt)
    }
    const start = () => { if (!raf && visible && !document.hidden && !reduced) { last = performance.now(); raf = requestAnimationFrame(loop) } }
    const stop = () => { cancelAnimationFrame(raf); raf = 0 }
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; visible ? start() : stop() })
    io.observe(host)
    const onVisibility = () => (document.hidden ? stop() : start())
    document.addEventListener('visibilitychange', onVisibility)
    const ro = new ResizeObserver(resize)
    ro.observe(host)
    resize()
    start()

    return () => {
      stop()
      io.disconnect()
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pointermove', onPointer)
      disposables.forEach((x) => x.dispose())
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [reduced, scrollLinked])

  return <div ref={mount} className={cn('[&>canvas]:size-full', className)} />
}
