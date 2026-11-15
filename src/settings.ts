import { App, PluginSettingTab, Setting } from "obsidian";
import type ObsidianPressPlugin from "./main";
import { PaperLanguage } from "./types";
import { ManagePaperModal } from "./views/ManagePaperModal";

export class ObsidianPressSettingTab extends PluginSettingTab {
	plugin: ObsidianPressPlugin;

	constructor(app: App, plugin: ObsidianPressPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const isDe = this.plugin.settings.uiLanguage === "de";

		containerEl.createEl("p", {
			cls: "op-settings-lead",
			text: isDe
				? "Deine lokale Morgenzeitung & Magazin-Druckerpresse für RSS-, Atom- und JSON-Feeds – inspiriert von Biblio Times."
				: "Your local morning newspaper and magazine printing press for RSS, Atom, and JSON feeds — inspired by Biblio Times.",
		});

		new Setting(containerEl)
			.setName(isDe ? "Sprache / Language" : "Language")
			.setDesc(
				isDe
					? "Sprache für Benutzeroberfläche, Befehle und Ausgaben (Standard: Englisch)."
					: "Interface, command, and default edition language (default: English)."
			)
			.addDropdown((dd) =>
				dd
					.addOption("en", "English (default)")
					.addOption("de", "Deutsch")
					.setValue(this.plugin.settings.uiLanguage === "de" ? "de" : "en")
					.onChange(async (val) => {
						this.plugin.settings.uiLanguage = (val === "de" ? "de" : "en") as PaperLanguage;
						await this.plugin.saveSettings();
						this.plugin.applyUiLanguage();
						await this.plugin.refreshOpenViews(false);
						this.display();
					})
			);

		const activePaper = this.plugin.getActivePaper();
		new Setting(containerEl)
			.setName(
				isDe
					? "Zeitungen, Quellen, Starter-Desks & OPML verwalten"
					: "Manage papers, sources, starter desks, and OPML"
			)
			.setDesc(
				isDe
					? `Aktive Publikation: „${activePaper.title}“ (${activePaper.feeds.length} abonnierte Quellen)`
					: `Active paper: “${activePaper.title}” (${activePaper.feeds.length} subscribed sources)`
			)
			.addButton((btn) =>
				btn
					.setButtonText(isDe ? "Zeitung öffnen" : "Open paper")
					.onClick(() => {
						void this.plugin.activatePressView();
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText(isDe ? "Redaktion & Quellen…" : "Press room & sources…")
					.setCta()
					.onClick(() => {
						new ManagePaperModal(this.app, {
							getUiLanguage: () => this.plugin.settings.uiLanguage,
							getPapers: () => this.plugin.settings.papers,
							getActivePaper: () => this.plugin.getActivePaper(),
							savePapersAndRefresh: async (
								papers,
								activeId,
								recompile,
								deletedPaperId
							) => {
								await this.plugin.savePapersFromModal(
									papers,
									activeId,
									recompile,
									deletedPaperId
								);
								this.display();
							},
						}).open();
					})
			);

		new Setting(containerEl)
			.setName(isDe ? "Clippings & Vault-Integration" : "Clippings & vault integration")
			.setHeading();

		new Setting(containerEl)
			.setName(isDe ? "Clippings-Ordner" : "Clippings folder")
			.setDesc(
				isDe
					? "Zielordner im Vault, in dem geclippte Artikel & Textstellen als Markdown-Notizen (mit Web-Clipper-kompatiblem Frontmatter) abgelegt werden."
					: "Vault folder where clipped articles and highlighted quotes are saved as Markdown notes (with Obsidian Web Clipper-compatible frontmatter)."
			)
			.addText((txt) =>
				txt
					.setPlaceholder("Clippings")
					.setValue(this.plugin.settings.clippingsFolder)
					.onChange(async (val) => {
						this.plugin.settings.clippingsFolder = val.trim() || "Clippings";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(
				isDe
					? "Geräteübergreifender Sync (Obsidian Sync)"
					: "Cross-device sync (Obsidian Sync)"
			)
			.setHeading();

		new Setting(containerEl)
			.setName(
				isDe
					? "Zeilenbasierte Vault-Sync-Datei aktivieren"
					: "Enable line-based vault sync ledger"
			)
			.setDesc(
				isDe
					? "Synchronisiert abonnierte Quellen, Zeitungen, Rubriken, Clippings, gelesene Artikel und den exakten Absatz-Lesefortschritt konfliktfrei über alle Geräte mittels Obsidian Sync."
					: "Synchronizes subscribed sources, papers, desks, clippings, read status, and paragraph-accurate reading progress conflict-free across devices via Obsidian Sync."
			)
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.syncLedgerEnabled).onChange(async (val) => {
					this.plugin.settings.syncLedgerEnabled = val;
					await this.plugin.saveSettings();
					if (val) {
						await this.plugin.readingSync.initializeFromVault();
					}
				})
			);

		new Setting(containerEl)
			.setName(isDe ? "Pfad der Sync-Datei im Vault" : "Vault sync ledger path")
			.setDesc(
				isDe
					? "Kein führender Punkt im Dateinamen, damit Obsidian Sync die Datei auf allen Geräten überträgt und zeilenweise zusammenführt."
					: "Keep without a leading dot so Obsidian Sync syncs and merges the file line-by-line across all devices."
			)
			.addText((txt) =>
				txt
					.setPlaceholder("morning-press-sync.md")
					.setValue(this.plugin.settings.syncLedgerPath)
					.onChange(async (val) => {
						this.plugin.settings.syncLedgerPath =
							val.trim() || "morning-press-sync.md";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(
				isDe
					? "Aufbewahrungsdauer des Lese-Verlaufs (Tage)"
					: "Reading history retention (days)"
			)
			.setDesc(
				isDe
					? "Ältere Einträge werden automatisch bereinigt, um die Sync-Datei schlank zu halten."
					: "Older entries are pruned automatically to keep the sync ledger compact."
			)
			.addSlider((sl) =>
				sl
					.setLimits(14, 180, 7)
					.setValue(this.plugin.settings.retentionDays)
					.setDynamicTooltip()
					.onChange(async (val) => {
						this.plugin.settings.retentionDays = val;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(isDe ? "Lesemodus, Optik & Morgenroutine" : "Reader, typography, and morning routine")
			.setHeading();

		new Setting(containerEl)
			.setName(
				isDe
					? "Volltext beim Öffnen eines Artikels automatisch laden"
					: "Automatically fetch full article text on open"
			)
			.setDesc(
				isDe
					? "Lädt beim Öffnen eines Artikels im Reader automatisch den kompletten Artikeltext nach, statt nur den RSS-Anriss anzuzeigen."
					: "Automatically extracts the complete article text when opening a story in the reader instead of showing only the feed excerpt."
			)
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.autoFetchFullText).onChange(async (val) => {
					this.plugin.settings.autoFetchFullText = val;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(
				isDe
					? "Morgenausgabe beim ersten Start des Tages automatisch öffnen"
					: "Auto-open morning edition on first launch of the day"
			)
			.setDesc(
				isDe
					? "Öffnet deine Morgenausgabe einmal pro Kalendertag automatisch in einem neuen Tab."
					: "Opens your morning edition automatically once per calendar day."
			)
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.autoOpenMorning).onChange(async (val) => {
					this.plugin.settings.autoOpenMorning = val;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(
				isDe
					? "Ausgaben-Archiv (Fortnight Rack in Tagen)"
					: "Back-issue archive (fortnight rack days)"
			)
			.setDesc(
				isDe
					? "Anzahl vergangener Tagesausgaben, die lokal zum Nachblättern vorgehalten werden (Standard: 14 Tage)."
					: "Number of past daily editions kept locally on the back-issue rack (default: 14 days)."
			)
			.addSlider((sl) =>
				sl
					.setLimits(3, 30, 1)
					.setValue(this.plugin.settings.fortnightDays)
					.setDynamicTooltip()
					.onChange(async (val) => {
						this.plugin.settings.fortnightDays = val;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(
				isDe
					? "Gelesene Artikel im Satz dezent abblenden"
					: "Dim read stories in layout"
			)
			.setDesc(
				isDe
					? "Reduziert die Druckfarb-Deckkraft bereits gelesener Überschriften leicht."
					: "Slightly reduces ink contrast on stories you have already read."
			)
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.dimReadArticles).onChange(async (val) => {
					this.plugin.settings.dimReadArticles = val;
					await this.plugin.saveSettings();
					await this.plugin.refreshOpenViews(false);
				})
			);

		new Setting(containerEl)
			.setName(
				isDe
					? "Halftone-Rasterweite (Punktgröße)"
					: "Halftone screen pitch (dot size)"
			)
			.setDesc(
				isDe
					? "Steuert die Feinheit des 45°-Zeitungs-Punktrasters (kleiner = feineres Raster, größer = markanter Vintage-Druck)."
					: "Controls the coarseness of the 45° newsprint halftone screen (smaller = finer screen, larger = bolder vintage print)."
			)
			.addSlider((sl) =>
				sl
					.setLimits(2.5, 6.0, 0.2)
					.setValue(this.plugin.settings.halftoneDotSize)
					.setDynamicTooltip()
					.onChange(async (val) => {
						this.plugin.settings.halftoneDotSize = val;
						await this.plugin.saveSettings();
						await this.plugin.refreshOpenViews(false);
					})
			);

		new Setting(containerEl)
			.setName(
				isDe
					? "Kuratierte Zeitungs-Webfonts laden (Fraunces, Newsreader, Courier Prime)"
					: "Load editorial webfonts (Fraunces, Newsreader, Courier Prime)"
			)
			.setDesc(
				isDe
					? "Nutzt bei bestehender Internetverbindung die Original-Schriften mit nahtlosem Fallback auf lokale Systemschriften im Offline-Betrieb."
					: "Loads the original editorial typefaces when online, falling back seamlessly to local system fonts when offline."
			)
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.loadGoogleFonts).onChange(async (val) => {
					this.plugin.settings.loadGoogleFonts = val;
					await this.plugin.saveSettings();
					await this.plugin.refreshOpenViews(false);
				})
			);
	}
}
