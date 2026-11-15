import { App, TAbstractFile, TFile, normalizePath } from "obsidian";
import {
	ClipRecord,
	DeskSection,
	FeedSource,
	PaperConfig,
	PressArticle,
	ReadingEntry,
	ReadingStatus,
} from "../types";

const LEDGER_HEADER = [
	"# Obsidian Press — Cross-Device Sync",
	"",
	"> Automatically managed cross-device sync ledger for subscribed sources, desks, clippings, reading progress & read state (Obsidian Sync compatible).",
	"",
].join("\n");

const READING_PREFIX = "- ";
const PAPER_PREFIX = "@paper ";
const FEED_PREFIX = "@feed ";
const DEL_PAPER_PREFIX = "@del-paper ";
const CLIP_PREFIX = "@clip ";

export function normalizeFeedKey(url: string): string {
	return (url || "")
		.trim()
		.toLowerCase()
		.replace(/^http:\/\//, "https://")
		.replace(/\/+$/, "");
}

function effectivePaperUpdatedAt(paper: PaperConfig): number {
	if (typeof paper.updatedAt === "number") return paper.updatedAt;
	return paper.feeds && paper.feeds.length > 0 ? paper.createdAt || 1 : 0;
}

/**
 * Conflict-free per-article merge (LWW-Element-Set with tie-breaking):
 * Newer `updatedAt` always wins; if equal timestamps occur, higher progress/read status wins.
 */
export function mergeReadingEntries(a: ReadingEntry, b: ReadingEntry): ReadingEntry {
	if (a.updatedAt !== b.updatedAt) {
		return a.updatedAt > b.updatedAt ? { ...a } : { ...b };
	}
	const rank = (s: ReadingStatus) => (s === "read" ? 2 : s === "reading" ? 1 : 0);
	if (rank(b.status) > rank(a.status)) return { ...b };
	if (rank(a.status) > rank(b.status)) return { ...a };
	return b.progress >= a.progress ? { ...b } : { ...a };
}

/**
 * Merges two dictionaries of ReadingEntry items without ever losing read/progress state
 * from another device, and prunes entries older than `retentionDays`.
 */
export function mergeReadingStateMaps(
	base: Record<string, ReadingEntry>,
	incoming: Record<string, ReadingEntry>,
	retentionDays = 60,
	now = Date.now()
): { merged: Record<string, ReadingEntry>; changed: boolean } {
	const cutoff = retentionDays > 0 ? now - retentionDays * 86400 * 1000 : 0;
	const merged: Record<string, ReadingEntry> = {};
	let changed = false;

	const allKeys = new Set<string>([...Object.keys(base), ...Object.keys(incoming)]);
	for (const key of allKeys) {
		if (!key) continue;
		const left = base[key];
		const right = incoming[key];
		const winner = left && right ? mergeReadingEntries(left, right) : { ...(left ?? right)! };

		if (cutoff > 0 && winner.updatedAt < cutoff) {
			if (left) changed = true;
			continue;
		}
		merged[key] = winner;
		if (
			!left ||
			left.updatedAt !== winner.updatedAt ||
			left.status !== winner.status ||
			Math.abs(left.progress - winner.progress) > 0.001 ||
			left.paragraphIndex !== winner.paragraphIndex
		) {
			changed = true;
		}
	}

	if (Object.keys(base).length !== Object.keys(merged).length) {
		changed = true;
	}
	return { merged, changed };
}

function mergeTombstoneMaps(
	a: Record<string, number> | undefined,
	b: Record<string, number> | undefined,
	cutoff: number
): Record<string, number> {
	const out: Record<string, number> = {};
	for (const src of [a, b]) {
		if (!src) continue;
		for (const [k, ts] of Object.entries(src)) {
			if (!k || typeof ts !== "number" || (cutoff > 0 && ts < cutoff)) continue;
			out[k] = Math.max(out[k] ?? 0, ts);
		}
	}
	return out;
}

export function mergeClipsMaps(
	base: Record<string, ClipRecord>,
	incoming: Record<string, ClipRecord>
): { merged: Record<string, ClipRecord>; changed: boolean } {
	const merged: Record<string, ClipRecord> = { ...base };
	let changed = false;
	for (const [key, inc] of Object.entries(incoming)) {
		if (!key || !inc) continue;
		const existing = merged[key];
		if (!existing || (inc.clippedAt ?? 0) > (existing.clippedAt ?? 0)) {
			merged[key] = { ...inc };
			changed = true;
		}
	}
	return { merged, changed };
}

/**
 * Conflict-free LWW + Tombstone merge for Paper configurations, Desks, and Subscribed Feeds!
 * Guarantees that:
 * - A fresh second device (updatedAt === 0) NEVER overwrites a configured paper on Device A.
 * - Feeds added concurrently on Desktop and Mobile BOTH survive.
 * - Feeds or papers deleted on one device are cleanly removed on other devices via tombstones.
 */
export function mergePaperCollections(params: {
	localPapers: PaperConfig[];
	incomingPapers: PaperConfig[];
	localDeletedPapers?: Record<string, number>;
	incomingDeletedPapers?: Record<string, number>;
	retentionDays?: number;
	now?: number;
}): {
	papers: PaperConfig[];
	deletedPapers: Record<string, number>;
	changed: boolean;
	feedsChanged: boolean;
} {
	const {
		localPapers,
		incomingPapers,
		localDeletedPapers,
		incomingDeletedPapers,
		retentionDays = 60,
		now = Date.now(),
	} = params;

	const cutoff = retentionDays > 0 ? now - retentionDays * 86400 * 1000 : 0;
	const deletedPapers = mergeTombstoneMaps(localDeletedPapers, incomingDeletedPapers, cutoff);

	const localById = new Map(localPapers.map((p) => [p.id, p]));
	const incomingById = new Map(incomingPapers.map((p) => [p.id, p]));
	const orderedIds: string[] = [];
	for (const p of localPapers) if (!orderedIds.includes(p.id)) orderedIds.push(p.id);
	for (const p of incomingPapers) if (!orderedIds.includes(p.id)) orderedIds.push(p.id);

	const mergedPapers: PaperConfig[] = [];

	for (const paperId of orderedIds) {
		const loc = localById.get(paperId);
		const inc = incomingById.get(paperId);
		const locUpd = loc ? effectivePaperUpdatedAt(loc) : -1;
		const incUpd = inc ? effectivePaperUpdatedAt(inc) : -1;
		const maxUpd = Math.max(locUpd, incUpd);

		const delTs = deletedPapers[paperId] ?? 0;
		if (delTs > 0 && delTs >= maxUpd) {
			continue;
		}

		if (loc && !inc) {
			mergedPapers.push(loc);
			continue;
		}
		if (!loc && inc) {
			mergedPapers.push(inc);
			continue;
		}

		// Both devices have `paperId`: pick newer scalar settings + merge sections & feeds per-item!
		const winnerMeta = incUpd > locUpd ? inc! : loc!;
		const deletedSections = mergeTombstoneMaps(loc!.deletedSections, inc!.deletedSections, cutoff);
		const deletedFeeds = mergeTombstoneMaps(loc!.deletedFeeds, inc!.deletedFeeds, cutoff);

		// Merge Desks / Sections
		const secMap = new Map<string, DeskSection>();
		for (const s of loc!.sections) {
			secMap.set(s.id, { ...s, updatedAt: s.updatedAt ?? locUpd });
		}
		for (const s of inc!.sections) {
			const incSecUpd = s.updatedAt ?? incUpd;
			const cur = secMap.get(s.id);
			if (!cur || incSecUpd > (cur.updatedAt ?? 0)) {
				secMap.set(s.id, { ...s, updatedAt: incSecUpd });
			}
		}
		const mergedSections = Array.from(secMap.values())
			.filter((s) => {
				const d = deletedSections[s.id] ?? 0;
				return !(d > 0 && d >= (s.updatedAt ?? 0));
			})
			.sort((a, b) => a.order - b.order);

		// Merge Subscribed Feeds keyed by canonical feed URL
		const feedMap = new Map<string, FeedSource>();
		const localTelemetry = new Map<string, { lastFetchedAt?: number; lastError?: string }>();

		for (const f of loc!.feeds) {
			const fKey = normalizeFeedKey(f.url);
			if (!fKey) continue;
			localTelemetry.set(fKey, { lastFetchedAt: f.lastFetchedAt, lastError: f.lastError });
			feedMap.set(fKey, { ...f, updatedAt: f.updatedAt ?? f.addedAt ?? 1 });
		}
		for (const f of inc!.feeds) {
			const fKey = normalizeFeedKey(f.url);
			if (!fKey) continue;
			const incFeedUpd = f.updatedAt ?? f.addedAt ?? 1;
			const cur = feedMap.get(fKey);
			if (!cur || incFeedUpd > (cur.updatedAt ?? cur.addedAt ?? 0)) {
				const telem = localTelemetry.get(fKey);
				feedMap.set(fKey, {
					...f,
					updatedAt: incFeedUpd,
					lastFetchedAt: telem?.lastFetchedAt ?? f.lastFetchedAt,
					lastError: telem?.lastError ?? f.lastError,
				});
			}
		}

		const mergedFeeds = Array.from(feedMap.values()).filter((f) => {
			const fKey = normalizeFeedKey(f.url);
			const d = deletedFeeds[fKey] ?? 0;
			const fUpd = f.updatedAt ?? f.addedAt ?? 0;
			return !(d > 0 && d >= fUpd);
		});

		mergedPapers.push({
			...winnerMeta,
			sections: mergedSections,
			feeds: mergedFeeds,
			issueCounter: Math.max(loc!.issueCounter ?? 0, inc!.issueCounter ?? 0),
			updatedAt: maxUpd,
			deletedSections,
			deletedFeeds,
		});
	}

	const signatureOf = (papers: PaperConfig[], includeMeta: boolean) =>
		JSON.stringify(
			papers.map((p) => ({
				id: p.id,
				...(includeMeta
					? {
							t: p.title,
							st: p.subtitle,
							m: p.motto,
							l: p.language,
							lo: p.languageOverride ?? "",
							ed: p.edition,
							fm: p.formatMode,
							ms: p.magazineStyle,
							md: p.magazineDays,
							im: p.imageStyle,
							ts: p.typeScale,
							sm: p.sheetMode,
							tt: p.trackedTopics,
							mk: p.mutedKeywords,
							u: effectivePaperUpdatedAt(p),
						}
					: {}),
				secs: p.sections.map((s) => `${s.id}:${s.title}:${s.order}`),
				feeds: p.feeds
					.map((f) => `${normalizeFeedKey(f.url)}|${f.sectionId}|${f.enabled ? 1 : 0}|${f.title}`)
					.sort(),
			}))
		);

	const feedsChanged = signatureOf(localPapers, false) !== signatureOf(mergedPapers, false);
	const changed =
		feedsChanged ||
		signatureOf(localPapers, true) !== signatureOf(mergedPapers, true) ||
		JSON.stringify(localDeletedPapers ?? {}) !== JSON.stringify(deletedPapers);

	return {
		papers: mergedPapers,
		deletedPapers,
		changed,
		feedsChanged,
	};
}

export interface FullSyncSnapshot {
	papers: PaperConfig[];
	deletedPapers: Record<string, number>;
	clips: Record<string, ClipRecord>;
	readingState: Record<string, ReadingEntry>;
}

/**
 * Serializes Papers, Feeds, Clips, and Reading Entries into a deterministic, line-oriented Markdown ledger.
 * Each `@paper`, `@feed`, `@clip`, and `- art_...` is a single independent sorted line so Obsidian Sync
 * merges concurrent multi-device offline edits line-by-line with zero JSON syntax conflicts!
 */
export function serializeFullSyncLedger(snapshot: FullSyncSnapshot): string {
	const lines: string[] = [LEDGER_HEADER];

	// 1. Deleted Paper Tombstones
	for (const paperId of Object.keys(snapshot.deletedPapers ?? {}).sort()) {
		lines.push(
			`${DEL_PAPER_PREFIX}${paperId} | ${JSON.stringify({ d: snapshot.deletedPapers[paperId] })}`
		);
	}

	// 2. Papers & their Individual Feeds
	const sortedPapers = [...(snapshot.papers ?? [])].sort((a, b) => a.id.localeCompare(b.id));
	for (const p of sortedPapers) {
		const paperPayload = {
			title: p.title,
			subtitle: p.subtitle,
			motto: p.motto,
			language: p.language,
			...(p.languageOverride ? { languageOverride: p.languageOverride } : {}),
			edition: p.edition,
			formatMode: p.formatMode,
			magazineStyle: p.magazineStyle,
			magazineDays: p.magazineDays,
			imageStyle: p.imageStyle,
			typeScale: p.typeScale,
			sheetMode: p.sheetMode,
			sections: p.sections,
			trackedTopics: p.trackedTopics,
			mutedKeywords: p.mutedKeywords,
			maxArticlesPerFeed: p.maxArticlesPerFeed,
			lookbackHours: p.lookbackHours,
			volumeNumber: p.volumeNumber,
			issueCounter: p.issueCounter,
			createdAt: p.createdAt,
			updatedAt: effectivePaperUpdatedAt(p),
			deletedFeeds: p.deletedFeeds ?? {},
			deletedSections: p.deletedSections ?? {},
		};
		lines.push(`${PAPER_PREFIX}${p.id} | ${JSON.stringify(paperPayload)}`);

		const sortedFeeds = [...p.feeds].sort((a, b) =>
			normalizeFeedKey(a.url).localeCompare(normalizeFeedKey(b.url))
		);
		for (const f of sortedFeeds) {
			const fKey = normalizeFeedKey(f.url);
			if (!fKey) continue;
			const feedPayload = {
				id: f.id,
				title: f.title,
				url: f.url,
				...(f.siteUrl ? { siteUrl: f.siteUrl } : {}),
				sectionId: f.sectionId,
				enabled: f.enabled,
				addedAt: f.addedAt,
				updatedAt: f.updatedAt ?? f.addedAt ?? 1,
			};
			lines.push(`${FEED_PREFIX}${p.id} ${fKey} | ${JSON.stringify(feedPayload)}`);
		}
	}

	// 3. Clipped Articles Index
	for (const clipKey of Object.keys(snapshot.clips ?? {}).sort()) {
		const c = snapshot.clips[clipKey];
		if (!c) continue;
		lines.push(`${CLIP_PREFIX}${clipKey} | ${JSON.stringify(c)}`);
	}

	// 4. Reading State & Paragraph Progress
	for (const key of Object.keys(snapshot.readingState ?? {}).sort()) {
		const entry = snapshot.readingState[key];
		if (!entry || (entry.status === "unread" && entry.progress <= 0.01 && !entry.readAt)) {
			if (!entry || Date.now() - entry.updatedAt > 7 * 86400 * 1000) {
				continue;
			}
		}
		const compact = {
			s: entry.status,
			p: Math.round(entry.progress * 1000) / 1000,
			i: entry.paragraphIndex,
			u: entry.updatedAt,
			...(entry.readAt ? { r: entry.readAt } : {}),
			...(entry.title ? { t: entry.title.slice(0, 120) } : {}),
			...(entry.feedTitle ? { f: entry.feedTitle.slice(0, 60) } : {}),
			...(entry.url ? { l: entry.url } : {}),
			...(entry.paperId ? { m: entry.paperId } : {}),
		};
		lines.push(`${READING_PREFIX}${key} | ${JSON.stringify(compact)}`);
	}

	lines.push("");
	return lines.join("\n");
}

/**
 * Legacy helper kept for direct readingState-only serialization tests.
 */
export function serializeSyncLedger(state: Record<string, ReadingEntry>): string {
	return serializeFullSyncLedger({
		papers: [],
		deletedPapers: {},
		clips: {},
		readingState: state,
	});
}

/**
 * Parses the full line-oriented Markdown sync ledger, resolving any duplicate lines from
 * concurrent Obsidian Sync diff-match-patch merges cleanly!
 */
export function parseFullSyncLedger(markdown: string): FullSyncSnapshot {
	const readingState: Record<string, ReadingEntry> = {};
	const deletedPapers: Record<string, number> = {};
	const clips: Record<string, ClipRecord> = {};
	const paperStubs = new Map<string, PaperConfig>();
	const feedsByPaper = new Map<string, Map<string, FeedSource>>();

	if (!markdown) {
		return { papers: [], deletedPapers, clips, readingState };
	}

	const lines = markdown.split(/\r?\n/);
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) continue;

		if (line.startsWith(DEL_PAPER_PREFIX)) {
			const sep = line.indexOf(" | ");
			if (sep <= DEL_PAPER_PREFIX.length) continue;
			const paperId = line.slice(DEL_PAPER_PREFIX.length, sep).trim();
			try {
				const data = JSON.parse(line.slice(sep + 3)) as { d?: number };
				if (paperId && typeof data.d === "number") {
					deletedPapers[paperId] = Math.max(deletedPapers[paperId] ?? 0, data.d);
				}
			} catch {
				// Skip malformed line
			}
			continue;
		}

		if (line.startsWith(PAPER_PREFIX)) {
			const sep = line.indexOf(" | ");
			if (sep <= PAPER_PREFIX.length) continue;
			const paperId = line.slice(PAPER_PREFIX.length, sep).trim();
			try {
				const p = JSON.parse(line.slice(sep + 3)) as Partial<PaperConfig>;
				if (!paperId || !p.title) continue;
				const candidate: PaperConfig = {
					id: paperId,
					title: p.title,
					subtitle: p.subtitle ?? "",
					motto: p.motto ?? "",
					language: p.language === "de" ? "de" : "en",
					...(p.languageOverride === "de" || p.languageOverride === "en"
						? { languageOverride: p.languageOverride }
						: {}),
					edition: p.edition ?? "biblio",
					formatMode: p.formatMode ?? "newspaper",
					magazineStyle: p.magazineStyle ?? "bicycle",
					magazineDays: Array.isArray(p.magazineDays) ? p.magazineDays : [0],
					imageStyle: p.imageStyle ?? "halftone",
					typeScale: p.typeScale ?? "standard",
					sheetMode: p.sheetMode ?? "auto",
					sections: Array.isArray(p.sections) ? p.sections : [],
					feeds: [],
					trackedTopics: Array.isArray(p.trackedTopics) ? p.trackedTopics : [],
					mutedKeywords: Array.isArray(p.mutedKeywords) ? p.mutedKeywords : [],
					maxArticlesPerFeed: p.maxArticlesPerFeed ?? 12,
					lookbackHours: p.lookbackHours ?? 72,
					volumeNumber: p.volumeNumber ?? 1,
					issueCounter: p.issueCounter ?? 0,
					createdAt: p.createdAt ?? 0,
					updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : 0,
					deletedFeeds: p.deletedFeeds ?? {},
					deletedSections: p.deletedSections ?? {},
				};
				const prev = paperStubs.get(paperId);
				if (!prev) {
					paperStubs.set(paperId, candidate);
				} else {
					const mergedStub = mergePaperCollections({
						localPapers: [prev],
						incomingPapers: [candidate],
						retentionDays: 0,
					}).papers[0];
					if (mergedStub) paperStubs.set(paperId, mergedStub);
				}
			} catch {
				// Skip malformed line
			}
			continue;
		}

		if (line.startsWith(FEED_PREFIX)) {
			const sep = line.indexOf(" | ");
			if (sep <= FEED_PREFIX.length) continue;
			const head = line.slice(FEED_PREFIX.length, sep).trim();
			const spIdx = head.indexOf(" ");
			if (spIdx <= 0) continue;
			const paperId = head.slice(0, spIdx).trim();
			const feedKey = head.slice(spIdx + 1).trim();
			try {
				const f = JSON.parse(line.slice(sep + 3)) as FeedSource;
				if (!paperId || !f.url) continue;
				let pFeeds = feedsByPaper.get(paperId);
				if (!pFeeds) {
					pFeeds = new Map();
					feedsByPaper.set(paperId, pFeeds);
				}
				const existing = pFeeds.get(feedKey);
				const candUpd = f.updatedAt ?? f.addedAt ?? 1;
				const exUpd = existing ? existing.updatedAt ?? existing.addedAt ?? 0 : -1;
				if (candUpd >= exUpd) {
					pFeeds.set(feedKey, { ...f, updatedAt: candUpd });
				}
			} catch {
				// Skip malformed line
			}
			continue;
		}

		if (line.startsWith(CLIP_PREFIX)) {
			const sep = line.indexOf(" | ");
			if (sep <= CLIP_PREFIX.length) continue;
			const clipKey = line.slice(CLIP_PREFIX.length, sep).trim();
			try {
				const c = JSON.parse(line.slice(sep + 3)) as ClipRecord;
				if (clipKey && c.notePath) {
					const existing = clips[clipKey];
					if (!existing || (c.clippedAt ?? 0) >= (existing.clippedAt ?? 0)) {
						clips[clipKey] = c;
					}
				}
			} catch {
				// Skip malformed line
			}
			continue;
		}

		if (line.startsWith(READING_PREFIX)) {
			const sepIdx = line.indexOf(" | ");
			if (sepIdx <= READING_PREFIX.length) continue;

			const articleKey = line.slice(READING_PREFIX.length, sepIdx).trim();
			const jsonPart = line.slice(sepIdx + 3).trim();
			if (!articleKey || !jsonPart.startsWith("{")) continue;

			try {
				const parsed = JSON.parse(jsonPart) as Record<string, unknown>;
				const statusRaw = parsed.s;
				const status: ReadingStatus =
					statusRaw === "read" || statusRaw === "reading" || statusRaw === "unread"
						? statusRaw
						: "unread";
				const progress = typeof parsed.p === "number" ? Math.max(0, Math.min(1, parsed.p)) : 0;
				const paragraphIndex =
					typeof parsed.i === "number" ? Math.max(0, Math.floor(parsed.i)) : 0;
				const updatedAt = typeof parsed.u === "number" ? parsed.u : 0;
				if (updatedAt <= 0) continue;

				const candidate: ReadingEntry = {
					articleKey,
					status,
					progress,
					paragraphIndex,
					updatedAt,
					readAt: typeof parsed.r === "number" ? parsed.r : undefined,
					title: typeof parsed.t === "string" ? parsed.t : undefined,
					feedTitle: typeof parsed.f === "string" ? parsed.f : undefined,
					url: typeof parsed.l === "string" ? parsed.l : undefined,
					paperId: typeof parsed.m === "string" ? parsed.m : undefined,
				};

				readingState[articleKey] = readingState[articleKey]
					? mergeReadingEntries(readingState[articleKey], candidate)
					: candidate;
			} catch {
				// Skip malformed line
			}
		}
	}

	const papers: PaperConfig[] = [];
	for (const [paperId, stub] of paperStubs.entries()) {
		const feedMap = feedsByPaper.get(paperId);
		const delFeeds = stub.deletedFeeds ?? {};
		const feeds = feedMap
			? Array.from(feedMap.values()).filter((f) => {
					const k = normalizeFeedKey(f.url);
					const d = delFeeds[k] ?? 0;
					return !(d > 0 && d >= (f.updatedAt ?? f.addedAt ?? 0));
				})
			: [];
		papers.push({ ...stub, feeds });
	}

	return { papers, deletedPapers, clips, readingState };
}

