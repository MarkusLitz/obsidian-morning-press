import { requestUrl } from "obsidian";
import { t } from "../i18n";
import { PaperLanguage } from "../types";
import { parseFeedContent, resolveRelativeUrl, stripHtmlToText } from "./parser";

export interface DiscoveredFeed {
	feedUrl: string;
	siteUrl: string;
	title: string;
}

const COMMON_FEED_PATHS = [
	"/feed",
	"/rss",
	"/rss.xml",
	"/feed.xml",
	"/atom.xml",
	"/index.xml",
	"/feeds/posts/default",
];

/**
 * Discovers an RSS/Atom/JSON feed from any user-typed URL or domain name (e.g. "zeit.de" or a direct feed URL).
 */
export async function discoverFeedUrl(
	rawInput: string,
	lang: PaperLanguage = "en"
): Promise<DiscoveredFeed> {
	let candidateUrl = rawInput.trim();
	if (!candidateUrl) {
		throw new Error("Empty address");
	}
	if (!/^https?:\/\//i.test(candidateUrl)) {
		candidateUrl = `https://${candidateUrl}`;
	}

	const response = await requestUrl({
		url: candidateUrl,
		method: "GET",
		headers: {
			Accept:
				"application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, text/html;q=0.9, */*;q=0.8",
		},
	});

	const text = response.text || "";

	// 1. Check if the URL itself is already a valid feed
	if (looksLikeFeedPayload(text)) {
		try {
			const parsed = parseFeedContent(text, candidateUrl);
			const hostFallback = new URL(candidateUrl).hostname.replace(/^www\./, "");
			return {
				feedUrl: candidateUrl,
				siteUrl: parsed.siteUrl || candidateUrl,
				title: parsed.title || hostFallback,
			};
		} catch {
			// Fall through to HTML link discovery
		}
	}

	// 2. Inspect HTML <link rel="alternate"> tags
	const pageTitleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	const pageTitle = pageTitleMatch ? stripHtmlToText(pageTitleMatch[1]) : "";
	const linkCandidates = extractFeedLinksFromHtml(text, candidateUrl);

	for (const link of linkCandidates) {
		try {
			const feedRes = await requestUrl({ url: link, method: "GET" });
			const parsed = parseFeedContent(feedRes.text, link);
			return {
				feedUrl: link,
				siteUrl: parsed.siteUrl || candidateUrl,
				title: parsed.title || pageTitle || new URL(candidateUrl).hostname.replace(/^www\./, ""),
			};
		} catch {
			// Try next candidate
		}
	}

	// 3. Probe well-known feed paths on the origin
	const origin = new URL(candidateUrl).origin;
	for (const suffix of COMMON_FEED_PATHS) {
		const probeUrl = `${origin}${suffix}`;
		try {
			const probeRes = await requestUrl({ url: probeUrl, method: "GET", throw: false });
			if (probeRes.status >= 200 && probeRes.status < 300 && looksLikeFeedPayload(probeRes.text)) {
				const parsed = parseFeedContent(probeRes.text, probeUrl);
				return {
					feedUrl: probeUrl,
					siteUrl: parsed.siteUrl || origin,
					title: parsed.title || pageTitle || new URL(origin).hostname.replace(/^www\./, ""),
				};
			}
		} catch {
			// Ignore failed probe
		}
	}

	throw new Error(t(lang, "noFeedFoundAt", { url: candidateUrl }));
}

export function extractFeedLinksFromHtml(html: string, baseUrl: string): string[] {
	const found: string[] = [];
	const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
	for (const tag of linkTags) {
		const relMatch = tag.match(/\brel\s*=\s*["']([^"']+)["']/i);
		const typeMatch = tag.match(/\btype\s*=\s*["']([^"']+)["']/i);
		const hrefMatch = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
		if (!hrefMatch?.[1]) continue;
		const rel = (relMatch?.[1] || "").toLowerCase();
		const type = (typeMatch?.[1] || "").toLowerCase();
		const isFeedType =
			type.includes("rss") ||
			type.includes("atom") ||
			type.includes("feed+json") ||
			type === "application/xml" ||
			type === "text/xml";
		if (rel.includes("alternate") && isFeedType) {
			const resolved = resolveRelativeUrl(hrefMatch[1], baseUrl);
			if (resolved && !found.includes(resolved)) {
				found.push(resolved);
			}
		}
	}
	return found;
}

function looksLikeFeedPayload(text: string): boolean {
	const head = text.trimStart().slice(0, 600);
	return (
		head.startsWith("{") ||
		/<(?:rss|feed|rdf:RDF)\b/i.test(head)
	);
}
