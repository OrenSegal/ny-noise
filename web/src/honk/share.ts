// A 1200x630 card of one honk (the field around the source, the count), shared as an image where the device can,
// otherwise the link is copied and the image downloaded.

export type Card = { field: HTMLCanvasElement; sx: number; sy: number; woke: number; lo: number; hi: number; sound: string; place: string; url: string };

const font = (w: number, px: number, fam = "Bricolage Grotesque") => `${w} ${px}px "${fam}", "Arial Narrow", sans-serif`;

export function renderCard(c: Card) {
  const W = 1200, H = 630, cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#07090F"; g.fillRect(0, 0, W, H);
  // The field: a 1.1 km square around the source, on the right.
  const side = Math.min(c.field.width, 280), x0 = Math.max(0, c.sx - side / 2), y0 = Math.max(0, c.sy - side / 2);
  g.save(); g.beginPath(); g.arc(880, 315, 290, 0, Math.PI * 2); g.clip();
  g.fillStyle = "#0D1120"; g.fillRect(560, 0, 640, H);
  g.imageSmoothingEnabled = false;
  g.drawImage(c.field, x0, y0, side, side, 590, 25, 580, 580);
  g.restore();
  g.fillStyle = "#FFB23E"; g.beginPath(); g.arc(590 + ((c.sx - x0) / side) * 580, 25 + ((c.sy - y0) / side) * 580, 9, 0, Math.PI * 2); g.fill();
  // The words, on the left.
  g.fillStyle = "#A9B0C6"; g.font = font(600, 28, "Schibsted Grotesk"); g.fillText("3 a.m., " + c.place, 64, 110);
  g.fillStyle = "#FFB23E"; g.font = font(800, 190); g.fillText(c.woke < 1 ? "<1" : Math.round(c.woke).toLocaleString("en-US"), 56, 300);
  g.fillStyle = "#EEF0F7"; g.font = font(700, 54); g.fillText("New Yorkers woken", 64, 370);
  g.fillStyle = "#A9B0C6"; g.font = font(400, 28, "Schibsted Grotesk");
  g.fillText(`by one ${c.sound.toLowerCase()}`, 64, 420);
  g.fillText(`range ${Math.round(c.lo).toLocaleString("en-US")} to ${Math.round(c.hi).toLocaleString("en-US")}`, 64, 460);
  g.fillStyle = "#7E86A1"; g.font = font(400, 22, "Schibsted Grotesk"); g.fillText("How many did you wake?  " + new URL(c.url).host, 64, 570);
  return cv;
}

/** Returns what happened, for the button's label. */
export async function shareCard(c: Card): Promise<"shared" | "copied" | "cancelled"> {
  const blob = await new Promise<Blob | null>((ok) => renderCard(c).toBlob(ok, "image/png"));
  const text = `I woke ${c.woke < 1 ? "less than one" : Math.round(c.woke)} New Yorkers with a ${c.sound.toLowerCase()} in ${c.place}.`; // place is "New York" for a block opened from the map
  const file = blob && new File([blob], "honk-nyc.png", { type: "image/png" });
  if (file && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text, url: c.url }); return "shared"; } catch { return "cancelled"; }
  }
  await navigator.clipboard?.writeText(`${text} ${c.url}`).catch(() => {});
  if (blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "honk-nyc.png"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  return "copied";
}
