import { App, normalizePath, requestUrl } from "obsidian";
import { parseFeedContent } from "../feeds/parser";
import { toDateKey } from "../i18n";
import { EditionIssue, FeedSource, PaperConfig } from "../types";
import { FetchedFeedBatch, compileEditionFromBatches } from "./compiler";

export interface BackIssueSummary {
	dateKey: string;
	issueNumber: number;
	volumeNumber: number;
	totalArticles: number;
	leadHeadline?: string;
	compiledAt: number;
}

/**
 * Manages the local 14-day (fortnight) back-issue rack inside `.obsidian/plugins/obsidian-press/editions/`
 * and orchestrates concurrent on-device RSS/Atom/JSON feed fetching.
 */
export class PressArchiveStore {
	private app: App;
	private pluginDir: string;

	constructor(app: App, pluginDir: string) {
		this.app = app;
		this.pluginDir = pluginDir;
	}

	private paperArchiveDir(paperId: string): string {
		const safeId = paperId.replace(/[^a-zA-Z0-9_-]/g, "_");
		return normalizePath(`${this.pluginDir}/editions/${safeId}`);
	}

	private issueFilePath(paperId: string, dateKey: string): string {
		return normalizePath(`${this.paperArchiveDir(paperId)}/${dateKey}.json`);
	}

	async loadIssue(paperId: string, dateKey: string): Promise<EditionIssue | null> {
		const path = this.issueFilePath(paperId, dateKey);
		try {
			const exists = await this.app.vault.adapter.exists(path);
			if (!exists) return null;
			const raw = await this.app.vault.adapter.read(path);
			return JSON.parse(raw) as EditionIssue;
		} catch {
			return null;
		}
	}

	async saveIssue(issue: EditionIssue, fortnightDays = 14): Promise<void> {
		const dir = this.paperArchiveDir(issue.paperId);
		await this.ensureAdapterDir(dir);
		const path = this.issueFilePath(issue.paperId, issue.dateKey);
		await this.app.vault.adapter.write(path, JSON.stringify(issue));
		await this.pruneOldIssues(issue.paperId, fortnightDays);
	}

	async listBackIssues(paperId: string, fortnightDays = 14): Promise<BackIssueSummary[]> {
		const dir = this.paperArchiveDir(paperId);
		try {
			const exists = await this.app.vault.adapter.exists(dir);
			if (!exists) return [];
			const listed = await this.app.vault.adapter.list(dir);
			const summaries: BackIssueSummary[] = [];
			for (const filePath of listed.files) {
				if (!filePath.endsWith(".json")) continue;
				try {
					const raw = await this.app.vault.adapter.read(filePath);
					const issue = JSON.parse(raw) as EditionIssue;
					summaries.push({
						dateKey: issue.dateKey,
						issueNumber: issue.issueNumber,
						volumeNumber: issue.volumeNumber,
						totalArticles: issue.totalArticles,
						leadHeadline: issue.leadStory?.title,
						compiledAt: issue.compiledAt,
					});
				} catch {
					// Skip unreadable file
				}
			}
			summaries.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
			return summaries.slice(0, Math.max(1, fortnightDays));
		} catch {
			return [];
		}
	}

	private async pruneOldIssues(paperId: string, fortnightDays: number): Promise<void> {
		const dir = this.paperArchiveDir(paperId);
		try {
			const exists = await this.app.vault.adapter.exists(dir);
			if (!exists) return;
			const listed = await this.app.vault.adapter.list(dir);
			const jsonFiles = listed.files
				.filter((f) => f.endsWith(".json"))
				.sort((a, b) => b.localeCompare(a));

			const maxKeep = Math.max(2, fortnightDays);
			const toRemove = jsonFiles.slice(maxKeep);
			for (const oldPath of toRemove) {
				try {
					await this.app.vault.adapter.remove(oldPath);
				} catch {
					// Ignore delete error
				}
			}
		} catch {
			// Ignore listing error
		}
	}

	private async ensureAdapterDir(dirPath: string): Promise<void> {
		const parts = dirPath.split("/").filter(Boolean);
		let acc = "";
		for (const p of parts) {
			acc = acc ? `${acc}/${p}` : p;
			if (!(await this.app.vault.adapter.exists(acc))) {
				try {
					await this.app.vault.adapter.mkdir(acc);
				} catch {
					// Ignore race
				}
			}
		}
	}

	/**
	 * Fetches all enabled feeds for `paper` concurrently on-device, compiles a fresh edition,
	 * updates feed metadata, and writes today's snapshot into the fortnight rack.
	 */
	async printFreshEdition(
		paper: PaperConfig,
		fortnightDays = 14
	): Promise<{ issue: EditionIssue; updatedPaper: PaperConfig }> {
		const enabledFeeds = paper.feeds.filter((f) => f.enabled && f.url.trim().length > 0);
		const batches: FetchedFeedBatch[] = [];

		// Fetch with bounded concurrency of 5 so large subscriptions compile fast without spiking sockets
		const concurrency = 5;
		let idx = 0;
		const feedStatusUpdates = new Map<string, { fetchedAt?: number; error?: string; discoveredTitle?: string }>();

		const worker = async () => {
			while (idx < enabledFeeds.length) {
				const currentIdx = idx++;
				const source: FeedSource = enabledFeeds[currentIdx];
				try {
					const res = await requestUrl({
						url: source.url,
						method: "GET",
						headers: {
							Accept:
								"application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml;q=0.9, */*;q=0.8",
						},
					});
					const parsed = parseFeedContent(res.text, source.url);
					batches.push({ source, parsed });
					feedStatusUpdates.set(source.id, {
						fetchedAt: Date.now(),
						error: undefined,
						discoveredTitle: parsed.title,
					});
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					batches.push({ source, error: msg });
					feedStatusUpdates.set(source.id, {
						error: msg,
					});
				}
			}
		};

		const workers = Array.from({ length: Math.min(concurrency, Math.max(1, enabledFeeds.length)) }, () =>
			worker()
		);
		await Promise.all(workers);

		// Preserve stable issue number if re-printing on the exact same day, otherwise increment
		const todayKey = toDateKey(new Date());
		const existingToday = await this.loadIssue(paper.id, todayKey);
		const nextIssueNumber = existingToday
			? existingToday.issueNumber
			: Math.max(1, paper.issueCounter + 1);

		const issue = compileEditionFromBatches(paper, batches, Date.now(), nextIssueNumber);
		await this.saveIssue(issue, fortnightDays);

		const updatedFeeds = paper.feeds.map((f) => {
			const status = feedStatusUpdates.get(f.id);
			if (!status) return f;
			return {
				...f,
				title: f.title || status.discoveredTitle || f.url,
				lastFetchedAt: status.fetchedAt ?? f.lastFetchedAt,
				lastError: status.error,
			};
		});

		const updatedPaper: PaperConfig = {
			...paper,
			issueCounter: Math.max(paper.issueCounter, nextIssueNumber),
			feeds: updatedFeeds,
		};

		return { issue, updatedPaper };
	}
}
