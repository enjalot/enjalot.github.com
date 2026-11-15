// Fluid: every tweet is a particle in a small fluid simulation. The particles
// start wherever the last arrangement left them and fall from there.
import { createSim } from './sph-sim.js'

export default function fluid(F) {
  // pick the interaction radius so the pool fills about a third of the screen
  const h = Math.max(4, Math.sqrt((0.32 * F.w * F.h) / (0.2 * F.n)))
  const sim = createSim(F.n, F.w, F.h, h)
  for (let i = 0; i < F.n; i++) { sim.x[i] = F.pos[i * 2]; sim.y[i] = F.pos[i * 2 + 1] }
  let acc = 0
  return {
    size: [Math.max(2.4, h * 0.5), 0.1],
    caption: 'The same tweets as particles in a fluid. This is the kind of simulation my thesis was about: each particle pushes on its neighbours and gravity does the rest. Move the cursor through it or scroll fast to stir it. Color is the year.',
    step(F, dt) {
      acc += dt * 60
      let k = Math.min(3, Math.floor(acc))
      acc -= Math.floor(acc)
      const p = F.pointer && { ...F.pointer, r: h * 5 }
      const ay = Math.max(-0.035 * h, Math.min(0.035 * h, -F.scrollV * 0.0009 * h))
      for (; k > 0; k--) sim.step(p, 0, ay)
      for (let i = 0; i < F.n; i++) { F.pos[i * 2] = sim.x[i]; F.pos[i * 2 + 1] = sim.y[i] }
    },
    resize(F) { sim.resize(F.w, F.h) },
  }
}