export function parseSyncLedger(markdown: string): Record<string, ReadingEntry> {
	return parseFullSyncLedger(markdown).readingState;
}

export interface ReadingSyncHost {
	app: App;
	getSnapshot(): FullSyncSnapshot;
	applySnapshot(next: FullSyncSnapshot, feedsChanged: boolean): void;
	getSyncConfig(): { enabled: boolean; path: string; retentionDays: number };
	persistPluginData(): Promise<void>;
}

/**
 * Coordinates live cross-device synchronization for:
 * 1. Subscribed Feeds, Desks, and Paper Configurations (`@paper`, `@feed`, `@del-paper`)
 * 2. Clipped Stories (`@clip`)
 * 3. Read/Unread Status & Paragraph-Accurate Reading Progress (`- art_...`)
 */
export class ReadingSyncService {
	private host: ReadingSyncHost;
	private listeners = new Set<() => void>();
	private flushTimer: number | null = null;
	private isWritingLedger = false;
	private lastWrittenContent = "";

	constructor(host: ReadingSyncHost) {
		this.host = host;
	}

	onChange(cb: () => void): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	private notifyListeners(): void {
		for (const cb of this.listeners) {
			try {
				cb();
			} catch {
				// Ignore view callback errors
			}
		}
	}

	getEntry(articleKey: string): ReadingEntry | undefined {
		return this.host.getSnapshot().readingState[articleKey];
	}

