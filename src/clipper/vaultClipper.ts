import { App, TFile, normalizePath } from "obsidian";
import { decodeHtmlEntities, resolveRelativeUrl, stripHtmlToText } from "../feeds/parser";
import { toDateKey } from "../i18n";
import { ClipRecord, PressArticle } from "../types";

/**
 * Pure HTML-to-Markdown converter tailored for clean Obsidian Web-Clipper notes.
 */
export function htmlToCleanMarkdown(rawHtml: string, baseUrl?: string): string {
	if (!rawHtml) return "";

	let md = rawHtml
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<(script|style|iframe|noscript)\b[\s\S]*?<\/\1>/gi, "");

	// Code blocks
	md = md.replace(/<pre\b[^>]*>\s*<code\b[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_m, code: string) => {
		return `\n\n\`\`\`\n${decodeHtmlEntities(code.replace(/<[^>]+>/g, "")).trim()}\n\`\`\`\n\n`;
	});
	md = md.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, code: string) => {
		return `\n\n\`\`\`\n${decodeHtmlEntities(code.replace(/<[^>]+>/g, "")).trim()}\n\`\`\`\n\n`;
	});
	md = md.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, code: string) => {
		return `\`${decodeHtmlEntities(code.replace(/<[^>]+>/g, "")).trim()}\``;
	});

	// Headings
	for (let level = 1; level <= 6; level++) {
		const hashes = "#".repeat(level);
		const re = new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}>`, "gi");
		md = md.replace(re, (_m, inner: string) => `\n\n${hashes} ${stripHtmlToText(inner)}\n\n`);
	}

	// Images
	md = md.replace(/<img\b([^>]*)>/gi, (_m, attrs: string) => {
		const srcMatch = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
		if (!srcMatch?.[1]) return "";
		const altMatch = attrs.match(/\balt\s*=\s*["']([^"']*)["']/i);
		const url = resolveRelativeUrl(srcMatch[1], baseUrl) ?? srcMatch[1];
		const alt = altMatch ? decodeHtmlEntities(altMatch[1]).replace(/[\[\]\n]/g, " ").trim() : "";
		return `\n\n![${alt}](${url})\n\n`;
	});

	// Links
	md = md.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs: string, inner: string) => {
		const hrefMatch = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i);
		const label = stripHtmlToText(inner).replace(/\s+/g, " ").trim();
		if (!hrefMatch?.[1]) return label;
		const url = resolveRelativeUrl(hrefMatch[1], baseUrl) ?? hrefMatch[1];
		if (!label) return url;
		return `[${label}](${url})`;
	});

	// Bold & Italic
	md = md.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => {
		const text = inner.trim();
		return text ? `**${text}**` : "";
	});
	md = md.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => {
		const text = inner.trim();
		return text ? `*${text}*` : "";
	});

	// Blockquotes
	md = md.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) => {
		const clean = stripHtmlToText(inner)
			.split(/\n/)
			.map((l) => `> ${l}`)
			.join("\n");
		return `\n\n${clean}\n\n`;
	});

	// Lists
	md = md.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => {
		return `\n- ${stripHtmlToText(inner).replace(/\n+/g, " ").trim()}`;
	});
	md = md.replace(/<\/?(ul|ol)\b[^>]*>/gi, "\n\n");

	// Paragraphs & line breaks
	md = md.replace(/<br\s*\/?>/gi, "\n");
	md = md.replace(/<\/p>/gi, "\n\n");
	md = md.replace(/<p\b[^>]*>/gi, "\n\n");
	md = md.replace(/<\/?(div|section|article|figure|figcaption|header|footer)\b[^>]*>/gi, "\n\n");

	// Strip remaining tags & decode entities
	md = decodeHtmlEntities(md.replace(/<[^>]+>/g, ""));

	// Normalize whitespace
	return md
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function escapeYamlString(val: string): string {
	return `"${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ").trim()}"`;
}

