import { App, Modal, Notice, Setting } from "obsidian";
import { discoverFeedUrl } from "../feeds/discovery";
import { exportPaperToOpml, parseOpml } from "../feeds/opml";
import { STARTER_CATALOG } from "../starterCatalog";
import { normalizeFeedKey } from "../sync/readingSync";
import {
	CORRESPONDENCE_SECTION_ID,
	DeskSection,
	FeedSource,
	ImageRenderStyle,
	MagazineStyle,
	NewspaperEdition,
	PaperConfig,
	PaperFormatMode,
	PaperLanguage,
	SheetMode,
	TypeScale,
	createDefaultPaper,
	localizeDefaultLabel,
} from "../types";

export interface ManagePaperHost {
	getUiLanguage(): PaperLanguage;
	getPapers(): PaperConfig[];
	getActivePaper(): PaperConfig;
	savePapersAndRefresh(
		papers: PaperConfig[],
		activePaperId: string,
		recompile?: boolean,
		deletedPaperId?: string
	): Promise<void>;
}

type ModalTab = "appearance" | "sources" | "starter" | "filters";

export class ManagePaperModal extends Modal {
	private host: ManagePaperHost;
	private activeTab: ModalTab = "sources";
	private selectedPaperId: string;
	private sourcesChanged = false;

	constructor(app: App, host: ManagePaperHost, initialTab?: ModalTab) {
		super(app);
		this.host = host;
		this.selectedPaperId = host.getActivePaper().id;
		if (initialTab) {
			this.activeTab = initialTab;
		} else if (host.getActivePaper().feeds.length === 0) {
			this.activeTab = "starter";
		}
	}

	private currentPaper(): PaperConfig {
		const papers = this.host.getPapers();
		return papers.find((p) => p.id === this.selectedPaperId) ?? papers[0];
	}

	private async updatePaper(mutator: (paper: PaperConfig) => PaperConfig, markSourcesDirty = false): Promise<void> {
		const now = Date.now();
		const papers = this.host.getPapers();
		const updated = papers.map((p) =>
			p.id === this.selectedPaperId ? { ...mutator(p), updatedAt: now } : p
		);
		if (markSourcesDirty) this.sourcesChanged = true;
		await this.host.savePapersAndRefresh(updated, this.selectedPaperId, false);
	}

	onOpen(): void {
		this.modalEl.style.width = "min(92vw, 860px)";
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
		if (this.sourcesChanged) {
			void this.host.savePapersAndRefresh(
				this.host.getPapers(),
				this.selectedPaperId,
				true
			);
		}
	}

	private uiLang(): PaperLanguage {
		return this.host.getUiLanguage() === "de" ? "de" : "en";
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		const paper = this.currentPaper();
		const isDe = this.uiLang() === "de";

		contentEl.createEl("h2", {
			text: isDe ? `Redaktion — ${paper.title}` : `Press Room — ${paper.title}`,
		});

		// Paper Switcher + New Paper row
		const paperRow = contentEl.createDiv({
			cls: "op-utility-group",
		});
		paperRow.style.marginBottom = "12px";

		const paperSelect = paperRow.createEl("select", { cls: "dropdown" });
		for (const p of this.host.getPapers()) {
			const opt = paperSelect.createEl("option", { value: p.id, text: p.title });
			if (p.id === paper.id) opt.selected = true;
		}
		paperSelect.addEventListener("change", async () => {
			this.selectedPaperId = paperSelect.value;
			await this.host.savePapersAndRefresh(this.host.getPapers(), this.selectedPaperId, false);
			this.render();
		});

		const addPaperBtn = paperRow.createEl("button", {
			text: isDe ? "+ Neue Publikation" : "+ New Paper",
		});
		addPaperBtn.addEventListener("click", async () => {
			const now = Date.now();
			const id = `paper-${now}`;
			const nextPaper: PaperConfig = {
				...createDefaultPaper(this.uiLang()),
				id,
				title: isDe ? "Wochenend-Journal" : "Weekend Review",
				subtitle: isDe ? "Sonderausgabe" : "Weekend Edition",
				updatedAt: now,
			};
			const all = [...this.host.getPapers(), nextPaper];
			this.selectedPaperId = id;
			await this.host.savePapersAndRefresh(all, id, false);
			this.render();
		});

		if (this.host.getPapers().length > 1) {
			const delPaperBtn = paperRow.createEl("button", {
				text: isDe ? "Publikation löschen" : "Delete Paper",
			});
			delPaperBtn.addEventListener("click", async () => {
				const remaining = this.host.getPapers().filter((p) => p.id !== paper.id);
				this.selectedPaperId = remaining[0].id;
				await this.host.savePapersAndRefresh(
					remaining,
					this.selectedPaperId,
					false,
					paper.id
				);
				this.render();
			});
		}

		// Navigation Tabs
		const tabsBar = contentEl.createDiv({ cls: "op-modal-tabs" });
		const tabs: Array<{ id: ModalTab; label: string }> = [
			{ id: "starter", label: isDe ? "Starter-Katalog & Desks" : "Starter Desks" },
			{ id: "sources", label: isDe ? `Quellen & OPML (${paper.feeds.length})` : `Sources & OPML (${paper.feeds.length})` },
			{ id: "appearance", label: isDe ? "Edition, Magazin & Optik" : "Edition & Layout" },
			{ id: "filters", label: isDe ? "Themen & Wortfilter" : "Topics & Filters" },
		];

		for (const tab of tabs) {
			const btn = tabsBar.createEl("button", {
				cls: `op-modal-tab ${this.activeTab === tab.id ? "is-active" : ""}`.trim(),
				text: tab.label,
			});
			btn.addEventListener("click", () => {
				this.activeTab = tab.id;
				this.render();
			});
		}

		const body = contentEl.createDiv();
		if (this.activeTab === "appearance") {
			this.renderAppearanceTab(body, paper);
		} else if (this.activeTab === "sources") {
			this.renderSourcesTab(body, paper);
		} else if (this.activeTab === "starter") {
			this.renderStarterTab(body, paper);
		} else {
			this.renderFiltersTab(body, paper);
		}
	}