	isRead(articleKey: string): boolean {
		return this.host.getSnapshot().readingState[articleKey]?.status === "read";
	}

	private mergeSnapshots(
		local: FullSyncSnapshot,
		incoming: FullSyncSnapshot,
		retentionDays: number
	): { snapshot: FullSyncSnapshot; anyChanged: boolean; feedsChanged: boolean } {
		const paperRes = mergePaperCollections({
			localPapers: local.papers,
			incomingPapers: incoming.papers,
			localDeletedPapers: local.deletedPapers,
			incomingDeletedPapers: incoming.deletedPapers,
			retentionDays,
		});
		const clipsRes = mergeClipsMaps(local.clips, incoming.clips);
		const readRes = mergeReadingStateMaps(
			local.readingState,
			incoming.readingState,
			retentionDays
		);

		return {
			snapshot: {
				papers: paperRes.papers,
				deletedPapers: paperRes.deletedPapers,
				clips: clipsRes.merged,
				readingState: readRes.merged,
			},
			anyChanged: paperRes.changed || clipsRes.changed || readRes.changed,
			feedsChanged: paperRes.feedsChanged,
		};
	}

	/**
	 * Initial pull & merge from the Vault sync ledger on startup, then writes back
	 * any local papers/feeds/readingState not yet in the ledger!
	 */
	async initializeFromVault(): Promise<void> {
		const cfg = this.host.getSyncConfig();
		if (!cfg.enabled || !cfg.path.trim()) return;

		const normPath = normalizePath(cfg.path.trim());
		const abstract = this.host.app.vault.getAbstractFileByPath(normPath);
		if (abstract instanceof TFile) {
			try {
				const raw = await this.host.app.vault.read(abstract);
				const incoming = parseFullSyncLedger(raw);
				const { snapshot, anyChanged, feedsChanged } = this.mergeSnapshots(
					this.host.getSnapshot(),
					incoming,
					cfg.retentionDays
				);
				if (anyChanged) {
					this.host.applySnapshot(snapshot, feedsChanged);
					await this.host.persistPluginData();
					this.notifyListeners();
				}
				await this.writeLedgerNow();
			} catch {
				// Ignore startup read errors
			}
		} else {
			await this.writeLedgerNow();
		}
	}

