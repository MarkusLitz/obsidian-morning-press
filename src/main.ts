import { Plugin, WorkspaceLeaf } from "obsidian";
import { toDateKey } from "./i18n";
import { PressArchiveStore } from "./press/archiveStore";
import { ObsidianPressSettingTab } from "./settings";
import {
	ReadingSyncService,
	mergeClipsMaps,
	mergePaperCollections,
	mergeReadingStateMaps,
} from "./sync/readingSync";
import {
	DEFAULT_SETTINGS,
	ObsidianPressSettings,
	PaperConfig,
	VIEW_TYPE_PRESS,
	createDefaultPaper,
} from "./types";
import { ManagePaperModal } from "./views/ManagePaperModal";
import { PressView } from "./views/PressView";

export default class ObsidianPressPlugin extends Plugin {
	settings!: ObsidianPressSettings;
	archiveStore!: PressArchiveStore;
	readingSync!: ReadingSyncService;
	private ribbonEl: HTMLElement | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		const pluginDir = this.manifest.dir || `.obsidian/plugins/${this.manifest.id}`;
		this.archiveStore = new PressArchiveStore(this.app, pluginDir);

		this.readingSync = new ReadingSyncService({
			app: this.app,
			getSnapshot: () => ({
				papers: this.settings.papers,
				deletedPapers: this.settings.deletedPapers ?? {},
				clips: this.settings.clips ?? {},
				readingState: this.settings.readingState ?? {},
			}),
			applySnapshot: (next, feedsChanged) => {
				this.settings.papers =
					next.papers.length > 0
						? next.papers
						: [createDefaultPaper(this.settings.uiLanguage)];
				this.settings.deletedPapers = next.deletedPapers;
				this.settings.clips = next.clips;
				this.settings.readingState = next.readingState;
				if (
					!this.settings.papers.some((p) => p.id === this.settings.activePaperId) &&
					this.settings.papers[0]
				) {
					this.settings.activePaperId = this.settings.papers[0].id;
				}
				if (feedsChanged) {
					void this.refreshOpenViews(true);
				}
			},
			getSyncConfig: () => ({
				enabled: this.settings.syncLedgerEnabled,
				path: this.settings.syncLedgerPath,
				retentionDays: this.settings.retentionDays,
			}),
			persistPluginData: async () => {
				await this.saveSettingsMerged();
			},
		});

		this.registerView(VIEW_TYPE_PRESS, (leaf) => new PressView(leaf, this));

		this.ribbonEl = this.addRibbonIcon(
			"newspaper",
			this.settings.uiLanguage === "de" ? "Morgenausgabe öffnen" : "Open morning edition",
			() => {
				void this.activatePressView();
			}
		);

		this.applyUiLanguage();

		this.addSettingTab(new ObsidianPressSettingTab(this.app, this));

