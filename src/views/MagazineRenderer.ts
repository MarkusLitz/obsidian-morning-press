import { formatShortDate, t } from "../i18n";
import { getEditionPalette, mountPressImageElement } from "../media/halftone";
import {
	ClipRecord,
	EditionIssue,
	ImageRenderStyle,
	PaperConfig,
	PressArticle,
	ReadingEntry,
} from "../types";

export interface MagazineRenderCallbacks {
	onOpenArticle: (article: PressArticle) => void;
	onToggleRead: (article: PressArticle) => void;
	onClipArticle: (article: PressArticle) => void;
	onOpenClipNote: (notePath: string) => void;
	getReadingEntry: (articleKey: string) => ReadingEntry | undefined;
	getClipRecord: (articleKey: string) => ClipRecord | undefined;
}

export function renderMagazineLayout(
	container: HTMLElement,
	issue: EditionIssue,
	paper: PaperConfig,
	articles: PressArticle[],
	dotSpacing: number,
	cb: MagazineRenderCallbacks
): void {
	if (articles.length === 0) return;

	const style = issue.magazineStyleUsed;
	const imageStyle: ImageRenderStyle = paper.imageStyle;
	const palette = getEditionPalette("magazine", issue.editionUsed, style);

	// For Plate (photography magazine), prioritize stories with photographs at the top
	const ordered =
		style === "plate-light" || style === "plate-dark"
			? [
					...articles.filter((a) => Boolean(a.imageUrl)),
					...articles.filter((a) => !a.imageUrl),
				]
			: articles;

	const [hero, ...rest] = ordered;

	// Hero Feature Spread
	if (hero) {
		const readEntry = cb.getReadingEntry(hero.articleKey);
		const isRead = readEntry?.status === "read";
		const heroEl = container.createDiv({
			cls: `op-mag-hero op-story-card ${isRead ? "is-read" : ""}`.trim(),
		});
		heroEl.addEventListener("click", () => cb.onOpenArticle(hero));

		const textCol = heroEl.createDiv({ cls: "op-mag-hero-copy" });
		const kicker = textCol.createDiv({ cls: "op-kicker-row" });
		kicker.createSpan({ cls: "op-kicker-source", text: hero.feedTitle });
		kicker.createSpan({ text: "·" });
		kicker.createSpan({ text: hero.sectionTitle });
		if (readEntry?.status === "reading" && readEntry.progress > 0.02) {
			kicker.createSpan({
				cls: "op-status-badge",
				text: t(issue.language, "progressBadge", {
					pct: Math.round(readEntry.progress * 100),
				}),
			});
		} else if (isRead) {
			kicker.createSpan({ cls: "op-status-badge", text: `✓ ${t(issue.language, "readBadge")}` });
		}

		textCol.createEl("h2", { cls: "op-mag-hero-title", text: hero.title });
		textCol.createEl("p", { cls: "op-story-excerpt", text: hero.excerpt });
		renderStoryFooter(textCol, hero, issue, cb);

		if (hero.imageUrl && imageStyle !== "none") {
			const mediaCol = heroEl.createDiv({ cls: "op-mag-hero-media" });
			mountPressImageElement(mediaCol, {
				url: hero.imageUrl,
				alt: hero.title,
				caption: hero.imageCaption,
				style: imageStyle,
				palette,
				dotSpacing,
				maxWidth: 860,
			});
		}
	}

	if (rest.length === 0) return;

	if (style === "signal") {
		const grid = container.createDiv({ cls: "op-mag-signal-grid" });
		rest.forEach((article, index) => {
			const entry = cb.getReadingEntry(article.articleKey);
			const isRead = entry?.status === "read";
			const card = grid.createDiv({
				cls: `op-mag-signal-card op-story-card ${isRead ? "is-read" : ""}`.trim(),
			});
			card.addEventListener("click", () => cb.onOpenArticle(article));

			const top = card.createDiv();
			top.createDiv({
				cls: "op-mag-signal-index",
				text: String(index + 2).padStart(2, "0"),
			});
			const kicker = top.createDiv({ cls: "op-kicker-row" });
			kicker.createSpan({ cls: "op-kicker-source", text: article.feedTitle });
			if (entry?.status === "reading" && entry.progress > 0.02) {
				kicker.createSpan({
					cls: "op-status-badge",
					text: `${Math.round(entry.progress * 100)}%`,
				});
			}

			if (article.imageUrl && imageStyle !== "none") {
				mountPressImageElement(top, {
					url: article.imageUrl,
					alt: article.title,
					style: imageStyle,
					palette,
					dotSpacing,
					maxWidth: 520,
				});
			}

			top.createEl("h3", { cls: "op-story-headline", text: article.title });
			top.createEl("p", { cls: "op-story-excerpt", text: article.excerpt });

			renderStoryFooter(card, article, issue, cb);
		});
		return;
	}

	if (style === "plate-light" || style === "plate-dark") {
		const grid = container.createDiv({ cls: "op-mag-plate-grid" });
		for (const article of rest) {
			const entry = cb.getReadingEntry(article.articleKey);
			const isRead = entry?.status === "read";
			const card = grid.createDiv({
				cls: `op-mag-plate-card op-story-card ${isRead ? "is-read" : ""}`.trim(),
			});
			card.addEventListener("click", () => cb.onOpenArticle(article));

			if (article.imageUrl && imageStyle !== "none") {
				mountPressImageElement(card, {
					url: article.imageUrl,
					alt: article.title,
					caption: article.imageCaption,
					style: imageStyle,
					palette,
					dotSpacing,
					maxWidth: 720,
				});
			}

			const kicker = card.createDiv({ cls: "op-kicker-row" });
			kicker.createSpan({ cls: "op-kicker-source", text: article.feedTitle });
			kicker.createSpan({ text: "·" });
			kicker.createSpan({ text: formatShortDate(article.publishedAt, issue.language) });

			card.createEl("h3", { cls: "op-story-headline", text: article.title });
			if (!article.imageUrl) {
				card.createEl("p", { cls: "op-story-excerpt", text: article.excerpt });
			}
			renderStoryFooter(card, article, issue, cb);
		}
		return;
	}

	// Default Magazine: Bicycle (literary serif on warm cream)
	const grid = container.createDiv({ cls: "op-mag-bicycle-grid" });
	for (const article of rest) {
		const entry = cb.getReadingEntry(article.articleKey);
		const isRead = entry?.status === "read";
		const card = grid.createDiv({
			cls: `op-story-card ${isRead ? "is-read" : ""}`.trim(),
		});
		card.addEventListener("click", () => cb.onOpenArticle(article));

		if (article.imageUrl && imageStyle !== "none") {
			mountPressImageElement(card, {
				url: article.imageUrl,
				alt: article.title,
				caption: article.imageCaption,
				style: imageStyle,
				palette,
				dotSpacing,
				maxWidth: 600,
			});
		}

		const kicker = card.createDiv({ cls: "op-kicker-row" });
		kicker.createSpan({ cls: "op-kicker-source", text: article.feedTitle });
		kicker.createSpan({ text: "·" });
		kicker.createSpan({ text: article.sectionTitle });
		if (entry?.status === "reading" && entry.progress > 0.02) {
			kicker.createSpan({
				cls: "op-status-badge",
				text: `${Math.round(entry.progress * 100)}%`,
			});
		}

		card.createEl("h3", { cls: "op-story-headline", text: article.title });
		card.createEl("p", { cls: "op-story-excerpt", text: article.excerpt });
		renderStoryFooter(card, article, issue, cb);
	}
}