	/**
	 * Handles Vault `modify` / `create` events triggered when Obsidian Sync downloads changes
	 * from another device.
	 */
	async handleVaultFileEvent(file: TAbstractFile): Promise<void> {
		if (this.isWritingLedger) return;
		const cfg = this.host.getSyncConfig();
		if (!cfg.enabled || !cfg.path.trim()) return;
		const normPath = normalizePath(cfg.path.trim());
		if (file.path !== normPath || !(file instanceof TFile)) return;

		try {
			const content = await this.host.app.vault.read(file);
			if (content === this.lastWrittenContent) return;
			const incoming = parseFullSyncLedger(content);
			const { snapshot, anyChanged, feedsChanged } = this.mergeSnapshots(
				this.host.getSnapshot(),
				incoming,
				cfg.retentionDays
			);
			if (anyChanged) {
				this.host.applySnapshot(snapshot, feedsChanged);
				await this.host.persistPluginData();
				this.notifyListeners();
			}
		} catch {
			// Ignore transient sync file locks
		}
	}

	/**
	 * Merges an incoming snapshot from `onExternalSettingsChange` (`data.json`).
	 */
	async mergeIncomingSnapshot(incoming: FullSyncSnapshot): Promise<void> {
		const cfg = this.host.getSyncConfig();
		const { snapshot, anyChanged, feedsChanged } = this.mergeSnapshots(
			this.host.getSnapshot(),
			incoming,
			cfg.retentionDays
		);
		if (anyChanged) {
			this.host.applySnapshot(snapshot, feedsChanged);
			this.notifyListeners();
			this.scheduleFlush(400);
		}
	}

