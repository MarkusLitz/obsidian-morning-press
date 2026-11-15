import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { saveArticleClipToVault } from "../clipper/vaultClipper";
import { formatMastheadDate, formatShortDate, toDateKey, t } from "../i18n";
import { getEditionPalette, mountPressImageElement } from "../media/halftone";
import { BackIssueSummary } from "../press/archiveStore";
import {
	ClipRecord,
	EditionIssue,
	ImageRenderStyle,
	MagazineStyle,
	NewspaperEdition,
	PaperConfig,
	PaperLanguage,
	PressArticle,
	ReadFilterMode,
	VIEW_TYPE_PRESS,
	localizeDefaultLabel,
	resolvePaperLanguage,
} from "../types";
import type ObsidianPressPlugin from "../main";
import { mountArticleReader } from "./ArticleReader";
import { renderMagazineLayout } from "./MagazineRenderer";
import { ManagePaperModal } from "./ManagePaperModal";

const GOOGLE_FONTS_ID = "obsidian-press-google-fonts";
const GOOGLE_FONTS_HREF =
	"https://fonts.googleapis.com/css2?family=Courier+Prime:ital,wght@0,400;0,700;1,400&family=Fraunces:ital,opsz,wght@0,9..144,600..900;1,9..144,400..700&family=Inter:wght@400;500;600;700;800&family=Newsreader:ital,opsz,wght@0,6..72,400..600;1,6..72,400..600&display=swap";

export class PressView extends ItemView {
	private plugin: ObsidianPressPlugin;
	private rootEl!: HTMLElement;
	private sheetEl!: HTMLElement;

	private currentIssue: EditionIssue | null = null;
	private activeSectionId = "front-page";
	private readFilter: ReadFilterMode = "all";
	private openedArticle: PressArticle | null = null;
	private savedPaperScrollTop = 0;

	private showArchiveRack = false;
	private showClippingsRack = false;
	private backIssuesCache: BackIssueSummary[] = [];
	private isPrintingEdition = false;

