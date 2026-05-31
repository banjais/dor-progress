/**
 * Background Worker for Splash Screen Particle Physics
 */

interface ParticleState {
  x: number;
  y: number;
  s: number;
  vx: number;
  vy: number;
  o: number;
  hueOffset: number;
  lightnessOffset: number;
  inField: boolean;
  history: { x: number; y: number }[];
  swarmColor?: { r: number; g: number; b: number; a: number };
}

let particles: ParticleState[] = [];
let width = 0;
let height = 0;
let offscreenCanvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let mouseX = -1000;
let mouseY = -1000;
let risk = 0;
let timeScale = 1.0;
let bassIntensity = 0;
let swarmActive = false;
let lensActive = false;
let shatterQueued = false;
let vortexActive = false;
let blackHoleActive = false;
let rainActive = false;
let swarmTargets: {
  x: number;
  y: number;
  r?: number;
  g?: number;
  b?: number;
  a?: number;
}[] = [];
let logoTemplate: {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  a: number;
}[] = [];
let energyFlash = 0; // Flash intensity for energy release events

/**
 * Generates structured targets. Uses sampled logo pixels if available,
 * otherwise falls back to concentric rings.
 */
function generateSwarmTargets() {
  swarmTargets = [];
  const centerX = width / 2;
  const centerY = height / 2;
  const scale = 200; // Base size of the logo formation on screen

  if (logoTemplate.length > 0) {
    for (let i = 0; i < 50; i++) {
      const template = logoTemplate[Math.floor((i / 50) * logoTemplate.length)];
      swarmTargets.push({
        x: centerX + template.x * scale,
        y: centerY + template.y * scale,
        r: template.r,
        g: template.g,
        b: template.b,
        a: template.a,
      });
    }
    return;
  }

  for (let i = 0; i < 50; i++) {
    // Formation: 3 concentric rings to mimic the Department of Roads circular seal
    const radius = i % 3 === 0 ? 65 : i % 3 === 1 ? 85 : 110;
    const angle = (i / 50) * Math.PI * 2;
    swarmTargets.push({
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    });
  }
}

// Global state for visual shockwaves (drawn in worker)
let shockwaves: { x: number; y: number; radius: number; opacity: number }[] =
  [];