	/**
	 * Records reading progress while scrolling an article in the In-Paper Reader.
	 */
	recordProgress(
		article: PressArticle,
		paperId: string,
		progress: number,
		paragraphIndex: number
	): void {
		const clamped = Math.max(0, Math.min(1, progress));
		const currentSnap = this.host.getSnapshot();
		const existing = currentSnap.readingState[article.articleKey];

		const autoCompleted = clamped >= 0.9;
		const nextStatus: ReadingStatus =
			existing?.status === "read" || autoCompleted
				? "read"
				: clamped > 0.03
					? "reading"
					: existing?.status ?? "unread";

		if (
			existing &&
			existing.status === nextStatus &&
			Math.abs(existing.progress - clamped) < 0.02 &&
			existing.paragraphIndex === paragraphIndex
		) {
			return;
		}

		const now = Date.now();
		const updated: ReadingEntry = {
			articleKey: article.articleKey,
			status: nextStatus,
			progress: autoCompleted ? 1 : clamped,
			paragraphIndex,
			title: article.title,
			url: article.url,
			feedTitle: article.feedTitle,
			paperId,
			readAt: nextStatus === "read" ? existing?.readAt ?? now : undefined,
			updatedAt: now,
		};

		this.host.applySnapshot(
			{
				...currentSnap,
				readingState: { ...currentSnap.readingState, [article.articleKey]: updated },
			},
			false
		);
		this.notifyListeners();
		this.scheduleFlush(600);
	}

