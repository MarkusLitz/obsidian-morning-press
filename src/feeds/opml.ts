import { decodeHtmlEntities } from "./parser";
import { CORRESPONDENCE_SECTION_ID, PaperConfig } from "../types";

export interface OpmlFeedEntry {
	title: string;
	xmlUrl: string;
	htmlUrl?: string;
}

export interface OpmlGroup {
	title: string;
	isDefaultCorrespondence?: boolean;
	feeds: OpmlFeedEntry[];
}

export interface ParsedOpmlDocument {
	title: string;
	groups: OpmlGroup[];
}

function parseAttributes(tagOpen: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	const attrRegex = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
	let match: RegExpExecArray | null;
	while ((match = attrRegex.exec(tagOpen)) !== null) {
		const key = match[1].toLowerCase();
		const val = decodeHtmlEntities(match[2] ?? match[3] ?? "");
		attrs[key] = val;
	}
	return attrs;
}

/**
 * Parses OPML 1.0 & 2.0 files, preserving top-level folder `<outline>` elements as Newspaper Desks
 * and placing ungrouped feeds into Correspondence.
 */
export function parseOpml(opmlXml: string): ParsedOpmlDocument {
	const trimmed = opmlXml.replace(/^\uFEFF/, "").trim();
	const titleMatch = trimmed.match(/<head[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>[\s\S]*?<\/head>/i);
	const docTitle = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : "Imported Subscriptions";

	const groupMap = new Map<string, OpmlGroup>();
	const ensureGroup = (name: string, isDefault = false): OpmlGroup => {
		const key = isDefault ? "__correspondence__" : name.toLowerCase();
		let existing = groupMap.get(key);
		if (!existing) {
			existing = {
				title: name,
				isDefaultCorrespondence: isDefault,
				feeds: [],
			};
			groupMap.set(key, existing);
		}
		return existing;
	};

	const seenUrls = new Set<string>();
	const folderStack: string[] = [];

	// Tokenize <outline ...>, <outline .../>, and </outline>
	const tokenRegex = /<\/outline\s*>|<outline\b[^>]*>/gi;
	let match: RegExpExecArray | null;
	while ((match = tokenRegex.exec(trimmed)) !== null) {
		const token = match[0];
		if (/^<\/outline/i.test(token)) {
			if (folderStack.length > 0) folderStack.pop();
			continue;
		}

		const selfClosing = /\/\s*>$/.test(token);
		const attrs = parseAttributes(token);
		const xmlUrl = (attrs.xmlurl || attrs.url || "").trim();
		const label = (attrs.title || attrs.text || xmlUrl).trim();
		const htmlUrl = (attrs.htmlurl || "").trim() || undefined;

		if (xmlUrl) {
			const normKey = xmlUrl.toLowerCase();
			if (!seenUrls.has(normKey)) {
				seenUrls.add(normKey);
				const currentFolder = folderStack[folderStack.length - 1];
				const grp = currentFolder
					? ensureGroup(currentFolder, false)
					: ensureGroup("Correspondence", true);
				grp.feeds.push({
					title: label || xmlUrl,
					xmlUrl,
					htmlUrl,
				});
			}
			// Even if non-self-closing <outline xmlUrl="..."></outline> is used, push dummy so </outline> pops cleanly
			if (!selfClosing) {
				folderStack.push(folderStack[folderStack.length - 1] ?? "");
			}
		} else if (!selfClosing) {
			folderStack.push(label || "General");
		}
	}

	return {
		title: docTitle,
		groups: Array.from(groupMap.values()).filter((g) => g.feeds.length > 0),
	};
}

function escapeXmlAttr(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/**
 * Exports a `PaperConfig` into a standard OPML 2.0 XML document.
 */
export function exportPaperToOpml(paper: PaperConfig): string {
	const nowRfc = new Date().toUTCString();
	const lines: string[] = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<opml version="2.0">',
		"  <head>",
		`    <title>${escapeXmlAttr(paper.title)}</title>`,
		`    <dateCreated>${escapeXmlAttr(nowRfc)}</dateCreated>`,
		"  </head>",
		"  <body>",
	];

	const sectionById = new Map(paper.sections.map((s) => [s.id, s]));
	const sortedSections = [...paper.sections].sort((a, b) => a.order - b.order);

	for (const sec of sortedSections) {
		const secFeeds = paper.feeds.filter((f) => f.sectionId === sec.id);
		if (secFeeds.length === 0) continue;
		lines.push(`    <outline text="${escapeXmlAttr(sec.title)}" title="${escapeXmlAttr(sec.title)}">`);
		for (const f of secFeeds) {
			const htmlAttr = f.siteUrl ? ` htmlUrl="${escapeXmlAttr(f.siteUrl)}"` : "";
			lines.push(
				`      <outline type="rss" text="${escapeXmlAttr(f.title)}" title="${escapeXmlAttr(f.title)}" xmlUrl="${escapeXmlAttr(f.url)}"${htmlAttr} />`
			);
		}
		lines.push("    </outline>");
	}

	const ungrouped = paper.feeds.filter(
		(f) => f.sectionId === CORRESPONDENCE_SECTION_ID || !sectionById.has(f.sectionId)
	);
	for (const f of ungrouped) {
		const htmlAttr = f.siteUrl ? ` htmlUrl="${escapeXmlAttr(f.siteUrl)}"` : "";
		lines.push(
			`    <outline type="rss" text="${escapeXmlAttr(f.title)}" title="${escapeXmlAttr(f.title)}" xmlUrl="${escapeXmlAttr(f.url)}"${htmlAttr} />`
		);
	}

	lines.push("  </body>", "</opml>", "");
	return lines.join("\n");
}
