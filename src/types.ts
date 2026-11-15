export type PaperLanguage = "de" | "en";

export type NewspaperEdition = "biblio" | "digital" | "dystopian";

export type MagazineStyle = "bicycle" | "signal" | "plate-light" | "plate-dark";

export type PaperFormatMode = "newspaper" | "magazine";

export type ImageRenderStyle = "halftone" | "color-ink" | "color" | "none";

export type TypeScale = "compact" | "standard" | "comfortable" | "large";

export type SheetMode = "auto" | "broadsheet" | "folded";

export type ReadFilterMode = "all" | "unread" | "reading";

export type ReadingStatus = "unread" | "reading" | "read";

export interface DeskSection {
	id: string;
	title: string;
	order: number;
	updatedAt?: number;
}

export interface FeedSource {
	id: string;
	title: string;
	url: string;
	siteUrl?: string;
	sectionId: string; // "correspondence" when not assigned to a custom desk
	enabled: boolean;
	addedAt: number;
	updatedAt?: number;
	lastFetchedAt?: number;
	lastError?: string;
}

export interface PaperConfig {
	id: string;
	title: string;
	subtitle: string;
	motto: string;
	language: PaperLanguage;
	/** Optional per-paper language override; when omitted, follows global `settings.uiLanguage` */
	languageOverride?: PaperLanguage;
	edition: NewspaperEdition;
	formatMode: PaperFormatMode;
	magazineStyle: MagazineStyle;
	/** Days of week (0 = Sunday .. 6 = Saturday) that automatically print as a magazine */
	magazineDays: number[];
	imageStyle: ImageRenderStyle;
	typeScale: TypeScale;
	sheetMode: SheetMode;
	sections: DeskSection[];
	feeds: FeedSource[];
	trackedTopics: string[];
	mutedKeywords: string[];
	maxArticlesPerFeed: number;
	lookbackHours: number;
	volumeNumber: number;
	issueCounter: number;
	createdAt: number;
	/** 0 for untouched factory default paper; >0 once customized so populated devices always win over fresh installs */
	updatedAt?: number;
	deletedFeeds?: Record<string, number>;
	deletedSections?: Record<string, number>;
}

export interface PressArticle {
	/** Deterministic cross-device key derived from normalized article URL or GUID */
	articleKey: string;
	id: string;
	feedId: string;
	feedTitle: string;
	sectionId: string;
	sectionTitle: string;
	title: string;
	subtitle?: string;
	author?: string;
	url: string;
	publishedAt: number;
	excerpt: string;
	contentHtml: string;
	plainText: string;
	imageUrl?: string;
	imageCaption?: string;
	readingMinutes: number;
	wordCount: number;
	matchedTopics: string[];
	score: number;
}

export interface CompiledSection {
	id: string;
	title: string;
	isTrackedTopicSection?: boolean;
	isCorrespondence?: boolean;
	articles: PressArticle[];
}

export interface EditionIssue {
	id: string;
	paperId: string;
	paperTitle: string;
	paperSubtitle: string;
	paperMotto: string;
	language: PaperLanguage;
	dateKey: string; // YYYY-MM-DD
	compiledAt: number;
	issueNumber: number;
	volumeNumber: number;
	formatUsed: PaperFormatMode;
	editionUsed: NewspaperEdition;
	magazineStyleUsed: MagazineStyle;
	leadStory: PressArticle | null;
	secondaryLeads: PressArticle[];
	belowFoldStories: PressArticle[];
	sections: CompiledSection[];
	totalArticles: number;
	feedErrors: Array<{ feedTitle: string; error: string }>;
}

export interface ReadingEntry {
	articleKey: string;
	status: ReadingStatus;
	/** 0.0 to 1.0 */
	progress: number;
	paragraphIndex: number;
	title?: string;
	url?: string;
	feedTitle?: string;
	paperId?: string;
	readAt?: number;
	updatedAt: number;
}

export interface ClipRecord {
	articleKey: string;
	title: string;
	url: string;
	feedTitle: string;
	notePath: string;
	clippedAt: number;
	excerptText?: string;
}