	/**
	 * Explicitly marks an article as read or unread.
	 */
	setReadStatus(article: PressArticle, paperId: string, read: boolean): void {
		const now = Date.now();
		const currentSnap = this.host.getSnapshot();
		const existing = currentSnap.readingState[article.articleKey];
		const entry: ReadingEntry = {
			articleKey: article.articleKey,
			status: read ? "read" : "unread",
			progress: read ? 1 : 0,
			paragraphIndex: read ? existing?.paragraphIndex ?? 0 : 0,
			title: article.title,
			url: article.url,
			feedTitle: article.feedTitle,
			paperId,
			readAt: read ? now : undefined,
			updatedAt: now,
		};
		this.host.applySnapshot(
			{
				...currentSnap,
				readingState: { ...currentSnap.readingState, [article.articleKey]: entry },
			},
			false
		);
		this.notifyListeners();
		this.scheduleFlush(120);
	}

	/**
	 * Marks a batch of articles (e.g. an entire issue or desk) as read.
	 */
	markBatchRead(articles: PressArticle[], paperId: string): void {
		if (articles.length === 0) return;
		const now = Date.now();
		const currentSnap = this.host.getSnapshot();
		const nextReading = { ...currentSnap.readingState };
		for (const article of articles) {
			const existing = nextReading[article.articleKey];
			nextReading[article.articleKey] = {
				articleKey: article.articleKey,
				status: "read",
				progress: 1,
				paragraphIndex: existing?.paragraphIndex ?? 0,
				title: article.title,
				url: article.url,
				feedTitle: article.feedTitle,
				paperId,
				readAt: existing?.readAt ?? now,
				updatedAt: now,
			};
		}
		this.host.applySnapshot({ ...currentSnap, readingState: nextReading }, false);
		this.notifyListeners();
		this.scheduleFlush(120);
	}

