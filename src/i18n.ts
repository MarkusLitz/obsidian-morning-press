import { PaperLanguage } from "./types";

const STRINGS = {
	de: {
		frontPage: "Titelseite",
		allSections: "Titelseite",
		correspondence: "Korrespondenz",
		trackedTopics: "Beobachtete Themen",
		volume: "Jahrgang {vol}",
		issueNo: "Nr. {no}",
		printFresh: "Frische Ausgabe drucken",
		printingEdition: "Druckerpresse läuft…",
		backIssues: "Ausgaben-Archiv (14 Tage)",
		todayIssue: "Heutige Ausgabe",
		clippingsRack: "Clippings",
		managePaper: "Redaktion & Quellen",
		printPdf: "Drucken",
		filterAll: "Alle ({count})",
		filterUnread: "Ungelesen ({count})",
		filterReading: "Weiterlesen ({count})",
		continueReading: "Weiterlesen",
		resumeAt: "Weiterlesen bei {pct} %",
		progressBadge: "{pct} % gelesen",
		readBadge: "Gelesen",
		markRead: "Als gelesen markieren",
		markUnread: "Als ungelesen markieren",
		markAllRead: "Ausgabe als gelesen markieren",
		clipArticle: "Artikel clippen",
		clipSelection: "Markierung clippen",
		clippedOpen: "Clipping öffnen",
		clippedToast: "In „{path}“ gespeichert.",
		loadFullText: "Volltext laden",
		loadingFullText: "Lade Volltext…",
		showingFullText: "Volltext aktiv",
		showingFeedSummary: "Feed-Vorschau",
		blockedFullTextTitle: "Direkter Volltext-Abruf vom Verlag blockiert (HTTP {status})",
		blockedFullTextDesc:
			"Diese Publikation (z. B. Consent-/Pur-Schranke oder Bot-Schutz) lässt keinen automatischen Hintergrund-Abruf zu. Du kannst den Artikel direkt hier in der sichtbaren Web-Ansicht oder im Browser lesen.",
		openEmbeddedWeb: "Hier in Web-Ansicht öffnen",
		closeEmbeddedWeb: "Web-Ansicht schließen",
		openOriginal: "Original öffnen",
		backToPaper: "Zurück zur Ausgabe",
		minutesRead: "{min} Min. Lesezeit",
		aboveTheFold: "Aufmacher",
		belowTheFold: "Unter dem Falz",
		continuedIn: "Mehr in {section}",
		emptyPressTitle: "Die Druckerpresse steht bereit",
		emptyPressLead:
			"Nichts ist für dich vorausgewählt. Wähle Publikationen aus dem Starter-Katalog, importiere eine OPML-Datei oder füge beliebige Websites & RSS-Feeds hinzu.",
		setupSourcesBtn: "Quellen & Rubriken auswählen",
		noArticlesInIssue:
			"Für den gewählten Zeitraum wurden keine Artikel in den abonnierten Quellen gefunden.",
		noUnreadArticles: "Alle Artikel dieser Ansicht sind bereits gelesen.",
		editionLabel: "Edition",
		formatNewspaper: "Zeitung",
		formatMagazine: "Magazin",
		imagesHalftone: "Halftone-Raster",
		imagesColorInk: "Zeitungsfarbe",
		imagesColor: "Originalfarbe",
		imagesNone: "Nur Text",
		readProgressSummary: "{read} von {total} gelesen",
		feedErrorsNotice: "{count} Quelle(n) nicht erreichbar",
		byAuthor: "Von {author}",
		publishedAt: "Veröffentlicht am {date}",
		archiveEmpty: "Noch keine vergangenen Ausgaben im 14-Tage-Archiv.",
		clippingsEmpty: "Noch keine Artikel geclippt.",
		sundayMagazineBadge: "Magazin-Ausgabe",
		noteNotFound: "Notiz nicht gefunden: {path}",
		noFeedFoundAt: "Kein RSS/Atom/JSON-Feed unter {url} gefunden.",
	},
	en: {
		frontPage: "Front Page",
		allSections: "Front Page",
		correspondence: "Correspondence",
		trackedTopics: "Tracked Topics",
		volume: "Vol. {vol}",
		issueNo: "No. {no}",
		printFresh: "Print a fresh edition",
		printingEdition: "Running the press…",
		backIssues: "Back Issues (Fortnight)",
		todayIssue: "Today’s Paper",
		clippingsRack: "Clippings",
		managePaper: "Manage Paper & Sources",
		printPdf: "Print",
		filterAll: "All ({count})",
		filterUnread: "Unread ({count})",
		filterReading: "Reading ({count})",
		continueReading: "Continue Reading",
		resumeAt: "Resume at {pct}%",
		progressBadge: "{pct}% read",
		readBadge: "Read",
		markRead: "Mark as read",
		markUnread: "Mark as unread",
		markAllRead: "Mark issue as read",
		clipArticle: "Clip story",
		clipSelection: "Clip selection",
		clippedOpen: "Open clipping",
		clippedToast: "Saved clipping to “{path}”.",
		loadFullText: "Fetch full article",
		loadingFullText: "Fetching full text…",
		showingFullText: "Full text loaded",
		showingFeedSummary: "Feed summary",
		blockedFullTextTitle: "Direct full-text fetch blocked by publisher (HTTP {status})",
		blockedFullTextDesc:
			"This publication blocks automated background extraction (e.g. consent gate, paywall, or bot protection). You can read the page directly in the visible embedded web view or in your browser.",
		openEmbeddedWeb: "Open in embedded web view",
		closeEmbeddedWeb: "Close web view",
		openOriginal: "Open original",
		backToPaper: "Back to paper",
		minutesRead: "{min} min read",
		aboveTheFold: "Above the Fold",
		belowTheFold: "Below the Fold",
		continuedIn: "More in {section}",
		emptyPressTitle: "Your device is the press",
		emptyPressLead:
			"Nothing is pre-selected for you. Choose publications from the starter desks, import an OPML directory, or paste any site or RSS/Atom address.",
		setupSourcesBtn: "Choose Publications & Desks",
		noArticlesInIssue:
			"No stories were found in your configured feeds within the current lookback window.",
		noUnreadArticles: "You’ve read every story in this view.",
		editionLabel: "Edition",
		formatNewspaper: "Newspaper",
		formatMagazine: "Magazine",
		imagesHalftone: "Halftone",
		imagesColorInk: "Color Ink",
		imagesColor: "Full Color",
		imagesNone: "No Pictures",
		readProgressSummary: "{read} of {total} read",
		feedErrorsNotice: "{count} source(s) unreachable",
		byAuthor: "By {author}",
		publishedAt: "Published {date}",
		archiveEmpty: "No back issues on the fortnight rack yet.",
		clippingsEmpty: "No clipped stories yet.",
		sundayMagazineBadge: "Magazine Issue",
		noteNotFound: "Note not found: {path}",
		noFeedFoundAt: "No RSS/Atom/JSON feed found at {url}.",
	},
} as const;

export type I18nKey = keyof typeof STRINGS.en;

export function t(
	lang: PaperLanguage,
	key: I18nKey,
	vars?: Record<string, string | number>
): string {
	const table = STRINGS[lang] ?? STRINGS.en;
	let out: string = table[key] ?? STRINGS.en[key] ?? key;
	if (vars) {
		for (const [k, v] of Object.entries(vars)) {
			out = out.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
		}
	}
	return out;
}

export function formatMastheadDate(timestamp: number, lang: PaperLanguage): string {
	const d = new Date(timestamp);
	const locale = lang === "de" ? "de-DE" : "en-US";
	return d.toLocaleDateString(locale, {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

export function formatShortDate(timestamp: number, lang: PaperLanguage): string {
	const d = new Date(timestamp);
	const locale = lang === "de" ? "de-DE" : "en-US";
	return d.toLocaleDateString(locale, {
		weekday: "short",
		month: "short",
		day: "numeric",
	});
}

export function toDateKey(date = new Date()): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}