export function sanitizeNoteFileName(title: string): string {
	const cleaned = title
		.replace(/[\\/:*?"<>|#^\[\]]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\.+|\.+$/g, "");
	return (cleaned || "Unbenannter Artikel").slice(0, 110).trim();
}

/**
 * Builds the full Markdown note matching the Vault's Web-Clipper frontmatter convention.
 */
export function buildClippingMarkdown(params: {
	article: PressArticle;
	createdDate?: string;
	selectedQuote?: string;
	fullHtmlOverride?: string;
}): string {
	const { article, selectedQuote, fullHtmlOverride } = params;
	const created = params.createdDate ?? toDateKey(new Date());
	const published = toDateKey(new Date(article.publishedAt));
	const authorLine = article.author ? `author: ${escapeYamlString(article.author)}` : "author:";
	const description = article.excerpt || article.subtitle || "";

	const frontmatter = [
		"---",
		`title: ${escapeYamlString(article.title)}`,
		`source: ${escapeYamlString(article.url)}`,
		authorLine,
		`published: ${published}`,
		`created: ${created}`,
		`description: ${escapeYamlString(description.slice(0, 260))}`,
		`publication: ${escapeYamlString(article.feedTitle)}`,
		"tags:",
		'  - "clippings"',
		"---",
		"",
	].join("\n");

	const parts: string[] = [frontmatter];

	if (article.imageUrl) {
		parts.push(`![${article.imageCaption ?? article.title}](${article.imageUrl})\n`);
	}

	if (selectedQuote && selectedQuote.trim()) {
		const quoteLines = selectedQuote
			.trim()
			.split(/\r?\n/)
			.map((l) => `> ${l}`)
			.join("\n");
		parts.push(`## Geclippte Passage\n\n${quoteLines}\n\n---\n`);
	}

	const bodyMd = htmlToCleanMarkdown(fullHtmlOverride ?? article.contentHtml, article.url);
	parts.push(bodyMd || article.plainText);
	parts.push("");

	return parts.join("\n");
}

/**
 * Saves or appends a clipping inside `Clippings/` (configurable) and returns its ClipRecord.
 */
export async function saveArticleClipToVault(params: {
	app: App;
	folder: string;
	article: PressArticle;
	existingClip?: ClipRecord;
	selectedQuote?: string;
	fullHtmlOverride?: string;
}): Promise<ClipRecord> {
	const { app, article, existingClip, selectedQuote, fullHtmlOverride } = params;
	const cleanFolder = normalizePath(params.folder.trim() || "Clippings");

	if (!app.vault.getAbstractFileByPath(cleanFolder)) {
		await mkdirRecursive(app, cleanFolder);
	}

	// If already clipped and user clips an additional quote, append the quote cleanly!
	if (existingClip) {
		const existingFile = app.vault.getAbstractFileByPath(existingClip.notePath);
		if (existingFile instanceof TFile) {
			if (selectedQuote && selectedQuote.trim()) {
				const currentText = await app.vault.read(existingFile);
				const quoteBlock = selectedQuote
					.trim()
					.split(/\r?\n/)
					.map((l) => `> ${l}`)
					.join("\n");
				await app.vault.modify(existingFile, `${currentText.trimEnd()}\n\n### Weiterer Ausschnitt\n\n${quoteBlock}\n`);
			}
			return {
				...existingClip,
				clippedAt: Date.now(),
				excerptText: selectedQuote || existingClip.excerptText,
			};
		}
	}

	const baseName = sanitizeNoteFileName(article.title);
	let targetPath = normalizePath(`${cleanFolder}/${baseName}.md`);
	let suffix = 2;
	while (app.vault.getAbstractFileByPath(targetPath)) {
		targetPath = normalizePath(`${cleanFolder}/${baseName} (${suffix}).md`);
		suffix++;
	}

	const markdown = buildClippingMarkdown({
		article,
		selectedQuote,
		fullHtmlOverride,
	});

	await app.vault.create(targetPath, markdown);

	return {
		articleKey: article.articleKey,
		title: article.title,
		url: article.url,
		feedTitle: article.feedTitle,
		notePath: targetPath,
		clippedAt: Date.now(),
		excerptText: selectedQuote?.trim() || article.excerpt,
	};
}

async function mkdirRecursive(app: App, folderPath: string): Promise<void> {
	const segments = folderPath.split("/").filter(Boolean);
	let acc = "";
	for (const seg of segments) {
		acc = acc ? `${acc}/${seg}` : seg;
		if (!app.vault.getAbstractFileByPath(acc)) {
			try {
				await app.vault.createFolder(acc);
			} catch {
				// Ignore if already created
			}
		}
	}
}
