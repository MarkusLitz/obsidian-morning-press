import { requestUrl } from "obsidian";
import { ImageRenderStyle, MagazineStyle, NewspaperEdition, PaperFormatMode } from "../types";

export interface HalftoneThemeColors {
	paperBg: string;
	inkColor: string;
	invert?: boolean;
}

export function getEditionPalette(
	format: PaperFormatMode,
	edition: NewspaperEdition,
	magStyle: MagazineStyle
): HalftoneThemeColors {
	if (format === "magazine") {
		switch (magStyle) {
			case "bicycle":
				return { paperBg: "#f6f0e4", inkColor: "#1d1a16" };
			case "signal":
				return { paperBg: "#dfe2e5", inkColor: "#141619" };
			case "plate-dark":
				return { paperBg: "#141414", inkColor: "#ece8df", invert: true };
			case "plate-light":
			default:
				return { paperBg: "#fafafa", inkColor: "#141414" };
		}
	}
	switch (edition) {
		case "digital":
			return { paperBg: "#f8f9fa", inkColor: "#121417" };
		case "dystopian":
			return { paperBg: "#c9c5bc", inkColor: "#1b1a18" };
		case "biblio":
		default:
			return { paperBg: "#f3ede2", inkColor: "#1c1915" };
	}
}

const processedImageCache = new Map<string, string>();
const rawBlobCache = new Map<string, Blob>();
const inflightRequests = new Map<string, Promise<string | null>>();

const MAX_CACHE_ENTRIES = 90;

function putProcessedCache(key: string, dataUrl: string): void {
	if (processedImageCache.size >= MAX_CACHE_ENTRIES) {
		const oldest = processedImageCache.keys().next().value;
		if (oldest) processedImageCache.delete(oldest);
	}
	processedImageCache.set(key, dataUrl);
}

async function fetchImageBlob(url: string): Promise<Blob | null> {
	const existing = rawBlobCache.get(url);
	if (existing) return existing;

	try {
		const res = await requestUrl({
			url,
			method: "GET",
			throw: false,
		});
		if (res.status < 200 || res.status >= 300 || !res.arrayBuffer || res.arrayBuffer.byteLength < 128) {
			return null;
		}
		const contentType =
			res.headers?.["content-type"] ||
			res.headers?.["Content-Type"] ||
			"image/jpeg";
		if (contentType.includes("svg")) {
			return null;
		}
		const blob = new Blob([res.arrayBuffer], { type: contentType });
		if (rawBlobCache.size >= 50) {
			const oldest = rawBlobCache.keys().next().value;
			if (oldest) rawBlobCache.delete(oldest);
		}
		rawBlobCache.set(url, blob);
		return blob;
	} catch {
		return null;
	}
}

async function decodeBlobToSource(blob: Blob): Promise<{
	source: CanvasImageSource;
	width: number;
	height: number;
	cleanup: () => void;
} | null> {
	if (typeof createImageBitmap === "function") {
		try {
			const bmp = await createImageBitmap(blob);
			return {
				source: bmp,
				width: bmp.width,
				height: bmp.height,
				cleanup: () => bmp.close(),
			};
		} catch {
			// Fallback to HTMLImageElement below
		}
	}

	return new Promise((resolve) => {
		const objUrl = URL.createObjectURL(blob);
		const img = new Image();
		img.onload = () => {
			resolve({
				source: img,
				width: img.naturalWidth || img.width,
				height: img.naturalHeight || img.height,
				cleanup: () => URL.revokeObjectURL(objUrl),
			});
		};
		img.onerror = () => {
			URL.revokeObjectURL(objUrl);
			resolve(null);
		};
		img.src = objUrl;
	});
}

/**
 * Renders an article photograph into an authentic 45°-screened halftone dot canvas
 * (or muted newsprint color ink / full color) without CORS tainting.
 */
