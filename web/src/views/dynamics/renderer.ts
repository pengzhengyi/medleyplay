// cspell:ignore glsl highp fract
/**
 * @file Dynamics drawn: one of a few shaders over the cover, on a canvas behind Now Playing.
 *
 * The cover is read once into a blurred copy, 160 pixels square, fine enough that its
 * colors still blend smoothly as an effect enlarges and turns it; *Mesh* reads its
 * palette instead. A new cover fades in over the last. The canvas is drawn on every
 * frame the display shows, so the motion is smooth, at half the page's resolution, as
 * nothing in it is sharp, and not at all while the page is hidden. Still, for a device
 * asking for less motion, it is drawn only when the cover changes.
 *
 * This module is loaded only when Now Playing shows an effect, so the page without one
 * never loads the WebGL library.
 */

import { Mesh, Program, Renderer, Texture, Triangle } from "ogl";

import type { Dynamics } from "../../dynamics";
import { type Color, paletteOf } from "../../library/palette";

/** The size of the copy of the cover each effect samples, in pixels a side. */
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

/** What every effect shares: the two covers it fades between, time, and the page's shape. */
const COMMON = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 color;
uniform sampler2D uCover;
uniform sampler2D uLast;
uniform float uFade;
uniform float uTime;
uniform vec2 uAspect;
uniform vec3 uColors[${String(COLORS)}];
uniform vec3 uLastColors[${String(COLORS)}];

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + 1.), u.x), u.y);
}
mat2 turn(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }
vec3 cover(vec2 uv) { return mix(texture(uLast, uv).rgb, texture(uCover, uv).rgb, uFade); }
vec3 vivid(vec3 c, float by) { return mix(vec3(dot(c, vec3(.299, .587, .114))), c, by); }`;

/** The cover, blurred, drifting in slow folds as three turning copies of it blend. */
const FLOW = `${COMMON}
void main() {
  vec2 p = (vUv - .5) * uAspect;
  float t = uTime * .05;
  vec2 warp = vec2(noise(p * 1.4 + t), noise(p * 1.4 - t + 7.)) - .5;
  vec3 a = cover(turn(t * .8) * (p * .6 + warp * .5) + .5);
  vec3 b = cover(turn(-t * 1.1 + 2.) * (p * .8 - warp * .4) + .5);
  vec3 c = cover(turn(t * .6 + 4.) * (p * .5 + warp.yx * .6) + .5);
  color = vec4(vivid((a + b + c) / 3., 1.35) * .82, 1.);
}`;

/** Two copies of the cover, enlarged past recognizing, turning against each other. */
const DRIFT = `${COMMON}
void main() {
  vec2 p = (vUv - .5) * uAspect;
  float t = uTime * .035;
  vec3 a = cover(turn(t) * p * .55 + .5 + .08 * vec2(sin(t * 1.7), cos(t * 1.3)));
  vec3 b = cover(turn(-t * 1.3 + 1.) * p * .4 + .5);
  vec3 lit = 1. - (1. - a) * (1. - b * .7);
  color = vec4(vivid(lit, 1.3) * .78, 1.);
}`;

/** A mesh of the cover's colors, each a point of light wandering slowly. */
const MESH = `${COMMON}
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

const SHADERS: Record<Exclude<Dynamics, "off">, string> = { flow: FLOW, drift: DRIFT, mesh: MESH };

/**
 * Run `effect` on a canvas added to `host`, still when `still`; `onDrawn` is told when
 * a cover is first drawn, or when there is none to draw. Throws without WebGL 2.
 */
export function run(
  host: HTMLElement,
  effect: Exclude<Dynamics, "off">,
  { still, onDrawn }: { readonly still: boolean; readonly onDrawn: (drawn: boolean) => void },
): Running {
  const renderer = new Renderer({ dpr: RESOLUTION, alpha: false, antialias: false });
  const gl = renderer.gl;
  if (!renderer.isWebgl2) {
    throw new Error("Dynamics need WebGL 2.");
  }
  const canvas = gl.canvas;
  host.appendChild(canvas);
  const textureOf = () =>
    new Texture(gl, {
      generateMipmaps: false,
      minFilter: gl.LINEAR,
      wrapS: gl.MIRRORED_REPEAT,
      wrapT: gl.MIRRORED_REPEAT,
    });
  let current = textureOf();
  let last = textureOf();
  // ogl sets an array uniform from a plain array of its items, not a typed array.
  const listOf = (colors: readonly Color[]) => colors.map((color) => [...color]);
  const dark = listOf(Array.from({ length: COLORS }, (): Color => [0.06, 0.08, 0.07]));
  // The program reads these very objects, so setting a value here sets the uniform.
  const uniforms = {
    uCover: { value: current },
    uLast: { value: last },
    uFade: { value: 1 },
    uTime: { value: 0 },
    uAspect: { value: [1, 1] },
    uColors: { value: dark },
    uLastColors: { value: dark },
  };
  const program = new Program(gl, { vertex: VERTEX, fragment: SHADERS[effect], uniforms });
  const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

  let fadeFrom = 0;
  let frame = 0;
  let hasCover = false;
  let stopped = false;

  const draw = (now: number) => {
    uniforms.uTime.value = still ? 40 : now / 1000;
    uniforms.uFade.value = still ? 1 : Math.min(1, (now - fadeFrom) / FADE_MS);
    renderer.render({ scene: mesh });
  };
  const loop = (now: number) => {
    frame = requestAnimationFrame(loop);
    draw(now);
  };
  const play = () => {
    cancelAnimationFrame(frame);
    if (!still && hasCover && !document.hidden && !stopped) {
      frame = requestAnimationFrame(loop);
    }
  };
  const resize = () => {
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
        // The cover shown so far becomes the one faded from.
        [last, current] = [current, last];
        current.image = copy;
        uniforms.uCover.value = current;
        uniforms.uLast.value = hasCover ? last : current;
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