self.onmessage = (e: MessageEvent) => {
  const { type, data } = e.data;

  if (type === "INIT") {
    width = data.width;
    height = data.height;
    generateSwarmTargets();
    if (data.canvas !== undefined && data.canvas !== null) {
      offscreenCanvas = data.canvas;
      ctx = offscreenCanvas!.getContext("2d");
    }
    particles = [];
    for (let i = 0; i < 50; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        s: Math.random() * 2 + 1,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        o: Math.random() * 0.4 + 0.1,
        hueOffset: (Math.random() - 0.5) * 30,
        lightnessOffset: (Math.random() - 0.5) * 0.12,
        inField: false,
        history: [],
      });
    }
  }

  if (type === "RESIZE") {
    width = data.width;
    height = data.height;
    // Resize the actual drawing buffer of the offscreen canvas
    if (offscreenCanvas) {
      offscreenCanvas.width = width;
      offscreenCanvas.height = height;
    }
    generateSwarmTargets();
  }

  if (type === "SET_LOGO_TEMPLATE") {
    const { buffer, size } = data;
    const pixels = new Uint8ClampedArray(buffer);
    logoTemplate = [];

    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 128) {
        // Only sample mostly opaque pixels
        const pIdx = i / 4;
        logoTemplate.push({
          x: (pIdx % size) / size - 0.5,
          y: Math.floor(pIdx / size) / size - 0.5,
          r: pixels[i],
          g: pixels[i + 1],
          b: pixels[i + 2],
          a: pixels[i + 3] / 255,
        });
      }
    }
    generateSwarmTargets();
  }

  if (type === "SET_RAIN") {
    rainActive = data.active;
  }

  if (type === "SET_LENS") {
    lensActive = data.active;
  }

  if (type === "SET_SWARM") {
    if (swarmActive && !data.active) {
      shatterQueued = true;
      energyFlash = 0.45; // Cinematic burst of light
    }
    swarmActive = data.active;
    if (swarmActive) {
      // Assign target colors to particles when swarm mode activates
      particles.forEach((p, idx) => {
        const target = swarmTargets[idx % swarmTargets.length];
        if (
          target.r !== undefined &&
          target.g !== undefined &&
          target.b !== undefined &&
          target.a !== undefined
        ) {
          p.swarmColor = { r: target.r, g: target.g, b: target.b, a: target.a };
        } else {
          p.swarmColor = undefined; // Fallback to default rendering
        }
      });
    } else {
      particles.forEach((p) => (p.swarmColor = undefined)); // Clear swarmColor when exiting swarm mode
    }
  }

  if (type === "SET_VORTEX") {
    vortexActive = data.active;
  }

  if (type === "SET_BLACK_HOLE") {
    blackHoleActive = data.active;
  }

  if (type === "INPUT") {
    mouseX = data.mouseX;
    mouseY = data.mouseY;
    risk = data.risk;
    bassIntensity = data.bassIntensity || 0;
  }

  if (type === "CLICK") {
    particles.forEach((p) => {
      const dx = p.x - data.x,
        dy = p.y - data.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      p.vx += (dx / dist) * 25;
      p.vy += (dy / dist) * 25;
    });
  }

  if (type === "UPDATE") {
    const speedMult = (1 + risk * 4) * timeScale;
    const centerX = width / 2;
    const centerY = height / 2;
    let proximityIntensity = 0;
    const events: string[] = [];

    if (shatterQueued) timeScale = 0.15; // Trigger slow-motion burst

    if (shatterQueued) {
      events.push("playShatter");
      // Spawn a massive central shockwave to emphasize the explosion origin
      shockwaves.push({ x: centerX, y: centerY, radius: 0, opacity: 1.0 });
    }

    particles.forEach((p, idx) => {
      // Shatter Effect: Explosive outward burst when formation is broken
      if (shatterQueued) {
        const dx = p.x - centerX;
        const dy = p.y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;

        // Shatter Physics: High-velocity radial burst + chaotic tangential spin
        const power = (25 + Math.random() * 30) / timeScale; // Compensate for slowdown
        const spin = (Math.random() - 0.5) * 12;
        const nx = dx / dist;
        const ny = dy / dist;

        p.vx += nx * power - ny * spin;
        p.vy += ny * power + nx * spin;
        p.history = []; // Clear trails to prevent visual artifacts during the burst
      }

      // Mouse Repulsion
      const mdx = p.x - mouseX,
        mdy = p.y - mouseY,
        mDistSq = mdx * mdx + mdy * mdy;
      if (mDistSq < 22500) {
        const mDist = Math.sqrt(mDistSq) || 1;
        p.vx += (mdx / mDist) * (1 - mDist / 150) * 0.4;
        p.vy += (mdy / mDist) * (1 - mDist / 150) * 0.4;
      }

      // Logo Magnetic Pull
      const ldx = centerX - p.x,
        ldy = centerY - p.y,
        lDistSq = ldx * ldx + ldy * ldy;
      const inFieldNow = lDistSq < 10000;

      // Signal main thread to play sound if state changed
      if (inFieldNow && !p.inField) events.push("playPop");
      p.inField = inFieldNow;

      if (inFieldNow) {
        const lDist = Math.sqrt(lDistSq) || 1,
          proximity = 1 - lDist / 100;
        p.vx += (ldx / lDist) * proximity * 0.12;
        p.vy += (ldy / lDist) * proximity * 0.12;
        proximityIntensity += proximity;
      }

      // Gravitational Lens Logic: Bend paths passing near the logo boundary
      if (lensActive) {
        const dist = Math.sqrt(lDistSq) || 1;
        // Effective range: just outside the logo (100px to 220px)
        if (dist > 100 && dist < 220) {
          // Force is strongest at the inner edge (100px) and tapers off at the outer boundary (220px)
          const lensStrength = (1 - (dist - 100) / 120) * 0.35;
          p.vx += (ldx / dist) * lensStrength;
          p.vy += (ldy / dist) * lensStrength;
        }
      }

      // Gravity at high risk
      if (risk > 0.4) {
        const dx = centerX - p.x,
          dy = centerY - p.y,
          dist = Math.sqrt(dx * dx + dy * dy) || 1;
        p.vx += (dx / dist) * risk * 0.015;
        p.vy += (dy / dist) * risk * 0.015;
        p.vx *= 0.99;
        p.vy *= 0.99;
      }

      // Swarm Logic: Target structured points
      if (swarmActive && swarmTargets.length > 0) {
        const target = swarmTargets[idx % swarmTargets.length];
        const tdx = target.x - p.x,
          tdy = target.y - p.y;
        // High stiffness attraction with strong damping to prevent oscillation
        p.vx += tdx * 0.04;
        p.vy += tdy * 0.04;
        p.vx *= 0.85;
        p.vy *= 0.85;
      }

      // Vortex Logic: Rotate around center instead of staying still
      if (vortexActive) {
        const dx = p.x - centerX;
        const dy = p.y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const invDist = 1 / dist;
        const nx = dx * invDist; // Normalized X
        const ny = dy * invDist; // Normalized Y

        // Tangential force (perpendicular to radius) for rotation
        const orbitSpeed = 0.6;
        p.vx += -ny * orbitSpeed;
        p.vy += nx * orbitSpeed;

        // Loose centripetal force to maintain a ring around the logo (110px radius)
        const pull = (110 - dist) * 0.012;
        p.vx += nx * pull;
        p.vy += ny * pull;
      }

      // Black Hole Logic: Sucked into center and reborn at edges
      if (blackHoleActive) {
        const dx = centerX - p.x;
        const dy = centerY - p.y;
        const distSq = dx * dx + dy * dy;
        const dist = Math.sqrt(distSq) || 1;

        // Apply suction force (Modulated by music bass frequencies)
        const suctionStrength = 1.2 + bassIntensity * 3.0;
        p.vx += (dx / dist) * suctionStrength;
        p.vy += (dy / dist) * suctionStrength;

        // Check for "Event Horizon" (Consumption)
        if (dist < 15) {
          // Reset to a random edge with slight buffer
          const edge = Math.floor(Math.random() * 4);
          if (edge === 0) {
            p.x = Math.random() * width;
            p.y = -20;
          } else if (edge === 1) {
            p.x = Math.random() * width;
            p.y = height + 20;
          } else if (edge === 2) {
            p.x = -20;
            p.y = Math.random() * height;
          } else {
            p.x = width + 20;
            p.y = Math.random() * height;
          }

          p.vx = (Math.random() - 0.5) * 0.4;
          p.vy = (Math.random() - 0.5) * 0.4;
          p.history = []; // Instant teleport, clear trail to avoid artifacts
          events.push("playShockwavePop"); // Signal main thread for audio
          shockwaves.push({ x: p.x, y: p.y, radius: 0, opacity: 1 }); // Create visual shockwave
        }
      }

      // Rain Logic: Fall from top and splash against logo
      if (rainActive) {
        p.vy += 0.15; // Constant downward gravity

        const ldx = centerX - p.x;
        const ldy = centerY - p.y;
        const dist = Math.sqrt(ldx * ldx + ldy * ldy) || 1;

        // Collision detection with the logo boundary (approx 80px radius)
        if (dist < 80) {
          // Splash Physics: Reverse vertical velocity and scatter horizontally
          p.vy = -Math.abs(p.vy) * 0.6;
          p.vx += (Math.random() - 0.5) * 8;

          // Visual feedback
          if (Math.random() > 0.8) events.push("playSplash");
          shockwaves.push({ x: p.x, y: p.y, radius: 0, opacity: 0.4 });
        }

        // Rebirth logic: If droplet leaves bottom, reset to random top position
        if (p.y > height + 20) {
          p.y = -30;
          p.x = Math.random() * width;
          p.vy = 2 + Math.random() * 4;
          p.vx = (Math.random() - 0.5) * 0.5;
          p.history = [];
        }
      }

      p.vx *= 0.98;
      p.vy *= 0.98;
      p.history.push({ x: p.x, y: p.y });
      if (p.history.length > 6) p.history.shift();

      const nextX = (p.x + p.vx * speedMult + width) % width;
      const nextY = (p.y + p.vy * speedMult + height) % height;

      // Wrap detection for trails
      if (Math.abs(nextX - p.x) > 100 || Math.abs(nextY - p.y) > 100)
        p.history = [];

      p.x = nextX;
      p.y = nextY;
    });

    if (shatterQueued) shatterQueued = false;
    timeScale += (1.0 - timeScale) * 0.05; // Organic recovery to normal speed

    // Render Logic (Now optimized for OffscreenCanvas in the worker)
    if (ctx) {
      const baseHue = 140 - risk * 140;
      ctx.clearRect(0, 0, width, height);

      // Draw Energy Flash over the background during the shatter frame
      if (energyFlash > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${energyFlash})`;
        ctx.fillRect(0, 0, width, height);
        energyFlash *= 0.9; // Fast organic decay
        if (energyFlash < 0.01) energyFlash = 0;
      }

      // Create a global Vertical Gradient for particles to match AudioEngine style
      const globalGradient = ctx.createLinearGradient(0, 0, 0, height);
      globalGradient.addColorStop(0, `hsla(${baseHue}, 100%, 70%, 0.8)`);
      globalGradient.addColorStop(0.5, `hsla(${baseHue}, 80%, 40%, 0.5)`);
      globalGradient.addColorStop(1, `hsla(${baseHue}, 100%, 70%, 0.8)`);

      const standardPath = new Path2D();
      const whitePath = new Path2D();
      const trianglePath = new Path2D();
      const historyPaths = Array.from({ length: 6 }, () => new Path2D());

      particles.forEach((p) => {
        // 1. Batch History Geometry
        p.history.forEach((point, idx) => {
          const ratio = (idx + 1) / 6;
          historyPaths[idx].moveTo(point.x + p.s * ratio, point.y);
          historyPaths[idx].arc(point.x, point.y, p.s * ratio, 0, Math.PI * 2);
        });

        // 2. Batch Main Geometry
        if (p.inField) {
          whitePath.moveTo(p.x + p.s, p.y);
          whitePath.arc(p.x, p.y, p.s, 0, Math.PI * 2);
        } else if (swarmActive && p.swarmColor) {
          // When in swarm mode with specific colors, draw individually
          // This bypasses the Path2D batching for these specific particles
          // but is acceptable for 50 particles.
          ctx!.globalAlpha = p.o;
          ctx!.fillStyle = `rgba(${p.swarmColor.r}, ${p.swarmColor.g}, ${p.swarmColor.b}, ${p.swarmColor.a * p.o})`;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.s, 0, Math.PI * 2);
          ctx!.fill();
        } else if (risk > 0.7 || energyFlash > 0.1) {
          // High alert or active shatter glow
          const angle = Math.atan2(p.vy, p.vx),
            triSize = p.s * 1.5;
          trianglePath.moveTo(
            p.x + Math.cos(angle) * triSize,
            p.y + Math.sin(angle) * triSize,
          );
          trianglePath.lineTo(
            p.x + Math.cos(angle + 2.3) * triSize,
            p.y + Math.sin(angle + 2.3) * triSize,
          );
          trianglePath.lineTo(
            p.x + Math.cos(angle - 2.3) * triSize,
            p.y + Math.sin(angle - 2.3) * triSize,
          );
          trianglePath.closePath();
        } else {
          standardPath.moveTo(p.x + p.s, p.y);
          standardPath.arc(p.x, p.y, p.s, 0, Math.PI * 2);
        }
      });

      // 3. Execute Batched Fills (Major performance boost)
      // Draw Trails first
      historyPaths.forEach((path, idx) => {
        ctx!.globalAlpha = 0.05 * ((idx + 1) / 6); // Subtle fading trails
        ctx!.fillStyle = globalGradient;
        ctx!.fill(path);
      });

      // Draw Main Particles
      ctx!.globalAlpha = 0.8;
      ctx!.fillStyle = "white";
      ctx!.fill(whitePath);
      ctx!.fillStyle = globalGradient;
      // Only fill standard and triangle paths if not in swarm mode,
      // as swarm particles are drawn individually above.
      if (!swarmActive) {
        ctx!.fill(standardPath);
        ctx!.fill(trianglePath);
      } else {
        // If swarm is active, ensure other paths are still drawn if they contain anything
        // (e.g., if some particles are not in swarmColor state for some reason)
        // This might be redundant if all particles have swarmColor when swarmActive.
        // For safety, we can fill them, but they might be empty.
        ctx!.fill(standardPath); // Will be empty if all particles are in swarmColor
        ctx!.fill(trianglePath); // Will be empty if all particles are in swarmColor
      }

      // 4. Batch and update shockwaves
      shockwaves = shockwaves.filter((sw) => sw.opacity > 0); // Remove faded shockwaves
      const shockPath = new Path2D();
      shockwaves.forEach((sw) => {
        sw.radius += 2; // Expand
        sw.opacity -= 0.02; // Fade out
        shockPath.moveTo(sw.x + sw.radius, sw.y);
        shockPath.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      });
      ctx!.globalAlpha = 0.4;
      ctx!.strokeStyle = "white";
      ctx!.lineWidth = 2;
      ctx!.stroke(shockPath);
    }

    self.postMessage({
      // Efficiency: No longer need to transfer the large particles array back to main thread
      // as the OffscreenCanvas has already handled the painting.
      proximityIntensity,
      events,
      bassIntensity, // Send bass intensity back to main thread for logo sync
    });
  }
};