export async function renderPressImage(params: {
	url: string;
	style: ImageRenderStyle;
	palette: HalftoneThemeColors;
	dotSpacing?: number;
	maxWidth?: number;
}): Promise<string | null> {
	const { url, style, palette, dotSpacing = 3.5, maxWidth = 760 } = params;
	if (!url || style === "none") return null;

	const cacheKey = `${url}|${style}|${palette.paperBg}|${palette.inkColor}|${dotSpacing}|${maxWidth}`;
	const hit = processedImageCache.get(cacheKey);
	if (hit) return hit;

	const inflight = inflightRequests.get(cacheKey);
	if (inflight) return inflight;

	const job = (async (): Promise<string | null> => {
		const blob = await fetchImageBlob(url);
		if (!blob) return null;

		if (style === "color") {
			const dataUrl = await blobToDataUrl(blob);
			if (dataUrl) putProcessedCache(cacheKey, dataUrl);
			return dataUrl;
		}

		const decoded = await decodeBlobToSource(blob);
		if (!decoded || decoded.width < 24 || decoded.height < 24) {
			decoded?.cleanup();
			return null;
		}

		try {
			const scale = Math.min(1, maxWidth / decoded.width);
			const w = Math.max(32, Math.round(decoded.width * scale));
			const h = Math.max(32, Math.round(decoded.height * scale));

			const sampleCanvas = document.createElement("canvas");
			sampleCanvas.width = w;
			sampleCanvas.height = h;
			const sCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
			if (!sCtx) return null;
			sCtx.drawImage(decoded.source, 0, 0, w, h);
			const pixels = sCtx.getImageData(0, 0, w, h).data;

			const outCanvas = document.createElement("canvas");
			outCanvas.width = w;
			outCanvas.height = h;
			const ctx = outCanvas.getContext("2d");
			if (!ctx) return null;

			ctx.fillStyle = palette.paperBg;
			ctx.fillRect(0, 0, w, h);

			if (style === "color-ink") {
				renderColorNewsprint(ctx, sCtx, sampleCanvas, w, h, palette.paperBg, dotSpacing);
			} else {
				renderMonochromeHalftone(ctx, pixels, w, h, palette, dotSpacing);
			}

			const outUrl = outCanvas.toDataURL("image/webp", 0.88);
			putProcessedCache(cacheKey, outUrl);
			return outUrl;
		} finally {
			decoded.cleanup();
		}
	})();

	inflightRequests.set(cacheKey, job);
	try {
		return await job;
	} finally {
		inflightRequests.delete(cacheKey);
	}
}

function renderMonochromeHalftone(
	ctx: CanvasRenderingContext2D,
	pixels: Uint8ClampedArray,
	w: number,
	h: number,
	palette: HalftoneThemeColors,
	spacing: number
): void {
	const step = Math.max(2.4, Math.min(6.5, spacing));
	const angle = Math.PI / 4; // Classic 45° monochrome newspaper screen angle
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const diag = Math.hypot(w, h);
	const halfW = w / 2;
	const halfH = h / 2;

	ctx.fillStyle = palette.inkColor;

	const maxRadius = step * 0.68;

	for (let gy = -diag / 2; gy <= diag / 2; gy += step) {
		ctx.beginPath();
		for (let gx = -diag / 2; gx <= diag / 2; gx += step) {
			const x = halfW + gx * cos - gy * sin;
			const y = halfH + gx * sin + gy * cos;
			if (x < 0 || x >= w || y < 0 || y >= h) continue;

			const ix = x | 0;
			const iy = y | 0;
			const idx = (iy * w + ix) * 4;
			const alpha = pixels[idx + 3] / 255;
			if (alpha < 0.08) continue;

			// Perceived luminance (ITU-R BT.709)
			const r = pixels[idx];
			const g = pixels[idx + 1];
			const b = pixels[idx + 2];
			let lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

			// Gentle S-curve contrast for crisp newsprint tonal range
			lum = Math.max(0, Math.min(1, (lum - 0.5) * 1.16 + 0.5));

			const intensity = palette.invert ? lum : 1 - lum;
			if (intensity <= 0.045) continue;

			const radius = Math.sqrt(intensity) * maxRadius * alpha;
			if (radius > 0.22) {
				ctx.moveTo(x + radius, y);
				ctx.arc(x, y, radius, 0, Math.PI * 2);
			}
		}
		ctx.fill();
	}
}