	private renderAppearanceTab(container: HTMLElement, paper: PaperConfig): void {
		const isDe = this.uiLang() === "de";

		new Setting(container)
			.setName(isDe ? "Zeitungstitel (Masthead)" : "Masthead Title")
			.addText((txt) =>
				txt.setValue(paper.title).onChange(async (val) => {
					await this.updatePaper((p) => ({ ...p, title: val || "Obsidian Press" }));
				})
			);

		new Setting(container)
			.setName(isDe ? "Untertitel & Motto" : "Subtitle & Motto")
			.addText((txt) =>
				txt
					.setPlaceholder(isDe ? "Morgenausgabe" : "Morning Edition")
					.setValue(localizeDefaultLabel(paper.subtitle, isDe ? "de" : "en"))
					.onChange(async (val) => {
						await this.updatePaper((p) => ({ ...p, subtitle: val }));
					})
			)
			.addText((txt) =>
				txt
					.setPlaceholder(isDe ? "Dein Gerät ist die Druckerpresse" : "Your device is the press")
					.setValue(localizeDefaultLabel(paper.motto, isDe ? "de" : "en"))
					.onChange(async (val) => {
						await this.updatePaper((p) => ({ ...p, motto: val }));
					})
			);

		new Setting(container)
			.setName(isDe ? "Sprache der Ausgabe" : "Edition Language")
			.setDesc(
				isDe
					? "Folgt standardmäßig der Plugin-Sprache, kann aber pro Zeitung übersteuert werden."
					: "Follows the plugin language by default, or override per paper."
			)
			.addDropdown((dd) =>
				dd
					.addOption(
						"plugin",
						isDe ? "Plugin-Sprache übernehmen (Standard)" : "Follow plugin language (Default)"
					)
					.addOption("en", "English (Vol. · No.)")
					.addOption("de", "Deutsch (Jahrgang · Nr.)")
					.setValue(paper.languageOverride ?? "plugin")
					.onChange(async (val) => {
						const nextOverride: PaperLanguage | undefined =
							val === "en" || val === "de" ? val : undefined;
						const eff = nextOverride ?? this.uiLang();
						await this.updatePaper(
							(p) => ({
								...p,
								language: eff,
								languageOverride: nextOverride,
								subtitle: localizeDefaultLabel(p.subtitle, eff),
								motto: localizeDefaultLabel(p.motto, eff),
								sections: p.sections.map((s) => ({
									...s,
									title: localizeDefaultLabel(s.title, eff),
								})),
							}),
							true
						);
						this.render();
					})
			);

		new Setting(container)
			.setName(isDe ? "Standard-Format" : "Primary Format")
			.addDropdown((dd) =>
				dd
					.addOption("newspaper", isDe ? "Tageszeitung (Newspaper)" : "Newspaper")
					.addOption("magazine", isDe ? "Magazin (Magazine)" : "Magazine")
					.setValue(paper.formatMode)
					.onChange(async (val) => {
						await this.updatePaper((p) => ({ ...p, formatMode: val as PaperFormatMode }), true);
					})
			);

		new Setting(container)
			.setName(isDe ? "Zeitungs-Edition" : "Newspaper Edition")
			.setDesc(
				isDe
					? "Biblio (Fraunces/Serif auf Papier), Digital (Grotesk), Dystopian (Graues Pulp & Typewriter)."
					: "Biblio (Fraunces/Serif on newsprint), Digital (tight Grotesk), Dystopian (grey pulp & typewriter)."
			)
			.addDropdown((dd) =>
				dd
					.addOption("biblio", "Biblio — Fraunces & Serif (Newsprint)")
					.addOption("digital", "Digital — Tight Grotesk")
					.addOption("dystopian", "Dystopian — Grey Pulp & Typewriter")
					.setValue(paper.edition)
					.onChange(async (val) => {
						await this.updatePaper((p) => ({ ...p, edition: val as NewspaperEdition }), true);
					})
			);

		new Setting(container)
			.setName(isDe ? "Magazin-Stil" : "Magazine Style")
			.setDesc(
				isDe
					? "Bicycle (Serif auf Cream), Signal (Grotesk auf Grau), Plate (Fotografie auf Weiß/Schwarz)."
					: "Bicycle (Serif on cream), Signal (Grotesk on grey), Plate (photography on white/black)."
			)
			.addDropdown((dd) =>
				dd
					.addOption("bicycle", "Bicycle — Serif on Cream")
					.addOption("signal", "Signal — Grotesk on Grey")
					.addOption("plate-light", "Plate — Photography on White")
					.addOption("plate-dark", "Plate — Photography on Black")
					.setValue(paper.magazineStyle)
					.onChange(async (val) => {
						await this.updatePaper((p) => ({ ...p, magazineStyle: val as MagazineStyle }), true);
					})
			);

		// Weekday Magazine Schedule
		const daysSetting = new Setting(container)
			.setName(isDe ? "Wochentage als Magazin drucken" : "Print as Magazine on Days")
			.setDesc(isDe ? "An ausgewählten Tagen erscheint die Zeitung automatisch im Magazin-Layout." : "Automatically format as a magazine on selected days.");

		const dayLabels = isDe
			? ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]
			: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
		dayLabels.forEach((lbl, dayIdx) => {
			const btn = daysSetting.controlEl.createEl("button", {
				cls: `op-btn ${paper.magazineDays.includes(dayIdx) ? "is-active" : ""}`.trim(),
				text: lbl,
			});
			btn.style.marginLeft = "4px";
			btn.addEventListener("click", async () => {
				const set = new Set(paper.magazineDays);
				if (set.has(dayIdx)) set.delete(dayIdx);
				else set.add(dayIdx);
				await this.updatePaper((p) => ({ ...p, magazineDays: Array.from(set).sort() }), true);
				this.render();
			});
		});

