export interface ParsedFeedItem {
	articleKey: string;
	guid: string;
	title: string;
	subtitle?: string;
	author?: string;
	url: string;
	publishedAt: number;
	contentHtml: string;
	plainText: string;
	excerpt: string;
	imageUrl?: string;
	imageCaption?: string;
	wordCount: number;
	readingMinutes: number;
}

export interface ParsedFeed {
	title: string;
	siteUrl?: string;
	description?: string;
	items: ParsedFeedItem[];
}

const TRACKING_PARAMS = new Set([
	"utm_source",
	"utm_medium",
	"utm_campaign",
	"utm_term",
	"utm_content",
	"utm_id",
	"fbclid",
	"gclid",
	"dclid",
	"msclkid",
	"mc_cid",
	"mc_eid",
	"oly_enc_id",
	"oly_anon_id",
	"_hsenc",
	"_hsmi",
	"vero_id",
	"ref",
	"ref_src",
	"feature",
]);

/**
 * Normalizes an article URL so the exact same story produces the exact same canonical string
 * across Desktop, Tablet, and Mobile devices.
 */
export function normalizeArticleUrl(rawUrl?: string): string {
	if (!rawUrl) return "";
	const trimmed = rawUrl.trim();
	if (!trimmed) return "";
	try {
		const parsed = new URL(trimmed);
		parsed.hash = "";
		if (parsed.protocol === "http:") {
			parsed.protocol = "https:";
		}
		parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
		const keysToDelete: string[] = [];
		parsed.searchParams.forEach((_val, key) => {
			const lower = key.toLowerCase();
			if (lower.startsWith("utm_") || TRACKING_PARAMS.has(lower)) {
				keysToDelete.push(key);
			}
		});
		for (const k of keysToDelete) {
			parsed.searchParams.delete(k);
		}
		parsed.searchParams.sort();
		if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
			parsed.pathname = parsed.pathname.replace(/\/+$/, "");
		}
		return parsed.toString();
	} catch {
		return trimmed.toLowerCase().replace(/#.*$/, "").replace(/\/+$/, "");
	}
}

/**
 * Deterministic 64-bit-like dual FNV-1a hash ("art_" + 16 hex chars) for cross-device sync.
 */
export function computeArticleKey(url?: string, guid?: string, title?: string): string {
	const canonicalUrl = normalizeArticleUrl(url);
	const canonicalGuid = guid && /^https?:\/\//i.test(guid.trim())
		? normalizeArticleUrl(guid)
		: (guid ?? "").trim();
	const seed = canonicalUrl || canonicalGuid || (title ?? "").trim().toLowerCase();

	let h1 = 0x811c9dc5;
	let h2 = 0x01000193;
	for (let i = 0; i < seed.length; i++) {
		const ch = seed.charCodeAt(i);
		h1 ^= ch;
		h1 = Math.imul(h1, 0x01000193);
		h2 ^= ch ^ ((i & 0xff) + 17);
		h2 = Math.imul(h2, 0x85ebca6b);
	}
	const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
	const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
	return `art_${hex1}${hex2}`;
}

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	ndash: "–",
	mdash: "—",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
	bdquo: "„",
	hellip: "…",
	copy: "©",
	reg: "®",
	euro: "€",
	pound: "£",
	yen: "¥",
	sect: "§",
	laquo: "«",
	raquo: "»",
	auml: "ä",
	ouml: "ö",
	uuml: "ü",
	Auml: "Ä",
	Ouml: "Ö",
	Uuml: "Ü",
	szlig: "ß",
};

export function decodeHtmlEntities(input: string): string {
	if (!input || !input.includes("&")) return input;
	return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, entity: string) => {
		if (entity.startsWith("#x") || entity.startsWith("#X")) {
			const code = parseInt(entity.slice(2), 16);
			return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : full;
		}
		if (entity.startsWith("#")) {
			const code = parseInt(entity.slice(1), 10);
			return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : full;
		}
		return NAMED_ENTITIES[entity] ?? full;
	});
}