		// Watch Vault events for real-time cross-device Obsidian Sync updates
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				void this.readingSync.handleVaultFileEvent(file);
			})
		);
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				void this.readingSync.handleVaultFileEvent(file);
			})
		);

		this.app.workspace.onLayoutReady(async () => {
			await this.readingSync.initializeFromVault();

			if (this.settings.autoOpenMorning) {
				const today = toDateKey(new Date());
				if (this.settings.lastAutoOpenDate !== today) {
					this.settings.lastAutoOpenDate = today;
					await this.saveSettings();
					await this.activatePressView();
				}
			}
		});
	}

	applyUiLanguage(): void {
		const isDe = this.settings.uiLanguage === "de";
		if (this.ribbonEl) {
			this.ribbonEl.setAttribute(
				"aria-label",
				isDe ? "Morgenausgabe öffnen" : "Open morning edition"
			);
		}

		this.addCommand({
			id: "open-edition",
			name: isDe ? "Morgenausgabe öffnen" : "Open morning edition",
			callback: () => {
				void this.activatePressView();
			},
		});

		this.addCommand({
			id: "print-fresh-edition",
			name: isDe ? "Frische Ausgabe drucken" : "Print a fresh edition",
			callback: async () => {
				await this.activatePressView();
				const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_PRESS);
				for (const leaf of leaves) {
					if (leaf.view instanceof PressView) {
						await leaf.view.printFreshNow();
					}
				}
			},
		});

		this.addCommand({
			id: "manage-sources-and-desks",
			name: isDe
				? "Redaktion, Quellen & Starter-Desks verwalten"
				: "Manage press room, sources, and starter desks",
			callback: () => {
				new ManagePaperModal(this.app, {
					getUiLanguage: () => this.settings.uiLanguage,
					getPapers: () => this.settings.papers,
					getActivePaper: () => this.getActivePaper(),
					savePapersAndRefresh: async (papers, activeId, recompile, deletedPaperId) => {
						await this.savePapersFromModal(
							papers,
							activeId,
							recompile,
							deletedPaperId
						);
					},
				}).open();
			},
		});

		this.addCommand({
			id: "sync-reading-progress-now",
			name: isDe
				? "Quellen, Rubriken & Lesefortschritt jetzt synchronisieren"
				: "Sync sources, desks, and reading progress now",
			callback: async () => {
				await this.readingSync.initializeFromVault();
				await this.readingSync.flushNow();
			},
		});
	}

	onunload(): void {
		void this.readingSync?.flushNow();
	}

	/**
	 * Invoked automatically by Obsidian when `data.json` is modified externally (e.g. Obsidian Sync).
	 * Merges papers/feeds, clips, and readingState per-item instead of overwriting local data!
	 */
	async onExternalSettingsChange(): Promise<void> {
		const raw = (await this.loadData()) as Partial<ObsidianPressSettings> | null;
		if (!raw) return;

		const paperRes = mergePaperCollections({
			localPapers: this.settings.papers ?? [],
			incomingPapers: Array.isArray(raw.papers) ? raw.papers : [],
			localDeletedPapers: this.settings.deletedPapers,
			incomingDeletedPapers: raw.deletedPapers,
			retentionDays: this.settings.retentionDays,
		});
		const clipsRes = mergeClipsMaps(this.settings.clips ?? {}, raw.clips ?? {});
		const readRes = mergeReadingStateMaps(
			this.settings.readingState ?? {},
			raw.readingState ?? {},
			this.settings.retentionDays
		);

		const nextLang = raw.uiLanguage === "de" ? "de" : raw.uiLanguage === "en" ? "en" : this.settings.uiLanguage;
		this.settings = {
			...DEFAULT_SETTINGS,
			...raw,
			uiLanguage: nextLang,
			papers:
				paperRes.papers.length > 0
					? paperRes.papers
					: [createDefaultPaper(nextLang)],
			deletedPapers: paperRes.deletedPapers,
			readingState: readRes.merged,
			clips: clipsRes.merged,
		};
		this.applyUiLanguage();
		if (
			!this.settings.papers.some((p) => p.id === this.settings.activePaperId) &&
			this.settings.papers[0]
		) {
			this.settings.activePaperId = this.settings.papers[0].id;
		}

		await this.readingSync.mergeIncomingSnapshot({
			papers: Array.isArray(raw.papers) ? raw.papers : [],
			deletedPapers: raw.deletedPapers ?? {},
			clips: raw.clips ?? {},
			readingState: raw.readingState ?? {},
		});
		await this.refreshOpenViews(paperRes.feedsChanged);
	}

	async loadSettings(): Promise<void> {
		const raw = (await this.loadData()) as Partial<ObsidianPressSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw ?? {});
		if (this.settings.uiLanguage !== "de" && this.settings.uiLanguage !== "en") {
			this.settings.uiLanguage = "en";
		}
		if (!Array.isArray(this.settings.papers) || this.settings.papers.length === 0) {
			this.settings.papers = [createDefaultPaper(this.settings.uiLanguage)];
		}
		if (!this.settings.deletedPapers) this.settings.deletedPapers = {};
		if (!this.settings.readingState) this.settings.readingState = {};
		if (!this.settings.clips) this.settings.clips = {};
	}

	async saveSettings(): Promise<void> {
		await this.saveSettingsMerged();
	}

	/**
	 * Reads any external `data.json` state before saving so concurrent device syncs never lose feeds, clips, or reading entries.
	 */
	private async saveSettingsMerged(): Promise<void> {
		try {
			const disk = (await this.loadData()) as Partial<ObsidianPressSettings> | null;
			if (disk?.papers && Array.isArray(disk.papers)) {
				const paperRes = mergePaperCollections({
					localPapers: this.settings.papers,
					incomingPapers: disk.papers,
					localDeletedPapers: this.settings.deletedPapers,
					incomingDeletedPapers: disk.deletedPapers,
					retentionDays: this.settings.retentionDays,
				});
				this.settings.papers =
					paperRes.papers.length > 0 ? paperRes.papers : this.settings.papers;
				this.settings.deletedPapers = paperRes.deletedPapers;
			}
			if (disk?.readingState) {
				const { merged } = mergeReadingStateMaps(
					this.settings.readingState,
					disk.readingState,
					this.settings.retentionDays
				);
				this.settings.readingState = merged;
			}
			if (disk?.clips) {
				this.settings.clips = mergeClipsMaps(this.settings.clips, disk.clips).merged;
			}
		} catch {
			// Proceed with current settings if disk read fails
		}
		await this.saveData(this.settings);
	}

	getActivePaper(): PaperConfig {
		const found = this.settings.papers.find((p) => p.id === this.settings.activePaperId);
		return found ?? this.settings.papers[0];
	}

	async savePapersFromModal(
		papers: PaperConfig[],
		activeId: string,
		recompile = false,
		deletedPaperId?: string
	): Promise<void> {
		this.settings.papers = papers;
		this.settings.activePaperId = activeId;
		if (deletedPaperId) {
			this.settings.deletedPapers = {
				...(this.settings.deletedPapers ?? {}),
				[deletedPaperId]: Date.now(),
			};
		}
		await this.saveSettings();
		this.readingSync.scheduleFlush(150);
		await this.refreshOpenViews(recompile);
	}

	async replacePaperConfig(updated: PaperConfig, flushSync = true): Promise<void> {
		this.settings.papers = this.settings.papers.map((p) =>
			p.id === updated.id ? updated : p
		);
		await this.saveSettings();
		if (flushSync) {
			this.readingSync.scheduleFlush(250);
		}
	}

	async activatePressView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_PRESS);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE_PRESS, active: true });
		}
		await workspace.revealLeaf(leaf);
	}

	async refreshOpenViews(recompile = false): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_PRESS);
		for (const leaf of leaves) {
			if (leaf.view instanceof PressView) {
				if (recompile) {
					await leaf.view.printFreshNow();
				} else {
					leaf.view.refreshFromSettings();
				}
			}
		}
	}
}