		new Setting(container)
			.setName(isDe ? "Bild-Stil (Halftone-Raster)" : "Picture Style")
			.addDropdown((dd) =>
				dd
					.addOption("halftone", isDe ? "Halftone S/W-Punktraster (45°)" : "Halftone Dot Screen")
					.addOption("color-ink", isDe ? "Gedämpfter Zeitungsfarbdruck" : "Muted Color Ink")
					.addOption("color", isDe ? "Originalfarbe" : "Full Color")
					.addOption("none", isDe ? "Nur Text (keine Bilder)" : "No Pictures")
					.setValue(paper.imageStyle)
					.onChange(async (val) => {
						await this.updatePaper((p) => ({ ...p, imageStyle: val as ImageRenderStyle }));
					})
			);

		new Setting(container)
			.setName(isDe ? "Schriftgröße & Seiten-Formfaktor" : "Type Size & Sheet Mode")
			.addDropdown((dd) =>
				dd
					.addOption("compact", isDe ? "Kompakt" : "Compact")
					.addOption("standard", isDe ? "Standard" : "Standard")
					.addOption("comfortable", isDe ? "Komfortabel" : "Comfortable")
					.addOption("large", isDe ? "Groß" : "Large")
					.setValue(paper.typeScale)
					.onChange(async (val) => {
						await this.updatePaper((p) => ({ ...p, typeScale: val as TypeScale }));
					})
			)
			.addDropdown((dd) =>
				dd
					.addOption("auto", isDe ? "Automatisch (Responsiv)" : "Auto Spread / Fold")
					.addOption("broadsheet", isDe ? "Broadsheet (Mehrspaltig)" : "Full Spread")
					.addOption("folded", isDe ? "Gefaltet (Schmale Spalte)" : "Folded Sheet")
					.setValue(paper.sheetMode)
					.onChange(async (val) => {
						await this.updatePaper((p) => ({ ...p, sheetMode: val as SheetMode }));
					})
			);
	}

	private renderSourcesTab(container: HTMLElement, paper: PaperConfig): void {
		const isDe = this.uiLang() === "de";

		// 1. Add Custom URL / Feed with Autodiscovery
		let urlInputVal = "";
		let targetDeskVal = CORRESPONDENCE_SECTION_ID;

		const addSetting = new Setting(container)
			.setName(isDe ? "Website oder RSS/Atom-Adresse hinzufügen" : "Add Website or Feed URL")
			.setDesc(
				isDe
					? "Gib eine beliebige Website (z. B. zeit.de) oder Feed-URL ein. Ohne feste Rubrik erscheint sie unter „Korrespondenz“."
					: "Paste any site or feed URL. Unassigned feeds print under Correspondence."
			);

		addSetting.addText((txt) => {
			txt.setPlaceholder("https://example.com/feed.xml");
			txt.inputEl.style.width = "240px";
			txt.onChange((v) => {
				urlInputVal = v;
			});
		});

		addSetting.addDropdown((dd) => {
			dd.addOption(CORRESPONDENCE_SECTION_ID, isDe ? "Korrespondenz (Standard)" : "Correspondence");
			for (const sec of paper.sections) {
				dd.addOption(sec.id, localizeDefaultLabel(sec.title, this.uiLang()));
			}
			dd.setValue(targetDeskVal);
			dd.onChange((v) => {
				targetDeskVal = v;
			});
		});

		addSetting.addButton((btn) =>
			btn
				.setButtonText(isDe ? "Hinzufügen" : "Add")
				.setCta()
				.onClick(async () => {
					if (!urlInputVal.trim()) return;
					btn.setDisabled(true);
					btn.setButtonText(isDe ? "Prüfe…" : "Checking…");
					try {
						const discovered = await discoverFeedUrl(urlInputVal, this.uiLang());
						const exists = paper.feeds.some(
							(f) => f.url.toLowerCase() === discovered.feedUrl.toLowerCase()
						);
						if (exists) {
							new Notice(isDe ? "Quelle ist bereits abonniert." : "Feed already added.");
						} else {
							const now = Date.now();
							const newFeed: FeedSource = {
								id: `feed-${now}-${Math.random().toString(36).slice(2, 6)}`,
								title: discovered.title,
								url: discovered.feedUrl,
								siteUrl: discovered.siteUrl,
								sectionId: targetDeskVal,
								enabled: true,
								addedAt: now,
								updatedAt: now,
							};
							await this.updatePaper(
								(p) => ({ ...p, feeds: [...p.feeds, newFeed] }),
								true
							);
							new Notice(`✓ ${discovered.title}`);
						}
						this.render();
					} catch (err) {
						new Notice(err instanceof Error ? err.message : String(err));
						btn.setDisabled(false);
						btn.setButtonText(isDe ? "Hinzufügen" : "Add");
					}
				})
		);

		// 2. OPML Import & Export
		const opmlSetting = new Setting(container)
			.setName("OPML Import & Export")
			.setDesc(
				isDe
					? "Übernehme bestehende RSS-Sammlungen (Ordner werden automatisch als Rubriken angelegt) oder exportiere deine Zeitung."
					: "Import an OPML subscription list (folders become Desks) or export this paper."
			);

		opmlSetting.addButton((btn) =>
			btn.setButtonText(isDe ? "OPML importieren…" : "Import OPML…").onClick(() => {
				const fileInput = document.createElement("input");
				fileInput.type = "file";
				fileInput.accept = ".opml,.xml,text/xml,application/xml";
				fileInput.onchange = async () => {
					const file = fileInput.files?.[0];
					if (!file) return;
					const text = await file.text();
					const parsed = parseOpml(text);
					let addedCount = 0;

					await this.updatePaper((p) => {
						const now = Date.now();
						const nextSections = [...p.sections];
						const nextFeeds = [...p.feeds];
						const nextDelFeeds = { ...(p.deletedFeeds ?? {}) };
						const existingUrls = new Set(nextFeeds.map((f) => normalizeFeedKey(f.url)));

						for (const grp of parsed.groups) {
							let sectionId = CORRESPONDENCE_SECTION_ID;
							if (!grp.isDefaultCorrespondence) {
								const foundSec = nextSections.find(
									(s) => s.title.toLowerCase() === grp.title.toLowerCase()
								);
								if (foundSec) {
									sectionId = foundSec.id;
								} else {
									sectionId = `desk-${grp.title
										.toLowerCase()
										.replace(/[^a-z0-9]+/g, "-")
										.replace(/^-|-$/g, "") || now}`;
									nextSections.push({
										id: sectionId,
										title: grp.title,
										order: nextSections.length,
										updatedAt: now,
									});
								}
							}
							for (const entry of grp.feeds) {
								const normKey = normalizeFeedKey(entry.xmlUrl);
								if (!normKey || existingUrls.has(normKey)) continue;
								existingUrls.add(normKey);
								delete nextDelFeeds[normKey];
								nextFeeds.push({
									id: `feed-${now}-${Math.random().toString(36).slice(2, 7)}`,
									title: entry.title,
									url: entry.xmlUrl,
									siteUrl: entry.htmlUrl,
									sectionId,
									enabled: true,
									addedAt: now,
									updatedAt: now,
								});
								addedCount++;
							}
						}
						return {
							...p,
							sections: nextSections,
							feeds: nextFeeds,
							deletedFeeds: nextDelFeeds,
							updatedAt: now,
						};
					}, true);

					new Notice(
						isDe
							? `${addedCount} Feed(s) aus OPML importiert.`
							: `Imported ${addedCount} feed(s) from OPML.`
					);
					this.render();
				};
				fileInput.click();
			})
		);

		opmlSetting.addButton((btn) =>
			btn.setButtonText(isDe ? "OPML exportieren" : "Export OPML").onClick(() => {
				const xml = exportPaperToOpml(paper);
				const blob = new Blob([xml], { type: "text/x-opml;charset=utf-8" });
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = `${paper.id}.opml`;
				a.click();
				URL.revokeObjectURL(url);
			})
		);

		// 3. Custom Desks / Sections management
		container.createEl("h4", { text: isDe ? "Rubriken (Desks)" : "Editorial Desks" });
		let newDeskTitle = "";
		new Setting(container)
			.setName(isDe ? "Neue Rubrik anlegen" : "Create Custom Desk")
			.addText((txt) =>
				txt
					.setPlaceholder(isDe ? "z. B. Lokales, Finanzen, Musik" : "e.g. Local, Markets, Books")
					.onChange((v) => {
						newDeskTitle = v;
					})
			)
			.addButton((btn) =>
				btn.setButtonText("+").onClick(async () => {
					if (!newDeskTitle.trim()) return;
					const now = Date.now();
					const newDesk: DeskSection = {
						id: `desk-${now}`,
						title: newDeskTitle.trim(),
						order: paper.sections.length,
						updatedAt: now,
					};
					await this.updatePaper(
						(p) => ({ ...p, sections: [...p.sections, newDesk] }),
						true
					);
					this.render();
				})
			);

		for (const sec of [...paper.sections].sort((a, b) => a.order - b.order)) {
			const row = container.createDiv({ cls: "op-feed-row" });
			row.createSpan({ text: localizeDefaultLabel(sec.title, this.uiLang()) });
			const delBtn = row.createEl("button", {
				cls: "op-btn",
				text: isDe ? "Entfernen" : "Remove",
			});
			delBtn.addEventListener("click", async () => {
				const now = Date.now();
				await this.updatePaper((p) => {
					const sections = p.sections.filter((s) => s.id !== sec.id);
					const feeds = p.feeds.map((f) =>
						f.sectionId === sec.id
							? { ...f, sectionId: CORRESPONDENCE_SECTION_ID, updatedAt: now }
							: f
					);
					const deletedSections = { ...(p.deletedSections ?? {}), [sec.id]: now };
					return { ...p, sections, feeds, deletedSections };
				}, true);
				this.render();
			});
		}

		// 4. Subscribed Feeds List
		container.createEl("h4", {
			text: isDe
				? `Abonnierte Quellen (${paper.feeds.length})`
				: `Subscribed Publications (${paper.feeds.length})`,
		});

		if (paper.feeds.length === 0) {
			container.createEl("p", {
				text: isDe
					? "Noch keine Quellen eingetragen. Wähle oben eine Adresse oder öffne den Reiter „Starter-Katalog & Desks“."
					: "No publications added yet. Paste an address above or browse Starter Desks.",
			});
			return;
		}

		for (const feed of paper.feeds) {
			const row = container.createDiv({ cls: "op-feed-row" });
			const info = row.createDiv();
			info.createEl("strong", { text: feed.title });
			info.createDiv({
				text: feed.lastError ? `⚠ ${feed.lastError}` : feed.url,
				attr: {
					style: `font-size: 0.78rem; color: ${
						feed.lastError ? "var(--text-error)" : "var(--text-muted)"
					}; word-break: break-all;`,
				},
			});

			const controls = row.createDiv({ cls: "op-utility-group" });
			const deskSelect = controls.createEl("select", { cls: "dropdown" });
			const corrOpt = deskSelect.createEl("option", {
				value: CORRESPONDENCE_SECTION_ID,
				text: isDe ? "Korrespondenz" : "Correspondence",
			});
			if (feed.sectionId === CORRESPONDENCE_SECTION_ID) corrOpt.selected = true;
			for (const sec of paper.sections) {
				const opt = deskSelect.createEl("option", {
					value: sec.id,
					text: localizeDefaultLabel(sec.title, this.uiLang()),
				});
				if (feed.sectionId === sec.id) opt.selected = true;
			}
			deskSelect.addEventListener("change", async () => {
				const now = Date.now();
				await this.updatePaper(
					(p) => ({
						...p,
						feeds: p.feeds.map((f) =>
							f.id === feed.id
								? { ...f, sectionId: deskSelect.value, updatedAt: now }
								: f
						),
					}),
					true
				);
			});

			const toggleBtn = controls.createEl("button", {
				cls: `op-btn ${feed.enabled ? "is-active" : ""}`.trim(),
				text: feed.enabled ? (isDe ? "Aktiv" : "On") : isDe ? "Pausiert" : "Paused",
			});
			toggleBtn.addEventListener("click", async () => {
				const now = Date.now();
				await this.updatePaper(
					(p) => ({
						...p,
						feeds: p.feeds.map((f) =>
							f.id === feed.id ? { ...f, enabled: !f.enabled, updatedAt: now } : f
						),
					}),
					true
				);
				this.render();
			});

			const removeBtn = controls.createEl("button", {
				cls: "op-btn",
				text: "✕",
			});
			removeBtn.addEventListener("click", async () => {
				const now = Date.now();
				const fKey = normalizeFeedKey(feed.url);
				await this.updatePaper(
					(p) => ({
						...p,
						feeds: p.feeds.filter((f) => f.id !== feed.id),
						deletedFeeds: fKey
							? { ...(p.deletedFeeds ?? {}), [fKey]: now }
							: p.deletedFeeds,
					}),
					true
				);
				this.render();
			});
		}
	}

	private renderStarterTab(container: HTMLElement, paper: PaperConfig): void {
		const isDe = this.uiLang() === "de";
		container.createEl("p", {
			text: isDe
				? "Wähle beliebige Publikationen für deine Zeitung aus. Ein Klick fügt sie der passenden Rubrik hinzu oder entfernt sie wieder."
				: "Pick publications to print in your paper. Toggle any source on or off with a single click.",
		});

		const subscribedUrls = new Set(paper.feeds.map((f) => f.url.toLowerCase()));

		for (const cat of STARTER_CATALOG) {
			container.createEl("h4", { text: isDe ? cat.labelDe : cat.labelEn });
			const grid = container.createDiv({ cls: "op-starter-grid" });

			for (const pub of cat.publications) {
				const isAdded = subscribedUrls.has(pub.url.toLowerCase());
				const item = grid.createDiv({ cls: "op-starter-item" });

				const top = item.createDiv();
				top.createEl("strong", { text: pub.title });
				top.createEl("p", {
					text: isDe ? pub.descriptionDe ?? pub.description : pub.description,
					attr: { style: "margin: 4px 0 0; font-size: 0.8rem; color: var(--text-muted);" },
				});

				const actionBtn = item.createEl("button", {
					cls: `op-btn ${isAdded ? "is-active" : ""}`.trim(),
					text: isAdded
						? isDe
							? "✓ Im Blatt (Abwählen)"
							: "✓ Subscribed"
						: isDe
							? "+ Aufnehmen"
							: "+ Add to Paper",
				});

				actionBtn.addEventListener("click", async () => {
					const now = Date.now();
					if (isAdded) {
						const fKey = normalizeFeedKey(pub.url);
						await this.updatePaper(
							(p) => ({
								...p,
								feeds: p.feeds.filter(
									(f) => f.url.toLowerCase() !== pub.url.toLowerCase()
								),
								deletedFeeds: fKey
									? { ...(p.deletedFeeds ?? {}), [fKey]: now }
									: p.deletedFeeds,
							}),
							true
						);
					} else {
						const hasSuggestedSection = paper.sections.some(
							(s) => s.id === pub.suggestedDeskId
						);
						const sectionId = hasSuggestedSection
							? pub.suggestedDeskId
							: paper.sections[0]?.id ?? CORRESPONDENCE_SECTION_ID;
						const newFeed: FeedSource = {
							id: `feed-${now}-${Math.random().toString(36).slice(2, 6)}`,
							title: pub.title,
							url: pub.url,
							siteUrl: pub.siteUrl,
							sectionId,
							enabled: true,
							addedAt: now,
							updatedAt: now,
						};
						await this.updatePaper(
							(p) => ({ ...p, feeds: [...p.feeds, newFeed] }),
							true
						);
					}
					this.render();
				});
			}
		}
	}

	private renderFiltersTab(container: HTMLElement, paper: PaperConfig): void {
		const isDe = this.uiLang() === "de";

		new Setting(container)
			.setName(isDe ? "Beobachtete Themen (Tracked Topics)" : "Tracked Topics")
			.setDesc(
				isDe
					? "Kommagetrennte Begriffe (z. B. Obsidian, KI, Architektur). Treffer werden hervorgehoben und zusätzlich in einer eigenen Themen-Rubrik gebündelt."
					: "Comma-separated keywords highlighted across your paper and collected into a dedicated Tracked Topics desk."
			)
			.addTextArea((ta) => {
				ta.inputEl.rows = 3;
				ta.inputEl.style.width = "100%";
				ta.setValue(paper.trackedTopics.join(", "));
				ta.onChange(async (val) => {
					const list = val
						.split(/[,\n]+/)
						.map((s) => s.trim())
						.filter(Boolean);
					await this.updatePaper((p) => ({ ...p, trackedTopics: list }), true);
				});
			});

		new Setting(container)
			.setName(isDe ? "Stummgeschaltete Begriffe (Muted Keywords)" : "Muted Keywords")
			.setDesc(
				isDe
					? "Artikel mit diesen Begriffen werden beim Drucken der Ausgabe komplett herausgefiltert."
					: "Stories containing any of these words are omitted when compiling your edition."
			)
			.addTextArea((ta) => {
				ta.inputEl.rows = 3;
				ta.inputEl.style.width = "100%";
				ta.setValue(paper.mutedKeywords.join(", "));
				ta.onChange(async (val) => {
					const list = val
						.split(/[,\n]+/)
						.map((s) => s.trim())
						.filter(Boolean);
					await this.updatePaper((p) => ({ ...p, mutedKeywords: list }), true);
				});
			});

		new Setting(container)
			.setName(isDe ? "Zeitfenster (Stunden)" : "Lookback Window (Hours)")
			.setDesc(isDe ? "Standard: 72 Stunden für frische Tagesausgaben." : "Default: 72 hours.")
			.addSlider((sl) =>
				sl
					.setLimits(12, 336, 12)
					.setValue(paper.lookbackHours)
					.setDynamicTooltip()
					.onChange(async (val) => {
						await this.updatePaper((p) => ({ ...p, lookbackHours: val }), true);
					})
			);

		new Setting(container)
			.setName(isDe ? "Max. Artikel pro Quelle" : "Max Stories per Source")
			.addSlider((sl) =>
				sl
					.setLimits(3, 30, 1)
					.setValue(paper.maxArticlesPerFeed)
					.setDynamicTooltip()
					.onChange(async (val) => {
						await this.updatePaper((p) => ({ ...p, maxArticlesPerFeed: val }), true);
					})
			);
	}
}