export function stripHtmlToText(html: string): string {
	if (!html) return "";
	const withoutScripts = html
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/blockquote|\/tr)\b[^>]*>/gi, "\n");
	const stripped = withoutScripts.replace(/<[^>]+>/g, " ");
	return decodeHtmlEntities(stripped)
		.replace(/[ \t\f\v]+/g, " ")
		.replace(/\n\s*\n+/g, "\n\n")
		.trim();
}

export function resolveRelativeUrl(candidate?: string, baseUrl?: string): string | undefined {
	if (!candidate) return undefined;
	const clean = decodeHtmlEntities(candidate.trim());
	if (!clean || clean.startsWith("data:") || clean.startsWith("javascript:")) {
		return undefined;
	}
	if (/^https?:\/\//i.test(clean)) return clean;
	if (clean.startsWith("//")) return `https:${clean}`;
	if (!baseUrl) return undefined;
	try {
		return new URL(clean, baseUrl).toString();
	} catch {
		return undefined;
	}
}

export function sanitizeArticleHtml(rawHtml: string, baseUrl?: string): string {
	if (!rawHtml) return "";
	let html = rawHtml
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<(script|style|iframe|object|embed|form|input|button|noscript|svg)\b[\s\S]*?<\/\1>/gi, "")
		.replace(/<(script|style|iframe|object|embed|form|input|button|meta|link)\b[^>]*\/?>/gi, "");

	// Strip inline event handlers & styles that could clash with newspaper typography
	html = html
		.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
		.replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*')/gi, "")
		.replace(/\s+class\s*=\s*(?:"[^"]*"|'[^']*')/gi, "");

	// Resolve relative href/src attributes and neutralize javascript: URIs
	html = html.replace(/\b(href|src)\s*=\s*("([^"]*)"|'([^']*)')/gi, (_m, attr: string, _q, v1: string, v2: string) => {
		const rawVal = v1 ?? v2 ?? "";
		if (/^\s*javascript:/i.test(rawVal)) {
			return `${attr}="#"`;
		}
		const resolved = resolveRelativeUrl(rawVal, baseUrl) ?? rawVal;
		return `${attr}="${resolved.replace(/"/g, "&quot;")}"`;
	});

	// Filter obvious 1x1 tracking pixels
	html = html.replace(/<img\b[^>]*\b(?:width|height)\s*=\s*["']?1["']?[^>]*>/gi, "");

	return html.trim();
}

function extractFirstImageFromHtml(html: string, baseUrl?: string): { url?: string; caption?: string } {
	if (!html) return {};
	const figureMatch = html.match(/<figure\b[\s\S]*?<\/figure>/i);
	if (figureMatch) {
		const imgMatch = figureMatch[0].match(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i);
		const capMatch = figureMatch[0].match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
		if (imgMatch?.[1] && !isTrackingImageUrl(imgMatch[1])) {
			return {
				url: resolveRelativeUrl(imgMatch[1], baseUrl),
				caption: capMatch ? stripHtmlToText(capMatch[1]).slice(0, 180) : undefined,
			};
		}
	}
	const imgRegex = /<img\b([^>]*)>/gi;
	let match: RegExpExecArray | null;
	while ((match = imgRegex.exec(html)) !== null) {
		const attrs = match[1];
		if (/\b(?:width|height)\s*=\s*["']?[01]["']?(?:\s|$)/i.test(attrs)) continue;
		const srcMatch =
			attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i) ??
			attrs.match(/\bdata-src\s*=\s*["']([^"']+)["']/i);
		if (srcMatch?.[1] && !isTrackingImageUrl(srcMatch[1])) {
			const altMatch = attrs.match(/\balt\s*=\s*["']([^"']+)["']/i);
			const url = resolveRelativeUrl(srcMatch[1], baseUrl);
			if (url) {
				return {
					url,
					caption: altMatch ? decodeHtmlEntities(altMatch[1]).trim().slice(0, 180) : undefined,
				};
			}
		}
	}
	return {};
}

function isTrackingImageUrl(url: string): boolean {
	const lower = url.toLowerCase();
	return (
		lower.includes("feedburner.com/~ff/") ||
		lower.includes("feedburner.com/~r/") ||
		lower.includes("doubleclick.net") ||
		lower.includes("/pixel.") ||
		lower.includes("1x1") ||
		lower.endsWith(".gif") && lower.includes("track")
	);
}

function parseTimestamp(raw?: string | number): number {
	if (typeof raw === "number" && Number.isFinite(raw)) {
		return raw < 1e12 ? raw * 1000 : raw;
	}
	if (!raw || typeof raw !== "string") return Date.now();
	const trimmed = raw.trim();
	const parsed = Date.parse(trimmed);
	if (!Number.isNaN(parsed)) return parsed;
	return Date.now();
}

function buildExcerpt(plainText: string, maxChars = 280): string {
	if (!plainText) return "";
	const singleLine = plainText.replace(/\s+/g, " ").trim();
	if (singleLine.length <= maxChars) return singleLine;
	const sliced = singleLine.slice(0, maxChars);
	const lastSpace = sliced.lastIndexOf(" ");
	return `${(lastSpace > 120 ? sliced.slice(0, lastSpace) : sliced).replace(/[.,;:!?-]+$/, "")}…`;
}

function finalizeItem(params: {
	guid?: string;
	title?: string;
	subtitle?: string;
	author?: string;
	url?: string;
	publishedAt: number;
	contentHtml?: string;
	summaryHtml?: string;
	explicitImageUrl?: string;
	explicitImageCaption?: string;
	baseUrl?: string;
}): ParsedFeedItem | null {
	const cleanUrl = resolveRelativeUrl(params.url, params.baseUrl) ?? (params.url ?? "").trim();
	const rawContent = (params.contentHtml && params.contentHtml.trim().length >= (params.summaryHtml?.trim().length ?? 0))
		? params.contentHtml
		: (params.summaryHtml || params.contentHtml || "");
	const baseForLinks = cleanUrl || params.baseUrl;
	const htmlImg = extractFirstImageFromHtml(rawContent, baseForLinks);
	let sanitizedHtml = sanitizeArticleHtml(rawContent, baseForLinks);

	// Clean common German/international RSS feed boilerplate artifacts (e.g. ZEIT literal "None" & tiny 148x84 thumbs, Tagesschau "[mehr]")
	sanitizedHtml = sanitizedHtml
		.replace(/<a\b[^>]*>\s*<img\b[^>]*wide__148x84[^>]*>\s*<\/a>/gi, "")
		.replace(/\[\s*<a\b[^>]*>\s*mehr\s*<\/a>\s*\]/gi, "")
		.replace(/(?:^|>|\s)None(?:\s|<|$)/g, (m) => m.replace("None", ""))
		.trim();

	let plainText = stripHtmlToText(sanitizedHtml || params.summaryHtml || "")
		.replace(/^\s*None\s*$/i, "")
		.replace(/\[\s*mehr\s*\]\s*$/i, "")
		.trim();

	const rawTitle = stripHtmlToText(params.title || "").replace(/\s+/g, " ").trim();
	const title = rawTitle || buildExcerpt(plainText, 80);
	if (!title && !plainText) return null;

	const words = plainText ? plainText.split(/\s+/).filter(Boolean).length : 0;
	const readingMinutes = Math.max(1, Math.round(words / 220));
	const imageUrl =
		resolveRelativeUrl(params.explicitImageUrl, baseForLinks) ??
		htmlImg.url;
	const imageCaption = params.explicitImageCaption || htmlImg.caption;
	const articleKey = computeArticleKey(cleanUrl, params.guid, title);
	const cleanAuthor = params.author
		? stripHtmlToText(params.author)
				.replace(/^by\s+/i, "")
				.replace(/\s*-\s*$/, "")
				.trim()
				.slice(0, 100)
		: undefined;

	return {
		articleKey,
		guid: params.guid || cleanUrl || articleKey,
		title,
		subtitle: params.subtitle ? stripHtmlToText(params.subtitle).slice(0, 220) : undefined,
		author: cleanAuthor || undefined,
		url: cleanUrl,
		publishedAt: params.publishedAt,
		contentHtml: sanitizedHtml || (plainText ? `<p>${plainText}</p>` : ""),
		plainText,
		excerpt: buildExcerpt(plainText, 300),
		imageUrl: imageUrl && !isTrackingImageUrl(imageUrl) ? imageUrl : undefined,
		imageCaption,
		wordCount: words,
		readingMinutes,
	};
}

/**
 * Parses RSS 2.0, RSS 1.0 (RDF), Atom 1.0, and JSON Feed 1.0/1.1 into a unified ParsedFeed.
 */
export function parseFeedContent(rawContent: string, feedUrl: string): ParsedFeed {
	const trimmed = rawContent.replace(/^\uFEFF/, "").trim();
	if (!trimmed) {
		throw new Error("Empty feed response");
	}

	// 1. JSON Feed check
	if (trimmed.startsWith("{")) {
		const json = JSON.parse(trimmed) as Record<string, unknown>;
		if (
			(typeof json.version === "string" && json.version.includes("jsonfeed.org")) ||
			Array.isArray(json.items)
		) {
			return parseJsonFeed(json, feedUrl);
		}
	}

	// 2. Browser/Obsidian DOMParser path if available
	if (typeof DOMParser !== "undefined") {
		const domResult = tryParseXmlWithDom(trimmed, feedUrl);
		if (domResult && (domResult.items.length > 0 || domResult.title)) {
			return domResult;
		}
	}

	// 3. Resilient pure-JS XML parser (handles Node test runner AND slightly malformed XML feeds)
	return parseXmlFallback(trimmed, feedUrl);
}

function parseJsonFeed(json: Record<string, unknown>, feedUrl: string): ParsedFeed {
	const title = typeof json.title === "string" ? stripHtmlToText(json.title) : "";
	const siteUrl = typeof json.home_page_url === "string" ? json.home_page_url : feedUrl;
	const description = typeof json.description === "string" ? stripHtmlToText(json.description) : undefined;
	const rawItems = Array.isArray(json.items) ? json.items : [];

	const items: ParsedFeedItem[] = [];
	for (const entry of rawItems) {
		if (!entry || typeof entry !== "object") continue;
		const rec = entry as Record<string, unknown>;
		let authorName: string | undefined;
		if (rec.author && typeof rec.author === "object") {
			const a = rec.author as Record<string, unknown>;
			if (typeof a.name === "string") authorName = a.name;
		} else if (Array.isArray(rec.authors) && rec.authors.length > 0) {
			const a = rec.authors[0] as Record<string, unknown>;
			if (typeof a?.name === "string") authorName = a.name;
		}
		const contentHtml =
			typeof rec.content_html === "string"
				? rec.content_html
				: typeof rec.content_text === "string"
					? `<p>${rec.content_text.replace(/\n\n+/g, "</p><p>")}</p>`
					: "";
		const summaryHtml = typeof rec.summary === "string" ? rec.summary : "";
		let imageUrl = typeof rec.image === "string" ? rec.image : typeof rec.banner_image === "string" ? rec.banner_image : undefined;
		if (!imageUrl && Array.isArray(rec.attachments)) {
			const imgAtt = rec.attachments.find(
				(att: unknown) =>
					att &&
					typeof att === "object" &&
					typeof (att as Record<string, unknown>).mime_type === "string" &&
					((att as Record<string, unknown>).mime_type as string).startsWith("image/")
			) as Record<string, unknown> | undefined;
			if (typeof imgAtt?.url === "string") imageUrl = imgAtt.url;
		}

		const parsed = finalizeItem({
			guid: typeof rec.id === "string" ? rec.id : undefined,
			title: typeof rec.title === "string" ? rec.title : undefined,
			url: typeof rec.url === "string" ? rec.url : typeof rec.external_url === "string" ? rec.external_url : undefined,
			author: authorName,
			publishedAt: parseTimestamp(
				(rec.date_published as string | undefined) ?? (rec.date_modified as string | undefined)
			),
			contentHtml,
			summaryHtml,
			explicitImageUrl: imageUrl,
			baseUrl: siteUrl || feedUrl,
		});
		if (parsed) items.push(parsed);
	}

	return { title, siteUrl, description, items };
}

function getDirectChildText(parent: Element, localNames: string[]): string {
	for (let i = 0; i < parent.children.length; i++) {
		const child = parent.children[i];
		const ln = (child.localName || child.tagName).toLowerCase();
		const full = child.tagName.toLowerCase();
		if (localNames.includes(ln) || localNames.includes(full)) {
			return child.textContent?.trim() ?? "";
		}
	}
	return "";
}

function tryParseXmlWithDom(xml: string, feedUrl: string): ParsedFeed | null {
	try {
		const parser = new DOMParser();
		const doc = parser.parseFromString(xml, "text/xml");
		if (doc.querySelector("parsererror")) {
			return null;
		}
		const root = doc.documentElement;
		if (!root) return null;
		const rootName = (root.localName || root.tagName).toLowerCase();

		if (rootName === "feed") {
			// Atom 1.0
			const title = getDirectChildText(root, ["title"]);
			const subtitle = getDirectChildText(root, ["subtitle"]);
			let siteUrl = feedUrl;
			for (let i = 0; i < root.children.length; i++) {
				const ch = root.children[i];
				if ((ch.localName || ch.tagName).toLowerCase() === "link") {
					const rel = ch.getAttribute("rel") || "alternate";
					const href = ch.getAttribute("href");
					if (href && rel === "alternate") {
						siteUrl = resolveRelativeUrl(href, feedUrl) ?? href;
						break;
					}
				}
			}

			const entries = Array.from(root.getElementsByTagName("*")).filter(
				(el) => (el.localName || el.tagName).toLowerCase() === "entry"
			);
			const items: ParsedFeedItem[] = [];
			for (const entry of entries) {
				const entryTitle = getDirectChildText(entry, ["title"]);
				const guid = getDirectChildText(entry, ["id"]);
				const publishedRaw =
					getDirectChildText(entry, ["published", "updated", "dc:date", "date"]);
				let linkUrl = "";
				let enclosureImg: string | undefined;
				for (let i = 0; i < entry.children.length; i++) {
					const ch = entry.children[i];
					const name = (ch.localName || ch.tagName).toLowerCase();
					if (name === "link") {
						const rel = (ch.getAttribute("rel") || "alternate").toLowerCase();
						const type = (ch.getAttribute("type") || "").toLowerCase();
						const href = ch.getAttribute("href") || "";
						if (rel === "alternate" && href) {
							linkUrl = href;
						} else if (!linkUrl && rel !== "enclosure" && rel !== "self" && href) {
							linkUrl = href;
						} else if (rel === "enclosure" && type.startsWith("image/") && href) {
							enclosureImg = href;
						}
					}
				}
				let author = "";
				const authorEl = Array.from(entry.children).find(
					(c) => (c.localName || c.tagName).toLowerCase() === "author"
				);
				if (authorEl) {
					author = getDirectChildText(authorEl, ["name"]) || authorEl.textContent?.trim() || "";
				} else {
					author = getDirectChildText(entry, ["dc:creator", "creator"]);
				}

				const contentHtml = getDirectChildText(entry, ["content", "content:encoded", "encoded"]);
				const summaryHtml = getDirectChildText(entry, ["summary"]);
				const mediaImg = extractMediaUrlFromElement(entry);

				const item = finalizeItem({
					guid,
					title: entryTitle,
					author,
					url: linkUrl || guid,
					publishedAt: parseTimestamp(publishedRaw),
					contentHtml,
					summaryHtml,
					explicitImageUrl: mediaImg || enclosureImg,
					baseUrl: siteUrl || feedUrl,
				});
				if (item) items.push(item);
			}
			return { title: stripHtmlToText(title), siteUrl, description: subtitle, items };
		}

		// RSS 2.0 or RDF 1.0
		const channel =
			Array.from(root.children).find((c) => (c.localName || c.tagName).toLowerCase() === "channel") ??
			root;
		const title = getDirectChildText(channel, ["title"]);
		const siteUrl = resolveRelativeUrl(getDirectChildText(channel, ["link"]), feedUrl) ?? feedUrl;
		const description = getDirectChildText(channel, ["description", "subtitle"]);

		const itemEls = Array.from(root.getElementsByTagName("*")).filter(
			(el) => (el.localName || el.tagName).toLowerCase() === "item"
		);
		const items: ParsedFeedItem[] = [];
		for (const itemEl of itemEls) {
			const itemTitle = getDirectChildText(itemEl, ["title"]);
			const guid = getDirectChildText(itemEl, ["guid", "id"]);
			const link = getDirectChildText(itemEl, ["link"]) || (guid.startsWith("http") ? guid : "");
			const pubDate = getDirectChildText(itemEl, ["pubdate", "dc:date", "date", "published", "updated"]);
			const author = getDirectChildText(itemEl, ["dc:creator", "creator", "author"]);
			const contentHtml = getDirectChildText(itemEl, ["content:encoded", "encoded", "content"]);
			const summaryHtml = getDirectChildText(itemEl, ["description", "summary"]);
			const subtitle = getDirectChildText(itemEl, ["itunes:subtitle", "subtitle"]);
			const explicitImageUrl = extractMediaUrlFromElement(itemEl);

			const item = finalizeItem({
				guid,
				title: itemTitle,
				subtitle,
				author,
				url: link,
				publishedAt: parseTimestamp(pubDate),
				contentHtml,
				summaryHtml,
				explicitImageUrl,
				baseUrl: siteUrl || feedUrl,
			});
			if (item) items.push(item);
		}
		return { title: stripHtmlToText(title), siteUrl, description, items };
	} catch {
		return null;
	}
}

function extractMediaUrlFromElement(el: Element): string | undefined {
	const descendants = Array.from(el.getElementsByTagName("*"));
	for (const node of descendants) {
		const tag = node.tagName.toLowerCase();
		const local = (node.localName || tag).toLowerCase();
		if (local === "content" || tag === "media:content") {
			const url = node.getAttribute("url");
			const medium = (node.getAttribute("medium") || "").toLowerCase();
			const type = (node.getAttribute("type") || "").toLowerCase();
			if (url && (medium === "image" || type.startsWith("image/") || /\.(jpe?g|png|webp|avif)(\?|$)/i.test(url))) {
				return url;
			}
		}
		if (local === "thumbnail" || tag === "media:thumbnail") {
			const url = node.getAttribute("url");
			if (url) return url;
		}
		if (local === "enclosure") {
			const url = node.getAttribute("url");
			const type = (node.getAttribute("type") || "").toLowerCase();
			if (url && (type.startsWith("image/") || /\.(jpe?g|png|webp|avif)(\?|$)/i.test(url))) {
				return url;
			}
		}
	}
	return undefined;
}

function unwrapCdata(val: string): string {
	return val
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
		.trim();
}

function extractTagValue(block: string, tags: string[]): string {
	for (const tag of tags) {
		const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i");
		const m = block.match(re);
		if (m?.[1]) {
			const val = unwrapCdata(m[1]);
			return val.includes("<![CDATA[") ? val : decodeHtmlEntities(val);
		}
	}
	return "";
}

function extractAtomLink(block: string, baseUrl: string): string {
	const linkTags = block.match(/<link\b[^>]*>/gi) ?? [];
	let fallback = "";
	for (const tag of linkTags) {
		const hrefMatch = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
		if (!hrefMatch?.[1]) continue;
		const relMatch = tag.match(/\brel\s*=\s*["']([^"']+)["']/i);
		const rel = (relMatch?.[1] || "alternate").toLowerCase();
		if (rel === "alternate") {
			return resolveRelativeUrl(hrefMatch[1], baseUrl) ?? hrefMatch[1];
		}
		if (!fallback && rel !== "self" && rel !== "enclosure") {
			fallback = resolveRelativeUrl(hrefMatch[1], baseUrl) ?? hrefMatch[1];
		}
	}
	return fallback;
}

function extractFallbackMediaUrl(block: string): string | undefined {
	const mediaMatch =
		block.match(/<media:(?:content|thumbnail)\b[^>]*?\burl\s*=\s*["']([^"']+)["'][^>]*>/i) ??
		block.match(/<enclosure\b[^>]*?\burl\s*=\s*["']([^"']+)["'][^>]*?\btype\s*=\s*["']image\/[^"']+["'][^>]*>/i) ??
		block.match(/<enclosure\b[^>]*?\btype\s*=\s*["']image\/[^"']+["'][^>]*?\burl\s*=\s*["']([^"']+)["'][^>]*>/i);
	return mediaMatch?.[1];
}

function parseXmlFallback(xml: string, feedUrl: string): ParsedFeed {
	const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
	if (isAtom) {
		const headerBlock = xml.split(/<entry[\s>]/i)[0] ?? xml;
		const title = stripHtmlToText(extractTagValue(headerBlock, ["title"]));
		const siteUrl = extractAtomLink(headerBlock, feedUrl) || feedUrl;
		const description = stripHtmlToText(extractTagValue(headerBlock, ["subtitle"]));
		const entryBlocks = xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) ?? [];
		const items: ParsedFeedItem[] = [];
		for (const block of entryBlocks) {
			const entryTitle = extractTagValue(block, ["title"]);
			const guid = extractTagValue(block, ["id"]);
			const url = extractAtomLink(block, siteUrl) || guid;
			const authorBlock = extractTagValue(block, ["author"]);
			const author = extractTagValue(authorBlock, ["name"]) || stripHtmlToText(authorBlock) || extractTagValue(block, ["dc:creator"]);
			const publishedRaw = extractTagValue(block, ["published", "updated", "dc:date"]);
			const contentHtml = extractTagValue(block, ["content", "content:encoded"]);
			const summaryHtml = extractTagValue(block, ["summary"]);
			const explicitImageUrl = extractFallbackMediaUrl(block);

			const item = finalizeItem({
				guid,
				title: entryTitle,
				author,
				url,
				publishedAt: parseTimestamp(publishedRaw),
				contentHtml,
				summaryHtml,
				explicitImageUrl,
				baseUrl: siteUrl,
			});
			if (item) items.push(item);
		}
		return { title, siteUrl, description, items };
	}

	const headerBlock = xml.split(/<item[\s>]/i)[0] ?? xml;
	const title = stripHtmlToText(extractTagValue(headerBlock, ["title"]));
	const siteUrl = resolveRelativeUrl(extractTagValue(headerBlock, ["link"]), feedUrl) ?? feedUrl;
	const description = stripHtmlToText(extractTagValue(headerBlock, ["description", "subtitle"]));
	const itemBlocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? [];
	const items: ParsedFeedItem[] = [];

	for (const block of itemBlocks) {
		const itemTitle = extractTagValue(block, ["title"]);
		const guid = extractTagValue(block, ["guid", "id"]);
		const url = extractTagValue(block, ["link"]) || (guid.startsWith("http") ? guid : "");
		const author = extractTagValue(block, ["dc:creator", "creator", "author"]);
		const pubDate = extractTagValue(block, ["pubDate", "dc:date", "date", "published"]);
		const contentHtml = extractTagValue(block, ["content:encoded", "content"]);
		const summaryHtml = extractTagValue(block, ["description", "summary"]);
		const explicitImageUrl = extractFallbackMediaUrl(block);

		const item = finalizeItem({
			guid,
			title: itemTitle,
			author,
			url,
			publishedAt: parseTimestamp(pubDate),
			contentHtml,
			summaryHtml,
			explicitImageUrl,
			baseUrl: siteUrl,
		});
		if (item) items.push(item);
	}

	if (!title && items.length === 0 && !/<(?:rss|rdf:RDF|channel|feed)\b/i.test(xml)) {
		throw new Error("Unrecognized feed format");
	}
	return { title, siteUrl, description, items };
}