export interface ObsidianPressSettings {
	uiLanguage: PaperLanguage;
	activePaperId: string;
	papers: PaperConfig[];
	clippingsFolder: string;
	syncLedgerEnabled: boolean;
	syncLedgerPath: string;
	retentionDays: number;
	fortnightDays: number;
	autoOpenMorning: boolean;
	lastAutoOpenDate: string;
	autoFetchFullText: boolean;
	dimReadArticles: boolean;
	loadGoogleFonts: boolean;
	halftoneDotSize: number;
	readingState: Record<string, ReadingEntry>;
	clips: Record<string, ClipRecord>;
	deletedPapers?: Record<string, number>;
}

export const VIEW_TYPE_PRESS = "obsidian-press-view";

export const CORRESPONDENCE_SECTION_ID = "correspondence";
export const TRACKED_TOPICS_SECTION_ID = "tracked-topics";

const FACTORY_LABEL_PAIRS: Array<[en: string, de: string]> = [
	["Morning Edition", "Morgenausgabe"],
	["Weekend Edition", "Sonderausgabe"],
	["Weekend Review", "Wochenend-Journal"],
	["Your device is the press", "Dein Gerät ist die Druckerpresse"],
	["Dispatches", "Nachrichten & Welt"],
	["Ideas", "Ideen & Essays"],
	["Technology & Science", "Technologie & Wissen"],
	["Design & Culture", "Design & Kultur"],
	["Correspondence", "Korrespondenz"],
	["Tracked Topics", "Beobachtete Themen"],
];

export function localizeDefaultLabel(text: string, lang: PaperLanguage): string {
	for (const [en, de] of FACTORY_LABEL_PAIRS) {
		if (text === en || text === de) {
			return lang === "de" ? de : en;
		}
	}
	return text;
}

export function resolvePaperLanguage(
	paper: Pick<PaperConfig, "language" | "languageOverride">,
	uiLanguage: PaperLanguage = "en"
): PaperLanguage {
	if (paper.languageOverride === "de" || paper.languageOverride === "en") {
		return paper.languageOverride;
	}
	return uiLanguage === "de" ? "de" : "en";
}

export function createDefaultPaper(language: PaperLanguage = "en"): PaperConfig {
	const isDe = language === "de";
	return {
		id: "morning-edition",
		title: "The Obsidian Times",
		subtitle: isDe ? "Morgenausgabe" : "Morning Edition",
		motto: isDe ? "Dein Gerät ist die Druckerpresse" : "Your device is the press",
		language,
		edition: "biblio",
		formatMode: "newspaper",
		magazineStyle: "bicycle",
		magazineDays: [0], // Sunday magazine by default
		imageStyle: "halftone",
		typeScale: "standard",
		sheetMode: "auto",
		sections: [
			{ id: "dispatches", title: isDe ? "Nachrichten & Welt" : "Dispatches", order: 0 },
			{ id: "ideas", title: isDe ? "Ideen & Essays" : "Ideas", order: 1 },
			{ id: "technology", title: isDe ? "Technologie & Wissen" : "Technology & Science", order: 2 },
			{ id: "design", title: isDe ? "Design & Kultur" : "Design & Culture", order: 3 },
		],
		// True to biblio.ink/times: nothing is pre-selected without user consent!
		feeds: [],
		trackedTopics: [],
		mutedKeywords: [],
		maxArticlesPerFeed: 12,
		lookbackHours: 72,
		volumeNumber: 1,
		issueCounter: 0,
		createdAt: Date.now(),
		updatedAt: 0,
		deletedFeeds: {},
		deletedSections: {},
	};
}

export const DEFAULT_SETTINGS: ObsidianPressSettings = {
	uiLanguage: "en",
	activePaperId: "morning-edition",
	papers: [createDefaultPaper("en")],
	clippingsFolder: "Clippings",
	syncLedgerEnabled: true,
	syncLedgerPath: "obsidian-press-sync.md",
	retentionDays: 60,
	fortnightDays: 14,
	autoOpenMorning: false,
	lastAutoOpenDate: "",
	autoFetchFullText: true,
	dimReadArticles: true,
	loadGoogleFonts: true,
	halftoneDotSize: 3.4,
	readingState: {},
	clips: {},
	deletedPapers: {},
};
