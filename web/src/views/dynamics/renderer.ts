// cspell:ignore glsl highp fract
/**
 * @file Mesh renders the cover's palette on a canvas behind Now Playing.
 *
 * A new palette fades in over the last. The canvas is drawn on every
 * frame the display shows, so the motion is smooth, at half the page's resolution, as
 * nothing in it is sharp, and not at all while the page is hidden. Still, for a device
 * asking for less motion, it is drawn only when the cover changes.
 *
 * This module is loaded only when Now Playing shows an effect, so the page without one
 * never loads the WebGL library.
 */

import { Mesh, Program, Renderer, Triangle } from "ogl";

import { type Color, paletteOf } from "../../library/palette";
import { framePacing } from "./framePacing";

/** The size of the copy used to read the palette, in pixels a side. */
const COPY = 160;
/** How far the copy is blurred, in its own pixels, so no detail of the cover shows. */
const COPY_BLUR = 6;
/** How many colors *Mesh* blends. */
const COLORS = 5;
/** How long a new cover takes to fade in, in milliseconds. */
const FADE_MS = 1600;
/** How many canvas pixels each CSS pixel has; the effects are blurred, so few are needed. */
const RESOLUTION = 0.5;

/** An effect running on a canvas: give it each cover to show, and stop it when done. */
export interface Running {
  /** Fade to the cover at `url`, or to none. */
  readonly show: (url: string | null) => void;
  readonly stop: () => void;
}

const VERTEX = /* glsl */ `#version 300 es
in vec2 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0., 1.);
}`;

const MESH = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 color;
uniform float uFade;
uniform float uTime;
uniform vec2 uAspect;
uniform vec3 uColors[${String(COLORS)}];
uniform vec3 uLastColors[${String(COLORS)}];

vec3 vivid(vec3 c, float by) { return mix(vec3(dot(c, vec3(.299, .587, .114))), c, by); }

void main() {
  vec2 p = vUv * uAspect;
  float t = uTime * .07;
  vec3 sum = vec3(0.);
  float weights = 0.;
  for (int i = 0; i < ${String(COLORS)}; i++) {
    float f = float(i);
    vec2 at = (vec2(.5) + .4 * vec2(sin(t * (.7 + .13 * f) + f * 2.1), cos(t * (.5 + .11 * f) + f * 1.3))) * uAspect;
    float w = 1. / pow(distance(p, at) + .08, 2.4);
    sum += mix(uLastColors[i], uColors[i], uFade) * w;
    weights += w;
  }
  color = vec4(vivid(sum / weights, 1.2) * .8, 1.);
}`;

/**
 * Draw Mesh on a canvas added to `host`, still when `still`; `onDrawn` is told when
 * a cover is first drawn, or when there is none to draw. Throws without WebGL 2.
 */
export function run(
  host: HTMLElement,
  {
    still,
    onDrawn,
    onSlow,
  }: {
    readonly still: boolean;
    readonly onDrawn: (drawn: boolean) => void;
    readonly onSlow: () => void;
  },
): Running {
  const renderer = new Renderer({ dpr: RESOLUTION, alpha: false, antialias: false });
  const gl = renderer.gl;
  if (!renderer.isWebgl2) {
    throw new Error("Dynamics need WebGL 2.");
  }
  const canvas = gl.canvas;
  host.appendChild(canvas);
  // ogl sets an array uniform from a plain array of its items, not a typed array.
  const listOf = (colors: readonly Color[]) => colors.map((color) => [...color]);
  const dark = listOf(Array.from({ length: COLORS }, (): Color => [0.06, 0.08, 0.07]));
  // The program reads these very objects, so setting a value here sets the uniform.
  const uniforms = {
    uFade: { value: 1 },
    uTime: { value: 0 },
    uAspect: { value: [1, 1] },
    uColors: { value: dark },
    uLastColors: { value: dark },
  };
  const program = new Program(gl, { vertex: VERTEX, fragment: MESH, uniforms });
  const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

  let fadeFrom = 0;
  let frame = 0;
  let hasCover = false;
  let stopped = false;
  const pacing = framePacing();

  const draw = (now: number) => {
    if (stopped) return;
    uniforms.uTime.value = still ? 40 : now / 1000;
    uniforms.uFade.value = still ? 1 : Math.min(1, (now - fadeFrom) / FADE_MS);
    renderer.render({ scene: mesh });
  };
  const loop = (now: number) => {
    if (stopped || document.hidden) return;
    if (pacing.slowAt(now)) {
      onSlow();
      return;
    }
    frame = requestAnimationFrame(loop);
    draw(now);
  };
  const play = () => {
    pacing.reset();
    cancelAnimationFrame(frame);
    if (!still && hasCover && !document.hidden && !stopped) {
      frame = requestAnimationFrame(loop);
    }
  };
  const resize = () => {
    if (stopped) return;
    renderer.setSize(host.clientWidth, host.clientHeight);
    const ratio = host.clientWidth / Math.max(1, host.clientHeight);
    uniforms.uAspect.value = ratio > 1 ? [ratio, 1] : [1, 1 / ratio];
    if (hasCover) {
      draw(performance.now());
    }
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  document.addEventListener("visibilitychange", play);
  resize();

  // Each cover asked for is read in turn; one read after another was asked for is dropped.
  let asked = 0;
  const show = (url: string | null) => {
    if (stopped) return;
    pacing.reset();
    asked += 1;
    const ask = asked;
    if (url === null) {
      hasCover = false;
      play();
      onDrawn(false);
      return;
    }
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    image
      .decode()
      .then(() => {
        if (ask !== asked || stopped) {
          return;
        }
        const copy = document.createElement("canvas");
        copy.width = COPY;
        copy.height = COPY;
        const context = copy.getContext("2d", { willReadFrequently: true });
        if (context === null) {
          return;
        }
        context.filter = `blur(${String(COPY_BLUR)}px)`;
        context.drawImage(image, 0, 0, COPY, COPY);
        const colors = listOf(paletteOf(context.getImageData(0, 0, COPY, COPY).data, COLORS));
        uniforms.uLastColors.value = hasCover ? uniforms.uColors.value : colors;
        uniforms.uColors.value = colors;
        fadeFrom = performance.now();
        hasCover = true;
        draw(fadeFrom);
        play();
        onDrawn(true);
      })
      .catch(() => {
        // A cover that can't be read leaves the effect as it was.
      });
  };

  return {
    show,
    stop: () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", play);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    },
  };
}
