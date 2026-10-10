// Procedural Watch Party "cinema" scene (Three.js). No external assets, fonts, textures or models:
// everything is generated here (screen shader, orbiting seat orbs, star field, floor glow).
//
//  - hero  : the landing/auth scene. Drag to rotate, hover the screen to light it, click it (or press the
//            real CTA button) to dive through the screen ("portal") into the app.
//  - calm  : same scene, quieter, as a backdrop behind forms.
//  - room  : lightweight backdrop for the watch room. One orb per person (colour = role), the screen glow
//            reacts to play/pause. It sits BEHIND the side panels; the video itself stays flat and crisp.
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  PointLight,
  Quaternion,
  Raycaster,
  Scene,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";

const VARIANTS = {
  hero: {
    stars: 900,
    seatsMax: 22,
    cam: [0, 0.35, 7.2],
    screenPos: [0, 0.25, 0],
    screenScale: 1,
    fpsCap: 60,
    dpr: 1.75,
  },
  calm: {
    stars: 500,
    seatsMax: 14,
    cam: [0, 0.3, 8.6],
    screenPos: [0, 0.1, 0],
    screenScale: 0.9,
    fpsCap: 45,
    dpr: 1.5,
  },
  room: {
    stars: 350,
    seatsMax: 40,
    cam: [0, 0.2, 9.5],
    screenPos: [0, 0.0, 0],
    screenScale: 0.8,
    fpsCap: 30,
    dpr: 1.25,
  },
};

const ROLE_COLORS = {
  host: "#fbbf24",
  moderator: "#a78bfa",
  user: "#fb7185",
  guest: "#2dd4bf",
  default: "#94a3b8",
};

function roundedRect(w, h, r) {
  const s = new Shape();
  const x = -w / 2,
    y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

const SCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
// Flowing aurora + a play glyph. uPlaying (0..1) swaps the glyph for a calm pulse; uHover brightens.
const SCREEN_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime, uHover, uPlaying;
  float sdTriangle(vec2 p, float r) {
    const float k = 1.7320508;
    p.x = abs(p.x) - r; p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
  }
  void main() {
    vec2 uv = vUv; vec2 p = (uv - 0.5) * vec2(1.78, 1.0);
    float t = uTime * 0.35;
    float w = sin(p.x * 3.0 + t * 1.6) * 0.25 + sin(p.x * 5.5 - t * 1.1 + p.y * 3.0) * 0.12;
    float band = smoothstep(0.35, 0.0, abs(p.y - w * 0.8));
    float band2 = smoothstep(0.5, 0.0, abs(p.y + 0.22 - sin(p.x * 2.2 - t) * 0.2));
    vec3 coral = vec3(0.98, 0.35, 0.42), violet = vec3(0.55, 0.40, 0.98), cyan = vec3(0.20, 0.78, 0.92);
    vec3 col = vec3(0.04, 0.05, 0.10);
    col += coral * band * 0.75 + violet * band2 * 0.8 + cyan * smoothstep(0.7, 0.0, length(p - vec2(0.45, -0.15))) * 0.25;
    col += 0.04 * sin(uv.y * 900.0);                                  // faint scanlines
    float d = sdTriangle(p * 4.0, 0.42);
    float glyph = smoothstep(0.02, -0.02, d) * (1.0 - uPlaying);
    float ring = smoothstep(0.03, 0.0, abs(length(p) - (0.26 + 0.02 * sin(uTime * 3.0)))) * uPlaying * 0.35;
    col = mix(col, vec3(1.0), glyph * 0.92) + ring;
    col *= 0.85 + uHover * 0.5 + uPlaying * 0.1;
    col *= smoothstep(0.95, 0.35, length((uv - 0.5) * 1.25));         // vignette
    gl_FragColor = vec4(col, 1.0);
  }
`;
const FLOOR_FRAG = /* glsl */ `
  precision highp float; varying vec2 vUv; uniform float uPlaying;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    vec3 c = mix(vec3(0.55, 0.30, 0.95), vec3(0.98, 0.35, 0.42), 0.5 + 0.5 * sin(d * 3.0));
    gl_FragColor = vec4(c, smoothstep(1.0, 0.0, d) * (0.16 + 0.10 * uPlaying));
  }
