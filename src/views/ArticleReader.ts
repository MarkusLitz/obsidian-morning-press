import { Notice, Platform, sanitizeHTMLToDom } from "obsidian";
import { extractFullArticle } from "../feeds/extractor";
import { formatMastheadDate, t } from "../i18n";
import { getEditionPalette, mountPressImageElement } from "../media/halftone";
import { ReadingSyncService } from "../sync/readingSync";
import {
	ClipRecord,
	EditionIssue,
	ImageRenderStyle,
	PaperConfig,
	PressArticle,
} from "../types";

export interface ArticleReaderCallbacks {
	onBack: () => void;
	onClip: (article: PressArticle, selectedQuote?: string, fullHtmlOverride?: string) => Promise<ClipRecord>;
	onOpenClipNote: (notePath: string) => void;
	getClipRecord: (articleKey: string) => ClipRecord | undefined;
	onPrintArticle: (article: PressArticle, bodyHtml: string) => void;
}

/**
 * Renders the full In-Paper Article Reader in the active edition's native typography,
 * tracking paragraph-level reading progress across devices and supporting 1-click clipping & full-text extraction.
 */
export function mountArticleReader(params: {
	scrollRoot: HTMLElement;
	sheetContainer: HTMLElement;
	article: PressArticle;
	issue: EditionIssue;
	paper: PaperConfig;
	dotSpacing: number;
	autoFetchFullText: boolean;
	readingSync: ReadingSyncService;
	callbacks: ArticleReaderCallbacks;
}): () => void {
	const {
		scrollRoot,
		sheetContainer,
		article,
		issue,
		paper,
		dotSpacing,
		autoFetchFullText,
		readingSync,
		callbacks,
	} = params;
	sheetContainer.empty();

	const originalFeedHtml = article.contentHtml;
	let extractedFullHtml: string | null = null;
	let extractedMinutes = article.readingMinutes;
	let currentHtml = article.contentHtml;
	let currentLeadImg = article.imageUrl;
	let localImageStyle: ImageRenderStyle =
		paper.imageStyle === "none" ? "halftone" : paper.imageStyle;
	let fullTextLoaded = false;
	let isFetchingFullText = false;

	const wrap = sheetContainer.createDiv({ cls: "op-reader-wrap" });

	// Sticky Toolbar + Progress Bar
	const sticky = wrap.createDiv({ cls: "op-reader-sticky-bar" });
	const toolbar = sticky.createDiv({ cls: "op-reader-toolbar" });

	const leftGroup = toolbar.createDiv({ cls: "op-utility-group" });
	const backBtn = leftGroup.createEl("button", {
		cls: "op-btn",
		text: `← ${t(issue.language, "backToPaper")}`,
	});
	backBtn.addEventListener("click", () => {
		void readingSync.flushNow();
		callbacks.onBack();
	});

	const rightGroup = toolbar.createDiv({ cls: "op-utility-group" });

	// Full-text extractor button
	const fullTextBtn = rightGroup.createEl("button", {
		cls: "op-btn",
		text: t(issue.language, "loadFullText"),
	});

	// Halftone <-> Original photo toggle
	const imgToggleBtn = rightGroup.createEl("button", {
		cls: "op-btn",
		text:
			localImageStyle === "halftone"
				? t(issue.language, "imagesColor")
				: t(issue.language, "imagesHalftone"),
	});

	// Clip story / selection button
	const updateClipButtons = () => {
		clipGroup.empty();
		const existingClip = callbacks.getClipRecord(article.articleKey);
		const sel = window.getSelection()?.toString().trim() ?? "";
		const clipBtn = clipGroup.createEl("button", {
			cls: "op-btn op-btn-primary",
			text: sel
				? `✂ ${t(issue.language, "clipSelection")}`
				: `✂ ${t(issue.language, "clipArticle")}`,
		});
		clipBtn.addEventListener("click", async () => {
			const selectedText = window.getSelection()?.toString().trim() || undefined;
			const rec = await callbacks.onClip(
				article,
				selectedText,
				fullTextLoaded ? currentHtml : undefined
			);
			new Notice(t(issue.language, "clippedToast", { path: rec.notePath }));
			updateClipButtons();
		});

		if (existingClip) {
			const openNoteBtn = clipGroup.createEl("button", {
				cls: "op-btn",
				text: t(issue.language, "clippedOpen"),
			});
			openNoteBtn.addEventListener("click", () => callbacks.onOpenClipNote(existingClip.notePath));
		}
	};

	const clipGroup = rightGroup.createSpan({ cls: "op-utility-group" });
	updateClipButtons();

	// Mark read/unread toggle
	const readToggleBtn = rightGroup.createEl("button", { cls: "op-btn" });
	const refreshReadBtnLabel = () => {
		const isRead = readingSync.isRead(article.articleKey);
		readToggleBtn.textContent = isRead
			? `✓ ${t(issue.language, "readBadge")}`
			: t(issue.language, "markRead");
		readToggleBtn.toggleClass("is-active", isRead);
	};
	refreshReadBtnLabel();
	readToggleBtn.addEventListener("click", () => {
		const nowRead = !readingSync.isRead(article.articleKey);
		readingSync.setReadStatus(article, paper.id, nowRead);
		refreshReadBtnLabel();
	});

	// Print button
	const printBtn = rightGroup.createEl("button", {
		cls: "op-btn",
		text: `⎙ ${t(issue.language, "printPdf")}`,
	});
	printBtn.addEventListener("click", () => {
		callbacks.onPrintArticle(article, currentHtml);
	});

	// Open original URL button
	if (article.url) {
		rightGroup.createEl("a", {
			cls: "op-btn op-btn-link",
			text: `${t(issue.language, "openOriginal")} ↗`,
			attr: {
				href: article.url,
				target: "_blank",
				rel: "noopener noreferrer",
			},
		});
	}

	const progressTrack = sticky.createDiv({ cls: "op-reader-progress-line" });
	const progressFill = progressTrack.createDiv({ cls: "op-reader-progress-fill" });

	// Article Header
	const header = wrap.createDiv({ cls: "op-reader-header" });
	const kicker = header.createDiv({ cls: "op-kicker-row" });
	kicker.createSpan({ cls: "op-kicker-source", text: article.feedTitle });
	kicker.createSpan({ text: "·" });
	kicker.createSpan({ text: article.sectionTitle });
	for (const topic of article.matchedTopics) {
		kicker.createSpan({ cls: "op-topic-pill", text: topic });
	}

	header.createEl("h1", { cls: "op-reader-headline", text: article.title });
	if (article.subtitle) {
		header.createEl("p", { cls: "op-masthead-subtitle", text: article.subtitle });
	}

	const byline = header.createDiv({ cls: "op-reader-byline" });
	if (article.author) {
		byline.createSpan({ text: t(issue.language, "byAuthor", { author: article.author }) });
	}
	byline.createSpan({
		text: formatMastheadDate(article.publishedAt, issue.language),
	});
	const readingMinsEl = byline.createSpan({
		text: t(issue.language, "minutesRead", { min: article.readingMinutes }),
	});

	const leadMediaSlot = wrap.createDiv({ cls: "op-reader-lead-media" });
	const statusBannerSlot = wrap.createDiv({ cls: "op-reader-status-slot" });
	const webviewSlot = wrap.createDiv({ cls: "op-reader-webview-slot" });
	const bodyEl = wrap.createDiv({ cls: "op-reader-body" });

	let isEmbeddedWebOpen = false;
	const toggleEmbeddedWebview = (forceOpen?: boolean) => {
		if (!Platform.isDesktopApp || !article.url) return;
		isEmbeddedWebOpen = forceOpen ?? !isEmbeddedWebOpen;
		webviewSlot.empty();
		if (isEmbeddedWebOpen) {
			leadMediaSlot.addClass("op-is-hidden");
			bodyEl.addClass("op-is-hidden");
			const bar = webviewSlot.createDiv({ cls: "op-webview-header" });
			bar.createSpan({ text: article.url, cls: "op-webview-url" });
			const closeWvBtn = bar.createEl("button", {
				cls: "op-btn",
				text: t(issue.language, "closeEmbeddedWeb"),
			});
			closeWvBtn.addEventListener("click", () => toggleEmbeddedWebview(false));

			const wv = document.createElement("webview");
			wv.setAttribute("src", article.url);
			wv.setAttribute("allowpopups", "true");
			wv.className = "op-embedded-webview";
			webviewSlot.appendChild(wv);
		} else {
			leadMediaSlot.removeClass("op-is-hidden");
			bodyEl.removeClass("op-is-hidden");
		}
	};

	const renderBodyAndImages = () => {
		leadMediaSlot.empty();
		bodyEl.empty();

		const palette = getEditionPalette(
			issue.formatUsed,
			issue.editionUsed,
			issue.magazineStyleUsed
		);

		const htmlContainsLeadImg =
			currentLeadImg && currentHtml.includes(currentLeadImg.split("?")[0]);

		if (currentLeadImg && !htmlContainsLeadImg) {
			mountPressImageElement(leadMediaSlot, {
				url: currentLeadImg,
				alt: article.title,
				caption: article.imageCaption,
				style: localImageStyle,
				palette,
				dotSpacing,
				maxWidth: 880,
			});
		}

		bodyEl.appendChild(sanitizeHTMLToDom(currentHtml));

		// Open external links cleanly in browser
		bodyEl.querySelectorAll("a").forEach((a) => {
			a.setAttribute("target", "_blank");
			a.setAttribute("rel", "noopener noreferrer");
		});

		// Screen inline images through halftone processor when halftone/color-ink is active
		if (localImageStyle === "halftone" || localImageStyle === "color-ink") {
			bodyEl.querySelectorAll("img").forEach((imgEl) => {
				const rawSrc = imgEl.getAttribute("src");
				if (!rawSrc || rawSrc.startsWith("data:")) return;
				const replacementHost = document.createElement("div");
				imgEl.replaceWith(replacementHost);
				mountPressImageElement(replacementHost, {
					url: rawSrc,
					alt: imgEl.getAttribute("alt") || "",
					style: localImageStyle,
					palette,
					dotSpacing,
					maxWidth: 780,
				});
			});
		}

		// Index paragraphs/blocks for cross-device paragraph-accurate resume
		const blocks = bodyEl.querySelectorAll("p, h2, h3, blockquote, li, pre");
		blocks.forEach((blk, idx) => {
			blk.setAttribute("data-op-para", String(idx));
		});
	};

	renderBodyAndImages();

	imgToggleBtn.addEventListener("click", () => {
		localImageStyle = localImageStyle === "halftone" ? "color" : "halftone";
		imgToggleBtn.textContent =
			localImageStyle === "halftone"
				? t(issue.language, "imagesColor")
				: t(issue.language, "imagesHalftone");
		renderBodyAndImages();
	});

	const fetchAndApplyFullText = async (isAutomatic: boolean): Promise<void> => {
		if (!article.url || isFetchingFullText) return;

		// If already fetched once, clicking toggles between full text and RSS summary
		if (extractedFullHtml !== null) {
			fullTextLoaded = !fullTextLoaded;
			currentHtml = fullTextLoaded ? extractedFullHtml : originalFeedHtml;
			readingMinsEl.textContent = t(issue.language, "minutesRead", {
				min: fullTextLoaded ? extractedMinutes : article.readingMinutes,
			});
			fullTextBtn.textContent = fullTextLoaded
				? `✓ ${t(issue.language, "showingFullText")}`
				: t(issue.language, "loadFullText");
			fullTextBtn.toggleClass("is-active", fullTextLoaded);
			renderBodyAndImages();
			return;
		}

		isFetchingFullText = true;
		fullTextBtn.disabled = true;
		fullTextBtn.textContent = t(issue.language, "loadingFullText");
		statusBannerSlot.empty();

		try {
			const outcome = await extractFullArticle(article.url);
			if (!wrap.isConnected) return;

			if (outcome.ok) {
				// Keep full RSS essay if feed already delivered substantially longer content than web snippet
				const shouldApply =
					article.wordCount < 320 || outcome.wordCount >= Math.floor(article.wordCount * 0.8);
				if (shouldApply) {
					extractedFullHtml = outcome.contentHtml;
					extractedMinutes = outcome.readingMinutes;
					currentHtml = outcome.contentHtml;
					if (!currentLeadImg && outcome.leadImageUrl) {
						currentLeadImg = outcome.leadImageUrl;
					}
					fullTextLoaded = true;
					readingMinsEl.textContent = t(issue.language, "minutesRead", {
						min: outcome.readingMinutes,
					});
					fullTextBtn.disabled = false;
					fullTextBtn.textContent = `✓ ${t(issue.language, "showingFullText")}`;
					fullTextBtn.addClass("is-active");
					toggleEmbeddedWebview(false);
					renderBodyAndImages();
				} else {
					fullTextBtn.disabled = false;
					fullTextBtn.textContent = t(issue.language, "showingFeedSummary");
				}
			} else {
				fullTextBtn.disabled = false;
				fullTextBtn.textContent = t(issue.language, "loadFullText");

				// Show blocked banner on 401/403/429 (or when manually clicked)
				if (outcome.reason === "blocked" || !isAutomatic) {
					const box = statusBannerSlot.createDiv({ cls: "op-blocked-banner" });
					box.createEl("strong", {
						text: t(issue.language, "blockedFullTextTitle", {
							status: outcome.status || 403,
						}),
					});
					box.createEl("p", { text: t(issue.language, "blockedFullTextDesc") });

					const actions = box.createDiv({ cls: "op-utility-group" });
					if (Platform.isDesktopApp) {
						const embedBtn = actions.createEl("button", {
							cls: "op-btn op-btn-primary",
							text: t(issue.language, "openEmbeddedWeb"),
						});
						embedBtn.addEventListener("click", () => {
							statusBannerSlot.empty();
							toggleEmbeddedWebview(true);
						});
					}
					actions.createEl("a", {
						cls: "op-btn op-btn-link",
						text: `${t(issue.language, "openOriginal")} ↗`,
						attr: {
							href: article.url,
							target: "_blank",
							rel: "noopener noreferrer",
						},
					});
				}
			}
		} catch (err) {
			fullTextBtn.disabled = false;
			fullTextBtn.textContent = t(issue.language, "loadFullText");
			if (!isAutomatic) {
				new Notice(err instanceof Error ? err.message : String(err));
			}
		} finally {
			isFetchingFullText = false;
		}
	};

	fullTextBtn.addEventListener("click", () => {
		void fetchAndApplyFullText(false);
	});

	// Selection listener so Clip button dynamically shows "Markierung clippen" when text is highlighted
	const onSelectionChange = () => {
		updateClipButtons();
	};
	document.addEventListener("selectionchange", onSelectionChange);

	// Restore previous cross-device reading position or start at top
	const existingState = readingSync.getEntry(article.articleKey);
	scrollRoot.scrollTop = 0;

	const scrollToSavedPosition = () => {
		if (!existingState || existingState.status !== "reading" || existingState.progress <= 0.04) {
			return;
		}
		window.requestAnimationFrame(() => {
			const targetBlock = bodyEl.querySelector(
				`[data-op-para="${existingState.paragraphIndex}"]`
			) as HTMLElement | null;
			if (targetBlock) {
				targetBlock.scrollIntoView({ behavior: "smooth", block: "center" });
				targetBlock.addClass("op-resume-highlight");
				window.setTimeout(() => targetBlock.removeClass("op-resume-highlight"), 2200);
			} else {
				const maxScroll = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight);
				scrollRoot.scrollTop = Math.round(existingState.progress * maxScroll);
			}
			progressFill.setCssProps({
				"--op-progress": `${Math.round(existingState.progress * 100)}%`,
			});
		});
	};

	const schedulePostLoadPositionAndReadCheck = () => {
		if (existingState && existingState.status === "reading" && existingState.progress > 0.04) {
			scrollToSavedPosition();
			return;
		}
		window.setTimeout(() => {
			if (!wrap.isConnected || isFetchingFullText) return;
			const maxScroll = scrollRoot.scrollHeight - scrollRoot.clientHeight;
			if (maxScroll <= 40 && !readingSync.isRead(article.articleKey)) {
				readingSync.recordProgress(article, paper.id, 1, 0);
				refreshReadBtnLabel();
				progressFill.setCssProps({ "--op-progress": "100%" });
			} else if (!existingState || existingState.status === "unread") {
				readingSync.recordProgress(article, paper.id, 0.05, 0);
			}
		}, 1200);
	};

	// Auto-fetch full text by default when enabled (or when opening a cross-device stub without cached HTML)
	if ((autoFetchFullText || !currentHtml.trim()) && article.url) {
		void fetchAndApplyFullText(true).then(() => {
			if (wrap.isConnected) {
				schedulePostLoadPositionAndReadCheck();
			}
		});
	} else {
		schedulePostLoadPositionAndReadCheck();
	}

	// Scroll listener for live progress & paragraph index tracking
	const onScroll = () => {
		if (isFetchingFullText) return;
		const maxScroll = scrollRoot.scrollHeight - scrollRoot.clientHeight;
		const ratio = maxScroll <= 20 ? 1 : Math.max(0, Math.min(1, scrollRoot.scrollTop / maxScroll));
		progressFill.setCssProps({ "--op-progress": `${Math.round(ratio * 100)}%` });

		// Find paragraph closest to upper third of viewport
		const viewportAnchorY = scrollRoot.getBoundingClientRect().top + scrollRoot.clientHeight * 0.32;
		let currentParaIdx = 0;
		const blocks = bodyEl.querySelectorAll("[data-op-para]");
		blocks.forEach((blk) => {
			const rect = blk.getBoundingClientRect();
			if (rect.top <= viewportAnchorY) {
				const parsedIdx = parseInt(blk.getAttribute("data-op-para") || "0", 10);
				if (Number.isFinite(parsedIdx)) currentParaIdx = parsedIdx;
			}
		});

		readingSync.recordProgress(article, paper.id, ratio, currentParaIdx);
		refreshReadBtnLabel();
	};

	scrollRoot.addEventListener("scroll", onScroll, { passive: true });

	return () => {
		scrollRoot.removeEventListener("scroll", onScroll);
		document.removeEventListener("selectionchange", onSelectionChange);
	};
}