function renderStoryFooter(
	parent: HTMLElement,
	article: PressArticle,
	issue: EditionIssue,
	cb: MagazineRenderCallbacks
): void {
	const footer = parent.createDiv({ cls: "op-story-footer" });
	footer.createSpan({
		text: `${formatShortDate(article.publishedAt, issue.language)} · ${t(issue.language, "minutesRead", {
			min: article.readingMinutes,
		})}`,
	});

	const actions = footer.createDiv({ cls: "op-story-actions" });
	const readEntry = cb.getReadingEntry(article.articleKey);
	const isRead = readEntry?.status === "read";
	const readBtn = actions.createEl("button", {
		cls: "op-mini-action",
		text: isRead ? "✓" : "○",
		attr: {
			title: isRead ? t(issue.language, "markUnread") : t(issue.language, "markRead"),
		},
	});
	readBtn.addEventListener("click", (ev) => {
		ev.stopPropagation();
		cb.onToggleRead(article);
	});

	const clip = cb.getClipRecord(article.articleKey);
	const clipBtn = actions.createEl("button", {
		cls: `op-mini-action ${clip ? "is-clipped" : ""}`.trim(),
		text: clip ? "✂ Clipped" : "✂ Clip",
	});
	clipBtn.addEventListener("click", (ev) => {
		ev.stopPropagation();
		if (clip) {
			cb.onOpenClipNote(clip.notePath);
		} else {
			cb.onClipArticle(article);
		}
	});
}
