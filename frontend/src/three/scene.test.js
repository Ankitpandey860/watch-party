// The scene graph and its update logic have no renderer dependency, so they are tested here without WebGL.
import { describe, test, expect, vi } from "vitest";
import { buildScene, heroViewOffset } from "./scene";

const people = (n) =>
  Array.from({ length: n }, (_, i) => ({
    role: i === 0 ? "host" : "participant",
    kind: i % 2 ? "guest" : "user",
    online: i !== 2,
  }));

describe.each(["hero", "calm", "room"])("buildScene(%s)", (variant) => {
  test("builds a scene with a screen, stars, floor and lights", () => {
    const b = buildScene(variant);
    expect(b.scene.children.length).toBeGreaterThanOrEqual(5);
    expect(b.camera.position.z).toBeGreaterThan(5);
    b.dispose();
  });

  test("update() runs for many frames with pointer input, hover and reduced-motion without throwing", () => {
    const b = buildScene(variant);
    expect(() => {
      for (let i = 0; i < 120; i++)
        b.update(0.016, i * 0.016, {
          px: Math.sin(i),
          py: Math.cos(i),
          hover: i % 2 === 0,
          dragYaw: 0.3,
        });
      for (let i = 0; i < 20; i++) b.update(0.016, i, { reduced: true });
    }).not.toThrow();
    b.dispose();
  });

  test("seats follow the participant list and are capped", () => {
    const b = buildScene(variant);
    b.setParticipants(people(5));
    expect(b.seatCount).toBe(5);
    b.setParticipants(people(500));
    expect(b.seatCount).toBe(b.cfg.seatsMax);
    b.setParticipants([]);
    expect(b.seatCount).toBe(0);
    b.dispose();
  });

  test("the portal dive completes exactly once and can be reset", () => {
    const b = buildScene(variant);
    b.startDive();
    let completions = 0;
    for (let i = 0; i < 600; i++) if (b.update(0.016, i * 0.016, {})) completions++;
    expect(completions).toBe(1);
    expect(b.camera.position.z).toBeLessThan(b.cfg.cam[2]);
    b.resetDive();
    for (let i = 0; i < 600; i++) b.update(0.016, i * 0.016, {});
    expect(b.camera.position.z).toBeGreaterThan(b.cfg.cam[2] - 0.2);
    b.dispose();
  });

  test("play/pause drives the screen glow uniform smoothly", () => {
    const b = buildScene(variant);
    b.setPlaying(true);
    for (let i = 0; i < 200; i++) b.update(0.016, i * 0.016, {});
    expect(b.state.playing).toBeGreaterThan(0.95);
    b.setPlaying(false);
    for (let i = 0; i < 200; i++) b.update(0.016, i * 0.016, {});
    expect(b.state.playing).toBeLessThan(0.05);
    b.dispose();
  });

  test("dispose() releases geometries and materials (no GPU leak)", () => {
    const b = buildScene(variant);
    const disposables = [];
    b.scene.traverse((o) => {
      if (o.geometry) {
        const spy = vi.spyOn(o.geometry, "dispose");
        disposables.push(spy);
      }
      if (o.material && !Array.isArray(o.material)) {
        const spy = vi.spyOn(o.material, "dispose");
        disposables.push(spy);
      }
    });
    b.dispose();
    expect(disposables.length).toBeGreaterThan(6);
    expect(disposables.every((s) => s.mock.calls.length >= 1)).toBe(true);
  });
});

describe("hit testing", () => {
  test("the centre of the screen is a hit; a far corner is not", () => {
    const b = buildScene("hero");
    b.update(0.016, 0, {});
    b.scene.updateMatrixWorld(true);
    b.camera.updateMatrixWorld(true);
    expect(b.hitTest(0, 0.05)).toBe(true);
    expect(b.hitTest(0.98, 0.98)).toBe(false);
    b.dispose();
  });
});

describe("heroViewOffset", () => {
  test("landscape: scene centre lands right of the headline, inside the viewport", () => {
    const o = heroViewOffset(1440, 900);
    const centreX = o.fullW / 2 - o.x; // where the scene centre appears, in viewport px
    const centreY = o.fullH / 2 - o.y;
    expect(centreX / 1440).toBeCloseTo(0.69, 5);
    expect(centreY / 900).toBeCloseTo(0.54, 5);
    expect(o.fullW).toBeLessThan(o.width); // scaled down so it does not overpower the copy
  });
  test("portrait: scene sits in the lower part, horizontally centred", () => {
    const o = heroViewOffset(390, 844);
    expect((o.fullW / 2 - o.x) / 390).toBeCloseTo(0.5, 5);
    expect((o.fullH / 2 - o.y) / 844).toBeCloseTo(0.74, 5);
  });
  test("degenerate sizes give no offset", () => {
    expect(heroViewOffset(0, 0)).toBeNull();
  });
});