`;

/**
 * Where the hero scene sits in the viewport so it never covers the headline and the Start/Join
 * controls: to the right on landscape screens, in the lower part on portrait screens.
 * Returns the arguments of PerspectiveCamera.setViewOffset, or null for "centred, no offset".
 */
export function heroViewOffset(width, height) {
  if (!(width > 0 && height > 0)) return null;
  const landscape = width / height >= 1.05;
  const zoom = landscape ? 0.85 : 0.72; // <1 makes the scene smaller on screen
  const fullW = width * zoom;
  const fullH = height * zoom;
  const cx = landscape ? 0.69 : 0.5; // desired scene centre, as a fraction of the viewport
  const cy = landscape ? 0.54 : 0.74;
  return { fullW, fullH, x: fullW / 2 - cx * width, y: fullH / 2 - cy * height, width, height };
}

/**
 * Builds the scene graph and an `update` function. Contains no renderer, so it can be unit-tested
 * in Node/jsdom (no WebGL needed).
 */
export function buildScene(variant = "hero") {
  const cfg = VARIANTS[variant] || VARIANTS.hero;
  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(...cfg.cam);

  const world = new Group(); // everything that rotates with pointer/drag
  scene.add(world);

  // ---- the screen --------------------------------------------------------------------------------
  const screen = new Group();
  screen.position.set(...cfg.screenPos);
  screen.scale.setScalar(cfg.screenScale);
  const frame = new Mesh(
    new ExtrudeGeometry(roundedRect(4.5, 2.6, 0.2), {
      depth: 0.14,
      bevelEnabled: true,
      bevelSize: 0.03,
      bevelThickness: 0.03,
      bevelSegments: 3,
      curveSegments: 10,
    }),
    new MeshStandardMaterial({ color: "#0b0f1a", metalness: 0.85, roughness: 0.32 }),
  );
  frame.position.z = -0.1;
  const displayMaterial = new ShaderMaterial({
    vertexShader: SCREEN_VERT,
    fragmentShader: SCREEN_FRAG,
    uniforms: { uTime: { value: 0 }, uHover: { value: 0 }, uPlaying: { value: 0 } },
  });
  const display = new Mesh(new ShapeGeometry(roundedRect(4.2, 2.3, 0.14), 10), displayMaterial);
  // ShapeGeometry UVs are in shape units; remap to 0..1 so the shader's uv works.
  const uv = display.geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 4.2 + 0.5, uv.getY(i) / 2.3 + 0.5);
  uv.needsUpdate = true;
  display.position.z = 0.075;
  screen.add(frame, display);
  world.add(screen);

  // ---- floor glow --------------------------------------------------------------------------------
  const floorMaterial = new ShaderMaterial({
    vertexShader: SCREEN_VERT,
    fragmentShader: FLOOR_FRAG,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: { uPlaying: { value: 0 } },
  });
  const floor = new Mesh(new CircleGeometry(8, 64), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.1;
  world.add(floor);

  // ---- seats: one orb per person --------------------------------------------------------------------
  const seatGeometry = new IcosahedronGeometry(0.13, 1);
  const seatMaterial = new MeshStandardMaterial({
    roughness: 0.35,
    metalness: 0.2,
    emissive: new Color("#ffffff"),
    emissiveIntensity: 0.12,
  });
  const seats = new InstancedMesh(seatGeometry, seatMaterial, cfg.seatsMax);
  seats.count = 0;
  seats.frustumCulled = false;
  world.add(seats);
  let seatCount = 0;
  const seatColors = [];
  const dummy = new Object3D();

  function setParticipants(list = []) {
    const items = list.slice(0, cfg.seatsMax);
    seatCount = items.length;
    seats.count = seatCount;
    seatColors.length = 0;
    items.forEach((p, i) => {
      const key =
        p.role === "host"
          ? "host"
          : p.role === "moderator"
            ? "moderator"
            : p.kind === "guest"
              ? "guest"
              : "user";
      const c = new Color(ROLE_COLORS[key] || ROLE_COLORS.default);
      if (p.online === false) c.multiplyScalar(0.35);
      seats.setColorAt(i, c);
      seatColors.push(c);
    });
    if (seats.instanceColor) seats.instanceColor.needsUpdate = true;
  }
  // Decorative default so the hero is never empty.
  if (variant !== "room") {
    setParticipants(
      Array.from({ length: cfg.seatsMax }, (_, i) => ({
        role: i === 0 ? "host" : i % 5 === 0 ? "moderator" : "participant",
        kind: i % 3 === 0 ? "guest" : "user",
      })),
    );
  }

  // ---- stars -----------------------------------------------------------------------------------------
  const starPositions = new Float32Array(cfg.stars * 3);
  const v = new Vector3();
  for (let i = 0; i < cfg.stars; i++) {
    v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
      .normalize()
      .multiplyScalar(18 + Math.random() * 40);
    starPositions.set([v.x, v.y, v.z], i * 3);
  }
  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute("position", new BufferAttribute(starPositions, 3));
  const stars = new Points(
    starGeometry,
    new PointsMaterial({
      color: "#cbd5e1",
      size: 0.07,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    }),
  );
  scene.add(stars);

  // ---- lights ----------------------------------------------------------------------------------------
  scene.add(new AmbientLight("#8ea0c8", 0.55));
  const warm = new PointLight("#fb7185", 38, 30, 2);
  warm.position.set(-4.5, 2.5, 4.5);
  const cool = new PointLight("#8b5cf6", 34, 30, 2);
  cool.position.set(4.5, -1.2, 3.8);
  scene.add(warm, cool);

  // ---- interaction state -------------------------------------------------------------------------------
  const state = {
    playing: 0,
    playingTarget: 0,
    hover: 0,
    hoverTarget: 0,
    dive: 0,
    diveTarget: 0,
    yaw: 0,
    pitch: 0,
    dragYaw: 0,
    activated: false,
  };
  const raycaster = new Raycaster();
  const ndc = new Vector2();

  function hitTest(x, y) {
    ndc.set(x, y);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObject(display, false).length > 0;
  }

  const seatMatrix = new Matrix4();
  const q = new Quaternion();
  void seatMatrix;
  void q;

  /**
   * Advances the scene. `input` = { px, py (pointer, -1..1), dragYaw (radians), hover (bool), reduced (bool) }.
   * Returns true the first time the dive (portal) animation completes.
   */
  function update(dt, t, input = {}) {
    const k = 1 - Math.pow(0.001, dt); // frame-rate independent easing
    const reduced = Boolean(input.reduced);
    state.hoverTarget = input.hover ? 1 : 0;
    state.hover += (state.hoverTarget - state.hover) * k;
    state.playing += (state.playingTarget - state.playing) * k;
    state.dive += (state.diveTarget - state.dive) * (1 - Math.pow(0.02, dt));

    displayMaterial.uniforms.uTime.value = reduced ? 3.2 : t;
    displayMaterial.uniforms.uHover.value = state.hover;
    displayMaterial.uniforms.uPlaying.value = state.playing;
    floorMaterial.uniforms.uPlaying.value = state.playing;

    const px = reduced ? 0 : input.px || 0;
    const py = reduced ? 0 : input.py || 0;
    state.yaw += (px * 0.38 + (input.dragYaw || 0) - state.yaw) * k;
    state.pitch += (-py * 0.2 - state.pitch) * k;
    world.rotation.y = state.yaw;
    world.rotation.x = state.pitch;

    // dive through the screen
    camera.position.z = MathUtils.lerp(cfg.cam[2], 2.4, state.dive);
    camera.position.x = MathUtils.lerp(cfg.cam[0], 0, state.dive);
    camera.position.y = MathUtils.lerp(cfg.cam[1], cfg.screenPos[1], state.dive);
    camera.lookAt(0, cfg.screenPos[1] * (1 - state.dive * 0.5), 0);

    if (!reduced) {
      stars.rotation.y = t * 0.012;
      // seats orbit on two rings and bob gently
      for (let i = 0; i < seatCount; i++) {
        const ring = i % 2;
        const radius = (ring ? 4.2 : 3.4) + (variant === "room" ? 0.4 : 0);
        const a = t * (ring ? -0.07 : 0.1) + (i / Math.max(1, seatCount)) * Math.PI * 2;
        dummy.position.set(
          Math.cos(a) * radius,
          -0.9 + Math.sin(t * 0.9 + i) * 0.12 + ring * 0.35,
          Math.sin(a) * radius * 0.55 - 1.2,
        );
        dummy.scale.setScalar(1 + 0.08 * Math.sin(t * 2 + i) * state.playing);
        dummy.updateMatrix();
        seats.setMatrixAt(i, dummy.matrix);
      }
    } else {
      for (let i = 0; i < seatCount; i++) {
        const ring = i % 2;
        const radius = (ring ? 4.2 : 3.4) + (variant === "room" ? 0.4 : 0);
        const a = (i / Math.max(1, seatCount)) * Math.PI * 2;
        dummy.position.set(
          Math.cos(a) * radius,
          -0.9 + ring * 0.35,
          Math.sin(a) * radius * 0.55 - 1.2,
        );
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        seats.setMatrixAt(i, dummy.matrix);
      }
    }
    seats.instanceMatrix.needsUpdate = true;

    if (state.diveTarget === 1 && state.dive > 0.97 && !state.activated) {
      state.activated = true;
      return true;
    }
    return false;
  }

  function dispose() {
    scene.traverse((o) => {
      o.geometry?.dispose?.();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
      else m?.dispose?.();
    });
    seats.dispose?.();
  }

  return {
    scene,
    camera,
    update,
    dispose,
    hitTest,
    setParticipants,
    setPlaying: (on) => {
      state.playingTarget = on ? 1 : 0;
    },
    startDive: () => {
      state.diveTarget = 1;
    },
    resetDive: () => {
      state.diveTarget = 0;
      state.activated = false;
    },
    get seatCount() {
      return seatCount;
    },
    get state() {
      return state;
    },
    cfg,
  };
}

/**
 * Mounts the scene on a canvas with a renderer, input handling and a render loop.
 * Returns a controller. Callbacks: onActivate() after the portal dive; onContextLost().
 */
export function mountScene({
  canvas,
  variant = "hero",
  mode = "full",
  interactive = true,
  onActivate,
  onContextLost,
}) {
  const built = buildScene(variant);
  const reduced = mode === "static";
  const renderer = new WebGLRenderer({
    canvas,
    antialias: variant === "hero",
    alpha: true,
    powerPreference: variant === "room" ? "low-power" : "default",
  });
  renderer.setClearColor(0x000000, 0);

  const input = { px: 0, py: 0, dragYaw: 0, hover: false, reduced };
  let width = 0,
    height = 0,
    raf = 0,
    last = 0,
    lastRender = 0,
    running = false,
    visible = true,
    disposed = false;
  let dragging = false,
    dragStartX = 0,
    dragBase = 0,
    moved = false;
  const clock0 = performance.now();

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, Math.floor(rect.width));
    height = Math.max(1, Math.floor(rect.height));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, built.cfg.dpr));
    renderer.setSize(width, height, false);
    built.camera.aspect = width / height;
    // On narrow screens pull the camera back so the whole screen stays in view.
    built.camera.fov = width / height < 0.8 ? 62 : 45;
    const off = variant === "hero" ? heroViewOffset(width, height) : null;
    if (off) built.camera.setViewOffset(off.fullW, off.fullH, off.x, off.y, off.width, off.height);
    else built.camera.clearViewOffset();
    built.camera.updateProjectionMatrix();
    renderOnce();
  }

  function renderFrame(now) {
    const t = (now - clock0) / 1000;
    const dt = Math.min(0.05, Math.max(0.001, (now - (last || now)) / 1000));
    last = now;
    const done = built.update(dt, t, input);
    renderer.render(built.scene, built.camera);
    if (done) onActivate?.();
  }

  function renderOnce() {
    if (disposed) return;
    // Static mode (and the first paint of full mode) draws a single frame.
    const now = performance.now();
    last = now - 16;
    for (let i = 0; i < 3; i++) renderFrame(now + i * 16); // a few steps so easing settles
  }

  function loop(now) {
    if (!running || disposed) return;
    raf = requestAnimationFrame(loop);
    if (!visible || document.hidden) return;
    const minGap = 1000 / built.cfg.fpsCap;
    if (now - lastRender < minGap - 1) return;
    lastRender = now;
    renderFrame(now);
  }

  function start() {
    if (running || reduced) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  // ---- input (only for interactive scenes) ---------------------------------------------------------------
  const toNdc = (e) => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)];
  };
  const onMove = (e) => {
    const [x, y] = toNdc(e);
    input.px = MathUtils.clamp(x, -1, 1);
    input.py = MathUtils.clamp(y, -1, 1);
    input.hover = built.hitTest(x, y);
    canvas.style.cursor =
      input.hover && variant === "hero" ? "pointer" : dragging ? "grabbing" : "grab";
    if (dragging) {
      if (Math.abs(e.clientX - dragStartX) > 4) moved = true;
      input.dragYaw = MathUtils.clamp(
        dragBase + ((e.clientX - dragStartX) / width) * 3.2,
        -1.2,
        1.2,
      );
    }
    if (reduced) renderOnce();
  };
  const onDown = (e) => {
    dragging = true;
    moved = false;
    dragStartX = e.clientX;
    dragBase = input.dragYaw;
    canvas.setPointerCapture?.(e.pointerId);
  };
  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    canvas.releasePointerCapture?.(e.pointerId);
    const [x, y] = toNdc(e);
    if (!moved && variant === "hero" && built.hitTest(x, y)) controller.activate();
    // ease the drag back to centre so the scene always settles facing the viewer
    input.dragYaw = 0;
    if (reduced) renderOnce();
  };
  const onLeave = () => {
    input.hover = false;
    input.px = 0;
    input.py = 0;
    if (reduced) renderOnce();
  };

  if (interactive) {
    canvas.style.touchAction = "pan-y"; // vertical scroll still works; horizontal drag rotates
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
  }

  const onLost = (e) => {
    e.preventDefault();
    stop();
    onContextLost?.();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  let ro = null,
    io = null;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => resize());
    ro.observe(canvas);
  }
  if (typeof IntersectionObserver !== "undefined") {
    io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    io.observe(canvas);
  }
  const onVisibility = () => {
    if (!document.hidden && running) last = 0;
  };
  document.addEventListener("visibilitychange", onVisibility);

  resize();
  start();

  const controller = {
    setState({ playing, participants }) {
      if (typeof playing === "boolean") built.setPlaying(playing);
      if (participants) built.setParticipants(participants);
      if (reduced) renderOnce();
    },
    /** The "portal": dive through the screen, then call onActivate. Reduced motion skips the animation. */
    activate() {
      if (reduced) {
        onActivate?.();
        return;
      }
      built.startDive();
    },
    resetDive() {
      built.resetDive();
    },
    resize,
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      ro?.disconnect();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      if (interactive) {
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
        canvas.removeEventListener("pointerleave", onLeave);
      }
      built.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
  return controller;
}