	private cleanupReader: (() => void) | null = null;
	private unsubscribeSync: (() => void) | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ObsidianPressPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_PRESS;
	}

	getDisplayText(): string {
		return this.plugin.getActivePaper().title || "Obsidian Press";
	}

	getIcon(): string {
		return "newspaper";
	}

	async onOpen(): Promise<void> {
		this.ensureTypographyLoaded();

		this.contentEl.empty();
		this.contentEl.style.padding = "0";
		this.contentEl.style.overflow = "hidden";

		this.rootEl = this.contentEl.createDiv({ cls: "obsidian-press-root" });
		this.sheetEl = this.rootEl.createDiv({ cls: "op-sheet" });

		this.unsubscribeSync = this.plugin.readingSync.onChange(() => {
			// When reading state updates externally (e.g., via Obsidian Sync from another device)
			// while viewing the newspaper page, refresh indicators without losing scroll position!
			if (!this.openedArticle && !this.isPrintingEdition) {
				const prevScroll = this.rootEl.scrollTop;
				this.renderSheet();
				this.rootEl.scrollTop = prevScroll;
			}
		});

		await this.loadOrCompileTodayIssue(false);
	}

	async onClose(): Promise<void> {
		this.cleanupReader?.();
		this.cleanupReader = null;
		this.unsubscribeSync?.();
		this.unsubscribeSync = null;
		await this.plugin.readingSync.flushNow();
	}

	public ensureTypographyLoaded(): void {
		if (!this.plugin.settings.loadGoogleFonts) return;
		if (!document.getElementById(GOOGLE_FONTS_ID)) {
			const link = document.createElement("link");
			link.id = GOOGLE_FONTS_ID;
			link.rel = "stylesheet";
			link.href = GOOGLE_FONTS_HREF;
			document.head.appendChild(link);
		}
	}

	public async loadOrCompileTodayIssue(forceFresh: boolean): Promise<void> {
		const paper = this.plugin.getActivePaper();
		this.applyThemeClasses(paper, this.currentIssue);

		if (paper.feeds.length === 0) {
			this.currentIssue = null;
			this.openedArticle = null;
			this.renderSheet();
			return;
		}

		const todayKey = toDateKey(new Date());
		if (!forceFresh) {
			const cached = await this.plugin.archiveStore.loadIssue(paper.id, todayKey);
			if (cached) {
				this.currentIssue = cached;
				this.backIssuesCache = await this.plugin.archiveStore.listBackIssues(
					paper.id,
					this.plugin.settings.fortnightDays
				);
				this.applyThemeClasses(paper, cached);
				this.renderSheet();
				return;
			}
		}

		await this.printFreshNow();
	}

	private effectivePaper(raw = this.plugin.getActivePaper()): PaperConfig {
		const lang = resolvePaperLanguage(raw, this.plugin.settings.uiLanguage);
		return {
			...raw,
			language: lang,
			subtitle: localizeDefaultLabel(raw.subtitle, lang),
			motto: localizeDefaultLabel(raw.motto, lang),
			sections: raw.sections.map((s) => ({
				...s,
				title: localizeDefaultLabel(s.title, lang),
			})),
		};
	}

	private effectiveIssue(issue: EditionIssue, lang: PaperLanguage): EditionIssue {
		const mapArt = (a: PressArticle): PressArticle => ({
			...a,
			sectionTitle: localizeDefaultLabel(a.sectionTitle, lang),
		});
		return {
			...issue,
			language: lang,
			paperSubtitle: localizeDefaultLabel(issue.paperSubtitle, lang),
			paperMotto: localizeDefaultLabel(issue.paperMotto, lang),
			leadStory: issue.leadStory ? mapArt(issue.leadStory) : null,
			secondaryLeads: issue.secondaryLeads.map(mapArt),
			belowFoldStories: issue.belowFoldStories.map(mapArt),
			sections: issue.sections.map((s) => ({
				...s,
				title: localizeDefaultLabel(s.title, lang),
				articles: s.articles.map(mapArt),
			})),
		};
	}

	public async printFreshNow(): Promise<void> {
		const rawPaper = this.plugin.getActivePaper();
		if (rawPaper.feeds.length === 0) {
			this.currentIssue = null;
			this.openedArticle = null;
			this.renderSheet();
			return;
		}
		this.isPrintingEdition = true;
		this.openedArticle = null;
		this.cleanupReader?.();
		this.cleanupReader = null;
		this.renderSheet();

		try {
			const effPaper = this.effectivePaper(rawPaper);
			const { issue, updatedPaper } = await this.plugin.archiveStore.printFreshEdition(
				effPaper,
				this.plugin.settings.fortnightDays
			);
			await this.plugin.replacePaperConfig(
				{
					...updatedPaper,
					subtitle: rawPaper.subtitle,
					motto: rawPaper.motto,
					sections: rawPaper.sections,
					languageOverride: rawPaper.languageOverride,
				},
				false
			);
			this.currentIssue = issue;
			this.backIssuesCache = await this.plugin.archiveStore.listBackIssues(
				rawPaper.id,
				this.plugin.settings.fortnightDays
			);
			this.applyThemeClasses(updatedPaper, issue);
		} finally {
			this.isPrintingEdition = false;
			this.renderSheet();
		}
	}

	private applyThemeClasses(paper: PaperConfig, issue: EditionIssue | null): void {
		if (!this.rootEl) return;
		const classes = ["obsidian-press-root", `op-scale-${paper.typeScale}`];

		const format = issue?.formatUsed ?? paper.formatMode;
		if (format === "magazine") {
			classes.push(`op-mag-${issue?.magazineStyleUsed ?? paper.magazineStyle}`);
		} else {
			classes.push(`op-edition-${issue?.editionUsed ?? paper.edition}`);
		}

		if (paper.sheetMode === "folded") {
			classes.push("op-sheet-folded");
		} else if (paper.sheetMode === "broadsheet") {
			classes.push("op-sheet-broadsheet");
		}

		if (this.plugin.settings.dimReadArticles) {
			classes.push("op-dim-read");
		}

		this.rootEl.className = classes.join(" ");
	}

	public refreshFromSettings(): void {
		const paper = this.plugin.getActivePaper();
		this.ensureTypographyLoaded();
		this.applyThemeClasses(paper, this.currentIssue);
		this.renderSheet();
	}

	private collectAllIssueArticles(issue: EditionIssue): PressArticle[] {
		const map = new Map<string, PressArticle>();
		if (issue.leadStory) map.set(issue.leadStory.articleKey, issue.leadStory);
		for (const s of issue.secondaryLeads) map.set(s.articleKey, s);
		for (const s of issue.belowFoldStories) map.set(s.articleKey, s);
		for (const sec of issue.sections) {
			for (const a of sec.articles) {
				if (!map.has(a.articleKey)) map.set(a.articleKey, a);
			}
		}
		return Array.from(map.values());
	}

	private matchesReadFilter(article: PressArticle): boolean {
		if (this.readFilter === "all") return true;
		const entry = this.plugin.readingSync.getEntry(article.articleKey);
		if (this.readFilter === "unread") {
			return !entry || entry.status !== "read";
		}
		return entry?.status === "reading";
	}

	private openStoryInReader(article: PressArticle): void {
		this.savedPaperScrollTop = this.rootEl.scrollTop;
		this.openedArticle = article;
		this.renderSheet();
	}

	private renderSheet(): void {
		if (!this.sheetEl) return;
		this.cleanupReader?.();
		this.cleanupReader = null;

		const paper = this.effectivePaper();
		const displayIssue = this.currentIssue
			? this.effectiveIssue(this.currentIssue, paper.language)
			: null;
		this.applyThemeClasses(paper, displayIssue);

		// If an article is opened in the In-Paper Reader, mount it!
		if (this.openedArticle && displayIssue) {
			const readerArticle: PressArticle = {
				...this.openedArticle,
				sectionTitle: localizeDefaultLabel(this.openedArticle.sectionTitle, paper.language),
			};
			this.cleanupReader = mountArticleReader({
				scrollRoot: this.rootEl,
				sheetContainer: this.sheetEl,
				article: readerArticle,
				issue: displayIssue,
				paper,
				dotSpacing: this.plugin.settings.halftoneDotSize,
				autoFetchFullText: this.plugin.settings.autoFetchFullText,
				readingSync: this.plugin.readingSync,
				callbacks: {
					onBack: () => {
						this.openedArticle = null;
						this.renderSheet();
						this.rootEl.scrollTop = this.savedPaperScrollTop;
					},
					onClip: async (art, quote, fullHtml) => {
						return await this.clipStory(art, quote, fullHtml);
					},
					onOpenClipNote: (notePath) => this.openVaultNote(notePath),
					getClipRecord: (key) => this.plugin.settings.clips[key],
					onPrintArticle: (art, bodyHtml) => this.printSingleArticle(art, bodyHtml),
				},
			});
			return;
		}

		this.sheetEl.empty();

		// 1. Top Press Utility Chrome Bar
		this.renderUtilityBar(this.sheetEl, paper);

		// 2. Optional Fortnight Back-Issue Rack Drawer
		if (this.showArchiveRack) {
			this.renderArchiveRack(this.sheetEl, paper);
		}

		// 3. Optional Clippings Drawer
		if (this.showClippingsRack) {
			this.renderClippingsRack(this.sheetEl, paper);
		}

		// 4. Masthead
		this.renderMasthead(this.sheetEl, paper, displayIssue);

		// 5. Loading / Empty / Main Edition Body
		if (this.isPrintingEdition) {
			const box = this.sheetEl.createDiv({ cls: "op-empty-press" });
			box.createEl("h2", { text: t(paper.language, "printingEdition") });
			return;
		}

		if (paper.feeds.length === 0) {
			const empty = this.sheetEl.createDiv({ cls: "op-empty-press" });
			empty.createEl("h2", { text: t(paper.language, "emptyPressTitle") });
			empty.createEl("p", { text: t(paper.language, "emptyPressLead") });
			const setupBtn = empty.createEl("button", {
				cls: "op-btn op-btn-primary",
				text: t(paper.language, "setupSourcesBtn"),
			});
			setupBtn.style.padding = "8px 18px";
			setupBtn.style.fontSize = "0.9rem";
			setupBtn.addEventListener("click", () => this.openManageModal("starter"));
			return;
		}

		if (!displayIssue || displayIssue.totalArticles === 0) {
			const empty = this.sheetEl.createDiv({ cls: "op-empty-press" });
			empty.createEl("p", { text: t(paper.language, "noArticlesInIssue") });
			const retryBtn = empty.createEl("button", {
				cls: "op-btn op-btn-primary",
				text: t(paper.language, "printFresh"),
			});
			retryBtn.addEventListener("click", () => void this.printFreshNow());
			return;
		}

		const issue = displayIssue;
		const allIssueArticles = this.collectAllIssueArticles(issue);

		// 6. Desk Navigation + Read/Unread Filter Pills
		this.renderDeskAndFilterNav(this.sheetEl, paper, issue, allIssueArticles);

		// 7. Cross-Device "Continue Reading" Strip (when on Front Page and stories are in progress)
		if (this.activeSectionId === "front-page" && this.readFilter !== "reading") {
			this.renderContinueReadingStrip(this.sheetEl, issue, allIssueArticles);
		}

		// 8. Magazine Mode vs. Classic Newspaper Mode
		if (issue.formatUsed === "magazine") {
			const sourcePool =
				this.activeSectionId === "front-page"
					? allIssueArticles
					: issue.sections.find((s) => s.id === this.activeSectionId)?.articles ?? [];
			const filtered = sourcePool.filter((a) => this.matchesReadFilter(a));
			if (filtered.length === 0) {
				this.sheetEl.createDiv({
					cls: "op-empty-press",
					text: t(issue.language, "noUnreadArticles"),
				});
				return;
			}
			renderMagazineLayout(
				this.sheetEl,
				issue,
				paper,
				filtered,
				this.plugin.settings.halftoneDotSize,
				{
					onOpenArticle: (art) => this.openStoryInReader(art),
					onToggleRead: (art) => this.toggleArticleRead(art, paper.id),
					onClipArticle: (art) => void this.clipStoryWithNotice(art, issue.language),
					onOpenClipNote: (path) => this.openVaultNote(path),
					getReadingEntry: (key) => this.plugin.readingSync.getEntry(key),
					getClipRecord: (key) => this.plugin.settings.clips[key],
				}
			);
			return;
		}

		// Classic Newspaper Layout
		if (this.activeSectionId !== "front-page") {
			const activeSec = issue.sections.find((s) => s.id === this.activeSectionId);
			const secArticles = (activeSec?.articles ?? []).filter((a) => this.matchesReadFilter(a));
			if (secArticles.length === 0) {
				this.sheetEl.createDiv({
					cls: "op-empty-press",
					text: t(issue.language, "noUnreadArticles"),
				});
				return;
			}
			this.renderSingleSectionPage(this.sheetEl, paper, issue, activeSec!.title, secArticles);
			return;
		}

		this.renderNewspaperFrontPage(this.sheetEl, paper, issue);
	}

	private renderUtilityBar(container: HTMLElement, paper: PaperConfig): void {
		const bar = container.createDiv({ cls: "op-utility-bar" });
		const left = bar.createDiv({ cls: "op-utility-group" });
		const right = bar.createDiv({ cls: "op-utility-group" });

		// Paper Switcher if multiple papers exist
		if (this.plugin.settings.papers.length > 1) {
			const pSel = left.createEl("select", { cls: "op-select" });
			for (const p of this.plugin.settings.papers) {
				const opt = pSel.createEl("option", { value: p.id, text: p.title });
				if (p.id === paper.id) opt.selected = true;
			}
			pSel.addEventListener("change", async () => {
				this.plugin.settings.activePaperId = pSel.value;
				await this.plugin.saveSettings();
				this.activeSectionId = "front-page";
				await this.loadOrCompileTodayIssue(false);
			});
		}

		// Quick Format Switcher (Newspaper / Magazine)
		const formatToggle = left.createEl("button", {
			cls: "op-btn",
			text:
				(this.currentIssue?.formatUsed ?? paper.formatMode) === "magazine"
					? `📖 ${t(paper.language, "formatMagazine")}`
					: `🗞 ${t(paper.language, "formatNewspaper")}`,
		});
		formatToggle.addEventListener("click", async () => {
			const stored = this.plugin.getActivePaper();
			const currentFmt = this.currentIssue?.formatUsed ?? stored.formatMode;
			const nextFmt = currentFmt === "magazine" ? "newspaper" : "magazine";
			stored.formatMode = nextFmt;
			stored.updatedAt = Date.now();
			if (this.currentIssue) {
				this.currentIssue.formatUsed = nextFmt;
				await this.plugin.archiveStore.saveIssue(
					this.currentIssue,
					this.plugin.settings.fortnightDays
				);
			}
			await this.plugin.replacePaperConfig(stored, true);
			this.renderSheet();
		});

		// Quick Edition / Magazine Style Switcher
		const activeFmt = this.currentIssue?.formatUsed ?? paper.formatMode;
		if (activeFmt === "magazine") {
			const magSel = left.createEl("select", { cls: "op-select" });
			const magOpts: Array<[MagazineStyle, string]> = [
				["bicycle", "Bicycle (Serif)"],
				["signal", "Signal (Grotesk)"],
				["plate-light", "Plate (White)"],
				["plate-dark", "Plate (Black)"],
			];
			for (const [val, lbl] of magOpts) {
				const opt = magSel.createEl("option", { value: val, text: lbl });
				if ((this.currentIssue?.magazineStyleUsed ?? paper.magazineStyle) === val) opt.selected = true;
			}
			magSel.addEventListener("change", async () => {
				const stored = this.plugin.getActivePaper();
				const val = magSel.value as MagazineStyle;
				stored.magazineStyle = val;
				stored.updatedAt = Date.now();
				if (this.currentIssue) this.currentIssue.magazineStyleUsed = val;
				await this.plugin.replacePaperConfig(stored, true);
				this.renderSheet();
			});
		} else {
			const edSel = left.createEl("select", { cls: "op-select" });
			const edOpts: Array<[NewspaperEdition, string]> = [
				["biblio", "Biblio"],
				["digital", "Digital"],
				["dystopian", "Dystopian"],
			];
			for (const [val, lbl] of edOpts) {
				const opt = edSel.createEl("option", { value: val, text: lbl });
				if ((this.currentIssue?.editionUsed ?? paper.edition) === val) opt.selected = true;
			}
			edSel.addEventListener("change", async () => {
				const stored = this.plugin.getActivePaper();
				const val = edSel.value as NewspaperEdition;
				stored.edition = val;
				stored.updatedAt = Date.now();
				if (this.currentIssue) this.currentIssue.editionUsed = val;
				await this.plugin.replacePaperConfig(stored, true);
				this.renderSheet();
			});
		}

		// Quick Image Style Switcher (Halftone / Color Ink / Full Color / None)
		const imgSel = left.createEl("select", { cls: "op-select" });
		const imgOpts: Array<[ImageRenderStyle, string]> = [
			["halftone", t(paper.language, "imagesHalftone")],
			["color-ink", t(paper.language, "imagesColorInk")],
			["color", t(paper.language, "imagesColor")],
			["none", t(paper.language, "imagesNone")],
		];
		for (const [val, lbl] of imgOpts) {
			const opt = imgSel.createEl("option", { value: val, text: lbl });
			if (paper.imageStyle === val) opt.selected = true;
		}
		imgSel.addEventListener("change", async () => {
			const stored = this.plugin.getActivePaper();
			stored.imageStyle = imgSel.value as ImageRenderStyle;
			stored.updatedAt = Date.now();
			await this.plugin.replacePaperConfig(stored, true);
			this.renderSheet();
		});

		// Right Actions: Print Fresh Edition, Fortnight Rack, Clippings, Print PDF, Manage Paper
		const freshBtn = right.createEl("button", {
			cls: "op-btn op-btn-primary",
			text: `↻ ${t(paper.language, "printFresh")}`,
		});
		freshBtn.addEventListener("click", () => void this.printFreshNow());

		const archiveBtn = right.createEl("button", {
			cls: `op-btn ${this.showArchiveRack ? "is-active" : ""}`.trim(),
			text: t(paper.language, "backIssues"),
		});
		archiveBtn.addEventListener("click", async () => {
			this.showArchiveRack = !this.showArchiveRack;
			if (this.showArchiveRack) {
				this.showClippingsRack = false;
				this.backIssuesCache = await this.plugin.archiveStore.listBackIssues(
					paper.id,
					this.plugin.settings.fortnightDays
				);
			}
			this.renderSheet();
		});

		const clipsCount = Object.keys(this.plugin.settings.clips).length;
		const clipsBtn = right.createEl("button", {
			cls: `op-btn ${this.showClippingsRack ? "is-active" : ""}`.trim(),
			text: `✂ ${t(paper.language, "clippingsRack")}${clipsCount > 0 ? ` (${clipsCount})` : ""}`,
		});
		clipsBtn.addEventListener("click", () => {
			this.showClippingsRack = !this.showClippingsRack;
			if (this.showClippingsRack) this.showArchiveRack = false;
			this.renderSheet();
		});

		const printBtn = right.createEl("button", {
			cls: "op-btn",
			text: `⎙ ${t(paper.language, "printPdf")}`,
		});
		printBtn.addEventListener("click", () => this.printCurrentEdition());

		const manageBtn = right.createEl("button", {
			cls: "op-btn",
			text: `⚙ ${t(paper.language, "managePaper")}`,
		});
		manageBtn.addEventListener("click", () => this.openManageModal());
	}

	private renderArchiveRack(container: HTMLElement, paper: PaperConfig): void {
		const panel = container.createDiv({ cls: "op-rack-panel" });
		panel.createEl("strong", { text: t(paper.language, "backIssues") });

		if (this.backIssuesCache.length === 0) {
			panel.createEl("p", { text: t(paper.language, "archiveEmpty") });
			return;
		}

		const grid = panel.createDiv({ cls: "op-rack-grid" });
		for (const item of this.backIssuesCache) {
			const isCurrent = this.currentIssue?.dateKey === item.dateKey;
			const card = grid.createDiv({
				cls: `op-rack-card ${isCurrent ? "is-current" : ""}`.trim(),
			});
			card.createDiv({
				text: `${item.dateKey} · ${t(paper.language, "issueNo", { no: item.issueNumber })}`,
				attr: { style: "font-weight: 700; font-size: 0.8rem;" },
			});
			if (item.leadHeadline) {
				card.createDiv({
					text: item.leadHeadline,
					attr: {
						style: "font-size: 0.84rem; margin-top: 4px; line-height: 1.3;",
					},
				});
			}
			card.addEventListener("click", async () => {
				const loaded = await this.plugin.archiveStore.loadIssue(paper.id, item.dateKey);
				if (loaded) {
					this.currentIssue = loaded;
					this.showArchiveRack = false;
					this.renderSheet();
				}
			});
		}
	}

	private renderClippingsRack(container: HTMLElement, paper: PaperConfig): void {
		const panel = container.createDiv({ cls: "op-rack-panel" });
		panel.createEl("strong", { text: `✂ ${t(paper.language, "clippingsRack")}` });

		const clips = Object.values(this.plugin.settings.clips).sort(
			(a, b) => b.clippedAt - a.clippedAt
		);
		if (clips.length === 0) {
			panel.createEl("p", { text: t(paper.language, "clippingsEmpty") });
			return;
		}

		const grid = panel.createDiv({ cls: "op-rack-grid" });
		for (const clip of clips.slice(0, 24)) {
			const card = grid.createDiv({ cls: "op-rack-card" });
			card.createDiv({
				text: clip.feedTitle,
				attr: { style: "font-size: 0.72rem; text-transform: uppercase; opacity: 0.75;" },
			});
			card.createDiv({
				text: clip.title,
				attr: { style: "font-weight: 700; font-size: 0.88rem; margin-top: 2px;" },
			});
			card.addEventListener("click", () => this.openVaultNote(clip.notePath));
		}
	}

	private renderMasthead(
		container: HTMLElement,
		paper: PaperConfig,
		issue: EditionIssue | null
	): void {
		const masthead = container.createDiv({ cls: "op-masthead" });

		const ears = masthead.createDiv({ cls: "op-masthead-ears" });
		ears.createSpan({ text: paper.motto || "Your device is the press" });
		ears.createSpan({
			text:
				issue?.formatUsed === "magazine"
					? t(paper.language, "sundayMagazineBadge")
					: paper.subtitle,
		});

		const titleRow = masthead.createDiv({ cls: "op-masthead-title-row" });
		titleRow.createEl("h1", { cls: "op-masthead-title", text: paper.title });
		if (paper.subtitle && issue?.formatUsed !== "magazine") {
			titleRow.createDiv({ cls: "op-masthead-subtitle", text: paper.subtitle });
		}

		const dateline = masthead.createDiv({ cls: "op-masthead-dateline" });
		const volStr = `${t(paper.language, "volume", {
			vol: issue?.volumeNumber ?? paper.volumeNumber,
		})} · ${t(paper.language, "issueNo", {
			no: issue?.issueNumber ?? Math.max(1, paper.issueCounter),
		})}`;
		dateline.createSpan({ text: volStr });
		dateline.createSpan({
			text: formatMastheadDate(issue?.compiledAt ?? Date.now(), paper.language),
		});

		if (issue) {
			const all = this.collectAllIssueArticles(issue);
			const readCount = all.filter((a) => this.plugin.readingSync.isRead(a.articleKey)).length;
			dateline.createSpan({
				text: t(paper.language, "readProgressSummary", {
					read: readCount,
					total: all.length,
				}),
			});
		} else {
			dateline.createSpan({ text: paper.edition.toUpperCase() });
		}
	}

	private renderDeskAndFilterNav(
		container: HTMLElement,
		paper: PaperConfig,
		issue: EditionIssue,
		allArticles: PressArticle[]
	): void {
		const nav = container.createDiv({ cls: "op-desk-nav" });
		const tabs = nav.createDiv({ cls: "op-desk-tabs" });

		const frontBtn = tabs.createEl("button", {
			cls: `op-desk-tab ${this.activeSectionId === "front-page" ? "is-active" : ""}`.trim(),
			text: t(issue.language, "frontPage"),
		});
		frontBtn.addEventListener("click", () => {
			this.activeSectionId = "front-page";
			this.renderSheet();
		});

		for (const sec of issue.sections) {
			const tabBtn = tabs.createEl("button", {
				cls: `op-desk-tab ${this.activeSectionId === sec.id ? "is-active" : ""}`.trim(),
				text: `${sec.title} (${sec.articles.length})`,
			});
			tabBtn.addEventListener("click", () => {
				this.activeSectionId = sec.id;
				this.renderSheet();
			});
		}

		const rightTools = nav.createDiv({ cls: "op-filter-pills" });
		const unreadCount = allArticles.filter(
			(a) => !this.plugin.readingSync.isRead(a.articleKey)
		).length;
		const readingCount = allArticles.filter(
			(a) => this.plugin.readingSync.getEntry(a.articleKey)?.status === "reading"
		).length;

		const filterChoices: Array<[ReadFilterMode, string]> = [
			["all", t(issue.language, "filterAll", { count: allArticles.length })],
			["unread", t(issue.language, "filterUnread", { count: unreadCount })],
			["reading", t(issue.language, "filterReading", { count: readingCount })],
		];

		for (const [mode, label] of filterChoices) {
			const pill = rightTools.createEl("button", {
				cls: `op-filter-pill ${this.readFilter === mode ? "is-active" : ""}`.trim(),
				text: label,
			});
			pill.addEventListener("click", () => {
				this.readFilter = mode;
				this.renderSheet();
			});
		}

		if (unreadCount > 0) {
			const markAllBtn = rightTools.createEl("button", {
				cls: "op-mini-action",
				text: "✓",
				attr: { title: t(issue.language, "markAllRead") },
			});
			markAllBtn.addEventListener("click", () => {
				const targetPool =
					this.activeSectionId === "front-page"
						? allArticles
						: issue.sections.find((s) => s.id === this.activeSectionId)?.articles ?? [];
				this.plugin.readingSync.markBatchRead(targetPool, paper.id);
				this.renderSheet();
			});
		}
	}

	private renderContinueReadingStrip(
		container: HTMLElement,
		issue: EditionIssue,
		allArticles: PressArticle[]
	): void {
		const byKey = new Map<string, PressArticle>();
		for (const a of allArticles) byKey.set(a.articleKey, a);

		const stateMap = this.plugin.settings.readingState ?? {};
		const candidates: Array<{ article: PressArticle; progress: number; updatedAt: number }> = [];

		for (const entry of Object.values(stateMap)) {
			if (!entry || entry.status !== "reading" || entry.progress <= 0.03) continue;
			const localArt = byKey.get(entry.articleKey);
			if (localArt) {
				candidates.push({
					article: localArt,
					progress: entry.progress,
					updatedAt: entry.updatedAt,
				});
			} else if (entry.title && entry.url) {
				// Synced in-progress story from another device / earlier edition: synthesize stub for seamless full-text resume!
				candidates.push({
					article: {
						articleKey: entry.articleKey,
						id: entry.articleKey,
						feedId: "synced",
						feedTitle: entry.feedTitle || t(issue.language, "continueReading"),
						sectionId: "correspondence",
						sectionTitle: t(issue.language, "correspondence"),
						title: entry.title,
						url: entry.url,
						publishedAt: entry.updatedAt,
						excerpt: "",
						contentHtml: "",
						plainText: "",
						readingMinutes: 4,
						wordCount: 800,
						matchedTopics: [],
						score: 1,
					},
					progress: entry.progress,
					updatedAt: entry.updatedAt,
				});
			}
		}

		const inProgress = candidates
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.slice(0, 3);

		if (inProgress.length === 0) return;

		const strip = container.createDiv({ cls: "op-continue-strip" });
		strip.createDiv({
			cls: "op-continue-header",
			text: t(issue.language, "continueReading"),
		});

		const grid = strip.createDiv({ cls: "op-continue-items" });
		for (const { article, progress } of inProgress) {
			const pct = Math.max(1, Math.min(99, Math.round(progress * 100)));
			const card = grid.createDiv({ cls: "op-continue-card" });
			card.addEventListener("click", () => this.openStoryInReader(article));

			card.createDiv({ cls: "op-continue-card-title", text: article.title });
			const meta = card.createDiv({ cls: "op-continue-card-meta" });
			meta.createSpan({ text: article.feedTitle });
			meta.createSpan({ text: t(issue.language, "resumeAt", { pct }) });

			const track = card.createDiv({ cls: "op-progress-track" });
			const fill = track.createDiv({ cls: "op-progress-fill" });
			fill.style.width = `${pct}%`;
		}
	}

	private renderNewspaperFrontPage(
		container: HTMLElement,
		paper: PaperConfig,
		issue: EditionIssue
	): void {
		const palette = getEditionPalette("newspaper", issue.editionUsed, issue.magazineStyleUsed);
		const dotSpacing = this.plugin.settings.halftoneDotSize;

		const leadCandidate =
			issue.leadStory && this.matchesReadFilter(issue.leadStory) ? issue.leadStory : null;
		const secondaryFiltered = issue.secondaryLeads.filter((a) => this.matchesReadFilter(a));
		const belowFoldFiltered = issue.belowFoldStories.filter((a) => this.matchesReadFilter(a));

		// Above the Fold
		if (leadCandidate || secondaryFiltered.length > 0) {
			const aboveFold = container.createDiv({ cls: "op-above-fold" });
			const leadCol = aboveFold.createDiv({ cls: "op-lead-column" });
			const secCol = aboveFold.createDiv({ cls: "op-secondary-column" });

			const mainStory = leadCandidate ?? secondaryFiltered.shift()!;
			if (mainStory) {
				const entry = this.plugin.readingSync.getEntry(mainStory.articleKey);
				const isRead = entry?.status === "read";
				const leadEl = leadCol.createDiv({
					cls: `op-lead-story ${isRead ? "is-read" : ""}`.trim(),
				});
				leadEl.addEventListener("click", () => this.openStoryInReader(mainStory));

				this.renderKickerRow(leadEl, mainStory, issue.language);
				leadEl.createEl("h2", { cls: "op-lead-headline", text: mainStory.title });

				if (mainStory.imageUrl && paper.imageStyle !== "none") {
					mountPressImageElement(leadEl, {
						url: mainStory.imageUrl,
						alt: mainStory.title,
						caption: mainStory.imageCaption,
						style: paper.imageStyle,
						palette,
						dotSpacing,
						maxWidth: 840,
					});
				}

				leadEl.createDiv({ cls: "op-lead-deck", text: mainStory.excerpt });
				this.renderCardFooter(leadEl, mainStory, paper, issue);
			}

			for (const secStory of secondaryFiltered) {
				this.renderStoryCard(secCol, secStory, paper, issue, palette, true);
			}
		}

		// Below the Fold
		if (belowFoldFiltered.length > 0) {
			container.createDiv({
				cls: "op-fold-label",
				text: t(issue.language, "belowTheFold"),
			});
			const colsGrid = container.createDiv({ cls: "op-columns-grid" });
			for (const story of belowFoldFiltered) {
				this.renderStoryCard(colsGrid, story, paper, issue, palette, false);
			}
		}

		// Distinct Sections (Desks + Tracked Topics + Correspondence)
		const frontKeys = new Set<string>();
		if (issue.leadStory) frontKeys.add(issue.leadStory.articleKey);
		issue.secondaryLeads.forEach((s) => frontKeys.add(s.articleKey));
		issue.belowFoldStories.forEach((s) => frontKeys.add(s.articleKey));

		let renderedAnyContent = Boolean(leadCandidate || secondaryFiltered.length || belowFoldFiltered.length);

		for (const section of issue.sections) {
			// Prefer stories not already printed on the front page unless it's Tracked Topics or small desk
			const deduped = section.isTrackedTopicSection
				? section.articles
				: section.articles.filter((a) => !frontKeys.has(a.articleKey));
			const pool = (deduped.length > 0 ? deduped : section.articles).filter((a) =>
				this.matchesReadFilter(a)
			);
			if (pool.length === 0) continue;

			renderedAnyContent = true;
			const secBlock = container.createDiv({ cls: "op-section-block" });
			const secHeader = secBlock.createDiv({ cls: "op-section-header" });
			secHeader.createEl("h2", { cls: "op-section-title", text: section.title });

			const moreBtn = secHeader.createEl("button", {
				cls: "op-mini-action",
				text: `${t(issue.language, "continuedIn", { section: section.title })} →`,
			});
			moreBtn.addEventListener("click", () => {
				this.activeSectionId = section.id;
				this.rootEl.scrollTop = 0;
				this.renderSheet();
			});

			const grid = secBlock.createDiv({ cls: "op-columns-grid" });
			for (const story of pool.slice(0, 6)) {
				this.renderStoryCard(grid, story, paper, issue, palette, true);
			}
		}

		if (!renderedAnyContent) {
			container.createDiv({
				cls: "op-empty-press",
				text: t(issue.language, "noUnreadArticles"),
			});
		}
	}

	private renderSingleSectionPage(
		container: HTMLElement,
		paper: PaperConfig,
		issue: EditionIssue,
		sectionTitle: string,
		articles: PressArticle[]
	): void {
		const palette = getEditionPalette("newspaper", issue.editionUsed, issue.magazineStyleUsed);
		const secBlock = container.createDiv({ cls: "op-section-block" });
		secBlock.style.borderTop = "none";
		secBlock.style.marginTop = "4px";

		const header = secBlock.createDiv({ cls: "op-section-header" });
		header.createEl("h2", { cls: "op-section-title", text: sectionTitle });

		const grid = secBlock.createDiv({ cls: "op-columns-grid" });
		for (const article of articles) {
			this.renderStoryCard(grid, article, paper, issue, palette, true);
		}
	}

	private renderStoryCard(
		parent: HTMLElement,
		article: PressArticle,
		paper: PaperConfig,
		issue: EditionIssue,
		palette: ReturnType<typeof getEditionPalette>,
		allowImage: boolean
	): void {
		const entry = this.plugin.readingSync.getEntry(article.articleKey);
		const isRead = entry?.status === "read";
		const card = parent.createDiv({
			cls: `op-story-card ${isRead ? "is-read" : ""}`.trim(),
		});
		card.addEventListener("click", () => this.openStoryInReader(article));

		if (allowImage && article.imageUrl && paper.imageStyle !== "none") {
			mountPressImageElement(card, {
				url: article.imageUrl,
				alt: article.title,
				caption: article.imageCaption,
				style: paper.imageStyle,
				palette,
				dotSpacing: this.plugin.settings.halftoneDotSize,
				maxWidth: 520,
			});
		}

		this.renderKickerRow(card, article, issue.language);
		card.createEl("h3", { cls: "op-story-headline", text: article.title });
		card.createEl("p", { cls: "op-story-excerpt", text: article.excerpt });

		if (entry?.status === "reading" && entry.progress > 0.03) {
			const track = card.createDiv({ cls: "op-progress-track" });
			const fill = track.createDiv({ cls: "op-progress-fill" });
			fill.style.width = `${Math.round(entry.progress * 100)}%`;
		}

		this.renderCardFooter(card, article, paper, issue);
	}

	private renderKickerRow(
		parent: HTMLElement,
		article: PressArticle,
		lang: EditionIssue["language"]
	): void {
		const kicker = parent.createDiv({ cls: "op-kicker-row" });
		kicker.createSpan({ cls: "op-kicker-source", text: article.feedTitle });

		const entry = this.plugin.readingSync.getEntry(article.articleKey);
		if (entry?.status === "reading" && entry.progress > 0.03) {
			kicker.createSpan({
				cls: "op-status-badge",
				text: `${Math.round(entry.progress * 100)}%`,
			});
		} else if (entry?.status === "read") {
			kicker.createSpan({
				cls: "op-status-badge",
				text: `✓ ${t(lang, "readBadge")}`,
			});
		}

		for (const topic of article.matchedTopics.slice(0, 2)) {
			kicker.createSpan({ cls: "op-topic-pill", text: topic });
		}
	}

	private renderCardFooter(
		parent: HTMLElement,
		article: PressArticle,
		paper: PaperConfig,
		issue: EditionIssue
	): void {
		const footer = parent.createDiv({ cls: "op-story-footer" });
		footer.createSpan({
			text: `${formatShortDate(article.publishedAt, issue.language)} · ${t(
				issue.language,
				"minutesRead",
				{ min: article.readingMinutes }
			)}`,
		});

		const actions = footer.createDiv({ cls: "op-story-actions" });
		const isRead = this.plugin.readingSync.isRead(article.articleKey);
		const readBtn = actions.createEl("button", {
			cls: "op-mini-action",
			text: isRead ? "✓" : "○",
			attr: {
				title: isRead ? t(issue.language, "markUnread") : t(issue.language, "markRead"),
			},
		});
		readBtn.addEventListener("click", (ev) => {
			ev.stopPropagation();
			this.toggleArticleRead(article, paper.id);
		});

		const clip = this.plugin.settings.clips[article.articleKey];
		const clipBtn = actions.createEl("button", {
			cls: `op-mini-action ${clip ? "is-clipped" : ""}`.trim(),
			text: clip ? "✂ Clipped" : "✂ Clip",
		});
		clipBtn.addEventListener("click", (ev) => {
			ev.stopPropagation();
			if (clip) {
				this.openVaultNote(clip.notePath);
			} else {
				void this.clipStoryWithNotice(article, issue.language);
			}
		});
	}

	private toggleArticleRead(article: PressArticle, paperId: string): void {
		const nextRead = !this.plugin.readingSync.isRead(article.articleKey);
		this.plugin.readingSync.setReadStatus(article, paperId, nextRead);
		const prevScroll = this.rootEl.scrollTop;
		this.renderSheet();
		this.rootEl.scrollTop = prevScroll;
	}

	private async clipStory(
		article: PressArticle,
		selectedQuote?: string,
		fullHtmlOverride?: string
	): Promise<ClipRecord> {
		const existing = this.plugin.settings.clips[article.articleKey];
		const record = await saveArticleClipToVault({
			app: this.app,
			folder: this.plugin.settings.clippingsFolder,
			article,
			existingClip: existing,
			selectedQuote,
			fullHtmlOverride,
		});
		this.plugin.settings.clips[article.articleKey] = record;
		await this.plugin.saveSettings();
		this.plugin.readingSync.scheduleFlush(200);
		return record;
	}

	private async clipStoryWithNotice(
		article: PressArticle,
		lang: EditionIssue["language"]
	): Promise<void> {
		const rec = await this.clipStory(article);
		new Notice(t(lang, "clippedToast", { path: rec.notePath }));
		const prevScroll = this.rootEl.scrollTop;
		this.renderSheet();
		this.rootEl.scrollTop = prevScroll;
	}

	private openVaultNote(notePath: string): void {
		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (file instanceof TFile) {
			void this.app.workspace.getLeaf("tab").openFile(file);
		} else {
			const lang = resolvePaperLanguage(
				this.plugin.getActivePaper(),
				this.plugin.settings.uiLanguage
			);
			new Notice(t(lang, "noteNotFound", { path: notePath }));
		}
	}

	public openManageModal(tab?: "appearance" | "sources" | "starter" | "filters"): void {
		const modal = new ManagePaperModal(
			this.app,
			{
				getUiLanguage: () => this.plugin.settings.uiLanguage,
				getPapers: () => this.plugin.settings.papers,
				getActivePaper: () => this.plugin.getActivePaper(),
				savePapersAndRefresh: async (papers, activeId, recompile, deletedPaperId) => {
					await this.plugin.savePapersFromModal(
						papers,
						activeId,
						recompile,
						deletedPaperId
					);
				},
			},
			tab
		);
		modal.open();
	}

	private printCurrentEdition(): void {
		if (!this.sheetEl) return;
		this.printHtmlInCleanFrame(
			this.plugin.getActivePaper().title,
			`<div class="${this.rootEl.className}" style="height:auto;overflow:visible;"><div class="op-sheet">${this.sheetEl.innerHTML}</div></div>`
		);
	}

	private printSingleArticle(article: PressArticle, bodyHtml: string): void {
		const paper = this.plugin.getActivePaper();
		const html = `
			<div class="${this.rootEl.className}" style="height:auto;overflow:visible;padding:24px;">
				<div class="op-reader-wrap">
					<div class="op-kicker-row">${article.feedTitle} · ${formatMastheadDate(article.publishedAt, paper.language)}</div>
					<h1 class="op-reader-headline">${article.title}</h1>
					${article.author ? `<p><em>${article.author}</em></p>` : ""}
					<div class="op-reader-body">${bodyHtml}</div>
				</div>
			</div>
		`;
		this.printHtmlInCleanFrame(article.title, html);
	}

	private printHtmlInCleanFrame(docTitle: string, bodyMarkup: string): void {
		const iframe = document.createElement("iframe");
		iframe.style.position = "fixed";
		iframe.style.right = "0";
		iframe.style.bottom = "0";
		iframe.style.width = "0";
		iframe.style.height = "0";
		iframe.style.border = "0";
		document.body.appendChild(iframe);

		const win = iframe.contentWindow;
		const doc = win?.document;
		if (!win || !doc) {
			iframe.remove();
			return;
		}

		// Copy plugin stylesheet into isolated print document so Obsidian's dark UI never interferes
		let cssText = "";
		for (const sheet of Array.from(document.styleSheets)) {
			try {
				for (const rule of Array.from(sheet.cssRules)) {
					if (rule.cssText.includes("op-") || rule.cssText.includes("obsidian-press")) {
						cssText += `${rule.cssText}\n`;
					}
				}
			} catch {
				// Ignore cross-origin sheets
			}
		}

		doc.open();
		doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${docTitle}</title>
			<link rel="stylesheet" href="${GOOGLE_FONTS_HREF}">
			<style>
				body { margin: 0; background: #fff; color: #000; }
				${cssText}
				.op-utility-bar, .op-desk-nav, .op-reader-sticky-bar, .op-story-actions, .op-continue-strip { display: none !important; }
			</style>
		</head><body>${bodyMarkup}</body></html>`);
		doc.close();

		window.setTimeout(() => {
			win.focus();
			win.print();
			window.setTimeout(() => iframe.remove(), 2000);
		}, 450);
	}
}
