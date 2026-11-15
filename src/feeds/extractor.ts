import { requestUrl } from "obsidian";
import { resolveRelativeUrl, sanitizeArticleHtml, stripHtmlToText } from "./parser";

export interface ExtractedArticleContent {
	ok: true;
	contentHtml: string;
	plainText: string;
	leadImageUrl?: string;
	wordCount: number;
	readingMinutes: number;
}

export interface BlockedArticleResult {
	ok: false;
	status: number;
	reason: "blocked" | "http-error" | "empty";
}

export type ArticleExtractionOutcome = ExtractedArticleContent | BlockedArticleResult;

const fullTextCache = new Map<string, ExtractedArticleContent>();

/**
 * Fetches an article's web page directly on-device via Obsidian's requestUrl and extracts
 * clean readable prose for feeds that only publish short teasers.
 * Never spoofs identity or bypasses publisher access controls; reports 401/403/429 cleanly
 * so the UI can offer a visible webview or browser fallback.
 */
export async function extractFullArticle(url: string): Promise<ArticleExtractionOutcome> {
	const cached = fullTextCache.get(url);
	if (cached) return cached;

	const response = await requestUrl({
		url,
		method: "GET",
		throw: false,
		headers: {
			Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
			"Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
		},
	});

	if (response.status === 401 || response.status === 403 || response.status === 429 || response.status === 451) {
		return {
			ok: false,
			status: response.status,
			reason: "blocked",
		};
	}

	if (response.status < 200 || response.status >= 300) {
		return {
			ok: false,
			status: response.status,
			reason: "http-error",
		};
	}

	const rawHtml = response.text || "";
	const parser = new DOMParser();
	const doc = parser.parseFromString(rawHtml, "text/html");

	// Extract og:image if available
	const ogImg =
		doc.querySelector('meta[property="og:image"]')?.getAttribute("content") ??
		doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content") ??
		undefined;
	const leadImageUrl = resolveRelativeUrl(ogImg, url);

	// Check structured JSON-LD articleBody before removing <script> elements (used cleanly by many publishers)
	const jsonLdBody = extractJsonLdArticleBody(doc);

	// Remove clutter elements before scoring content containers
	const removeSelectors = [
		"script",
		"style",
		"noscript",
		"nav",
		"header",
		"footer",
		"aside",
		"form",
		"iframe",
		"svg",
		"[role='navigation']",
		"[role='banner']",
		"[role='contentinfo']",
		"[aria-hidden='true']",
		".comments",
		"#comments",
		".newsletter",
		".related",
		".share",
		".social",
		".cookie",
		".paywall",
		".ad",
		".ads",
		".advertisement",
		".metatextline",
		".copytext-element-wrapper__audio",
	];
	for (const sel of removeSelectors) {
		doc.querySelectorAll(sel).forEach((el) => el.remove());
	}

	// Unwrap <picture> elements so their inner <img> survives cleanly
	doc.querySelectorAll("picture").forEach((pic) => {
		const img = pic.querySelector("img");
		if (img) pic.replaceWith(img);
	});

	// Score candidate containers by paragraph text density
	const candidates: Element[] = [];
	doc
		.querySelectorAll(
			"article, [role='main'], main, .post-content, .article-body, .entry-content, .story, section, div"
		)
		.forEach((el) => candidates.push(el));

	let bestElement: Element | null =
		doc.querySelector("article") ?? doc.querySelector("main") ?? doc.body;
	let bestScore = -1;

	for (const el of candidates) {
		const paragraphs = Array.from(
			el.querySelectorAll(":scope > p, :scope > div > p, :scope > section > p")
		);
		if (paragraphs.length < 2) continue;

		let textLen = 0;
		for (const p of paragraphs) {
			const pText = p.textContent?.trim() ?? "";
			if (pText.length >= 35) textLen += pText.length;
		}
		if (textLen < 160) continue;

		const linkLen = Array.from(el.querySelectorAll("a")).reduce(
			(sum, a) => sum + (a.textContent?.trim().length ?? 0),
			0
		);
		const linkDensity = linkLen / Math.max(1, textLen);
		if (linkDensity > 0.45) continue;

		const tagBonus =
			el.tagName.toLowerCase() === "article"
				? 1.35
				: el.tagName.toLowerCase() === "main"
					? 1.15
					: 1.0;
		const score = textLen * (1 - linkDensity) * tagBonus;
		if (score > bestScore) {
			bestScore = score;
			bestElement = el;
		}
	}

	// Remove duplicate h1 inside extracted body (reader already prints the headline)
	bestElement?.querySelectorAll("h1").forEach((h1) => h1.remove());

	let contentHtml = sanitizeArticleHtml(bestElement?.innerHTML ?? "", url);
	let plainText = stripHtmlToText(contentHtml);
	let wordCount = plainText ? plainText.split(/\s+/).filter(Boolean).length : 0;

	// Fallback to structured JSON-LD articleBody if DOM yielded very little text
	if (wordCount < 45 && jsonLdBody) {
		const paragraphs = jsonLdBody
			.split(/\n{2,}/)
			.map((p) => p.trim())
			.filter(Boolean);
		contentHtml = paragraphs.map((p) => `<p>${p}</p>`).join("\n");
		plainText = stripHtmlToText(contentHtml);
		wordCount = plainText ? plainText.split(/\s+/).filter(Boolean).length : 0;
	}

	if (wordCount < 25) {
		return {
			ok: false,
			status: response.status,
			reason: "empty",
		};
	}

	const readingMinutes = Math.max(1, Math.round(wordCount / 220));

	const result: ExtractedArticleContent = {
		ok: true,
		contentHtml,
		plainText,
		leadImageUrl,
		wordCount,
		readingMinutes,
	};

	if (fullTextCache.size > 60) {
		const oldest = fullTextCache.keys().next().value;
		if (oldest) fullTextCache.delete(oldest);
	}
	fullTextCache.set(url, result);
	return result;
}

function extractJsonLdArticleBody(doc: Document): string | null {
	const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
	for (const s of scripts) {
		try {
			const parsed = JSON.parse(s.textContent || "") as unknown;
			const found = findArticleBodyInObject(parsed);
			if (found && found.length > 180) return found;
		} catch {
			// Ignore invalid JSON-LD blocks
		}
	}
	return null;
}

function findArticleBodyInObject(node: unknown): string | null {
	if (!node || typeof node !== "object") return null;
	if (Array.isArray(node)) {
		for (const item of node) {
			const hit = findArticleBodyInObject(item);
			if (hit) return hit;
		}
		return null;
	}
	const rec = node as Record<string, unknown>;
	if (typeof rec.articleBody === "string" && rec.articleBody.trim().length > 100) {
		return rec.articleBody.trim();
	}
	if (rec["@graph"]) {
		return findArticleBodyInObject(rec["@graph"]);
	}
	return null;
}
