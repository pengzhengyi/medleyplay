import { paletteOf } from "../../library/palette";

type CoverEffect = "flow" | "drift";
type Backdrop = { readonly colors: readonly [string, string] } | { readonly image: string };

export async function coverBackdrop(cover: string, effect: CoverEffect): Promise<Backdrop> {
  const image = new Image();
  image.src = cover;
  await image.decode();

  const canvas = document.createElement("canvas");
  const scale = 96 / Math.max(image.naturalWidth, image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: effect === "flow" });
  if (context === null) throw new Error("Cover backdrop needs a 2D canvas.");

  context.fillStyle = "#101614";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  if (effect === "flow") {
    const palette = paletteOf(context.getImageData(0, 0, width, height).data, 2);
    const colorAt = (index: number) =>
      `rgb(${(palette[index] ?? [0, 0, 0]).map((channel) => Math.round(channel * 128)).join(" ")})`;
    return { colors: [colorAt(0), colorAt(1)] };
  }

  context.fillStyle = "rgb(0 0 0 / 50%)";
  context.fillRect(0, 0, width, height);
  return { image: canvas.toDataURL() };
}