	scheduleFlush(delayMs = 500): void {
		if (this.flushTimer !== null) {
			window.clearTimeout(this.flushTimer);
		}
		this.flushTimer = window.setTimeout(() => {
			this.flushTimer = null;
			void this.flushNow();
		}, delayMs);
	}

	async flushNow(): Promise<void> {
		if (this.flushTimer !== null) {
			window.clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		await this.host.persistPluginData();
		await this.writeLedgerNow();
	}

	private async writeLedgerNow(): Promise<void> {
		const cfg = this.host.getSyncConfig();
		if (!cfg.enabled || !cfg.path.trim()) return;

		const normPath = normalizePath(cfg.path.trim());
		this.isWritingLedger = true;
		try {
			await ensureParentFolders(this.host.app, normPath);
			const existing = this.host.app.vault.getAbstractFileByPath(normPath);
			let snapshotToWrite = this.host.getSnapshot();

			// Read-and-merge right before writing so concurrent line updates are never clobbered
			if (existing instanceof TFile) {
				const diskText = await this.host.app.vault.read(existing);
				const diskSnap = parseFullSyncLedger(diskText);
				const { snapshot, anyChanged, feedsChanged } = this.mergeSnapshots(
					snapshotToWrite,
					diskSnap,
					cfg.retentionDays
				);
				if (anyChanged) {
					snapshotToWrite = snapshot;
					this.host.applySnapshot(snapshot, feedsChanged);
				}
			}

			const serialized = serializeFullSyncLedger(snapshotToWrite);
			if (serialized === this.lastWrittenContent && existing instanceof TFile) {
				return;
			}
			this.lastWrittenContent = serialized;

			if (existing instanceof TFile) {
				await this.host.app.vault.modify(existing, serialized);
			} else {
				await this.host.app.vault.create(normPath, serialized);
			}
		} catch {
			// Ignore write race if folder/file is momentarily busy
		} finally {
			window.setTimeout(() => {
				this.isWritingLedger = false;
			}, 150);
		}
	}
}

async function ensureParentFolders(app: App, filePath: string): Promise<void> {
	const parts = filePath.split("/");
	parts.pop();
	if (parts.length === 0) return;
	let current = "";
	for (const seg of parts) {
		current = current ? `${current}/${seg}` : seg;
		const existing = app.vault.getAbstractFileByPath(current);
		if (!existing) {
			try {
				await app.vault.createFolder(current);
			} catch {
				// Folder may already exist
			}
		}
	}
}