function renderColorNewsprint(
	ctx: CanvasRenderingContext2D,
	_sampleCtx: CanvasRenderingContext2D,
	sampleCanvas: HTMLCanvasElement,
	w: number,
	h: number,
	paperBg: string,
	spacing: number
): void {
	ctx.save();
	ctx.fillStyle = paperBg;
	ctx.fillRect(0, 0, w, h);

	// Muted warm newspaper color stock blend + subtle halftone dot overlay
	ctx.filter = "saturate(0.72) contrast(1.06) sepia(0.14)";
	ctx.globalAlpha = 0.9;
	ctx.drawImage(sampleCanvas, 0, 0, w, h);
	ctx.restore();

	// Overlay subtle fine dot texture for tactile ink-on-paper look
	const pixels = _sampleCtx.getImageData(0, 0, w, h).data;
	const step = Math.max(3.2, spacing * 1.05);
	ctx.save();
	ctx.globalAlpha = 0.22;
	ctx.fillStyle = "#181613";
	for (let y = 1; y < h; y += step) {
		ctx.beginPath();
		for (let x = 1; x < w; x += step) {
			const idx = ((y | 0) * w + (x | 0)) * 4;
			const lum = (0.2126 * pixels[idx] + 0.7152 * pixels[idx + 1] + 0.0722 * pixels[idx + 2]) / 255;
			const dark = Math.max(0, 1 - lum);
			if (dark > 0.15) {
				const rad = Math.sqrt(dark) * step * 0.42;
				ctx.moveTo(x + rad, y);
				ctx.arc(x, y, rad, 0, Math.PI * 2);
			}
		}
		ctx.fill();
	}
	ctx.restore();
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
	return new Promise((resolve) => {
		const reader = new FileReader();
		reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
		reader.onerror = () => resolve(null);
		reader.readAsDataURL(blob);
	});
}

/**
 * Helper to mount an async halftone-rendered <img> into a container with graceful fallback.
 */
export function mountPressImageElement(
	container: HTMLElement,
	params: {
		url: string;
		alt?: string;
		caption?: string;
		style: ImageRenderStyle;
		palette: HalftoneThemeColors;
		dotSpacing?: number;
		maxWidth?: number;
		cssClass?: string;
	}
): HTMLElement | null {
	if (!params.url || params.style === "none") return null;

	const figure = container.createEl("figure", {
		cls: `op-figure ${params.cssClass ?? ""}`.trim(),
	});
	const frame = figure.createDiv({ cls: "op-image-frame is-loading" });
	const img = frame.createEl("img", {
		cls: "op-image",
		attr: {
			alt: params.alt || "",
			loading: "lazy",
		},
	});

	void renderPressImage({
		url: params.url,
		style: params.style,
		palette: params.palette,
		dotSpacing: params.dotSpacing,
		maxWidth: params.maxWidth,
	}).then((renderedUrl) => {
		frame.removeClass("is-loading");
		if (renderedUrl) {
			img.src = renderedUrl;
		} else {
			// Fallback to direct URL with CSS newspaper filter if binary fetch failed
			img.src = params.url;
			img.addClass("op-image-css-fallback");
			img.onerror = () => {
				figure.remove();
			};
		}
	});

	if (params.caption && params.caption.trim() && params.caption.trim() !== params.alt?.trim()) {
		figure.createEl("figcaption", {
			cls: "op-figcaption",
			text: params.caption.trim(),
		});
	}

	return figure;
}
