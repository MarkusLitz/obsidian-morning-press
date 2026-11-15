import assert from "node:assert/strict";
import test from "node:test";
import esbuild from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Bundle pure TypeScript modules into a temporary ESM module so we test the exact production code!
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-press-test-"));
const obsidianStubFile = path.join(tmpDir, "obsidian-stub.ts");
const entryFile = path.join(tmpDir, "bundle-entry.ts");
const outFile = path.join(tmpDir, "bundle.mjs");

fs.writeFileSync(
	obsidianStubFile,
	`
export class TFile { path = ""; }
export class TAbstractFile { path = ""; }
export function normalizePath(p: string): string { return p.replace(/\\\\+/g, "/").replace(/\\/+/g, "/"); }
export async function requestUrl(): Promise<never> { throw new Error("Network stub"); }
`
);

fs.writeFileSync(
	entryFile,
	`
export * from "${path.resolve("src/types.ts")}";
export * from "${path.resolve("src/i18n.ts")}";
export * from "${path.resolve("src/feeds/parser.ts")}";
export { extractFeedLinksFromHtml } from "${path.resolve("src/feeds/discovery.ts")}";
export * from "${path.resolve("src/feeds/opml.ts")}";
export * from "${path.resolve("src/press/compiler.ts")}";
export {
	normalizeFeedKey,
	mergeReadingEntries,
	mergeReadingStateMaps,
	mergePaperCollections,
	serializeSyncLedger,
	parseSyncLedger,
	serializeFullSyncLedger,
	parseFullSyncLedger,
} from "${path.resolve("src/sync/readingSync.ts")}";
export {
	htmlToCleanMarkdown,
	buildClippingMarkdown,
	sanitizeNoteFileName,
} from "${path.resolve("src/clipper/vaultClipper.ts")}";
`
);

await esbuild.build({
	entryPoints: [entryFile],
	bundle: true,
	format: "esm",
	platform: "node",
	alias: { obsidian: obsidianStubFile },
	outfile: outFile,
});

const mod = await import(outFile);

test("Cross-device canonical articleKey normalizes tracking parameters, protocols, and www", () => {
	const keyDesktop = mod.computeArticleKey(
		"http://www.ZEIT.de/wissen/2026-11/quantenphysik/?utm_source=rss&utm_medium=feed&fbclid=abc123#kommentare"
	);
	const keyMobile = mod.computeArticleKey(
		"https://zeit.de/wissen/2026-11/quantenphysik"
	);
	assert.equal(keyDesktop, keyMobile);
	assert.match(keyDesktop, /^art_[0-9a-f]{16}$/);
});

test("RSS 2.0, Atom 1.0, and JSON Feed 1.1 parse cleanly with images & sanitization", () => {
	const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
	<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
		<channel>
			<title>Morning Dispatch</title>
			<link>https://dispatch.example.org</link>
			<item>
				<title>Die Rückkehr des Bleisatzes &amp; der Druckkunst</title>
				<link>https://dispatch.example.org/stories/bleisatz?utm_campaign=morning</link>
				<dc:creator>Clara Zetkin</dc:creator>
				<pubDate>Sun, 15 Nov 2026 07:30:00 GMT</pubDate>
				<media:content url="https://dispatch.example.org/img/press.jpg" medium="image" />
				<content:encoded><![CDATA[<p>Ein ausführlicher Bericht über Typografie.</p><script>alert(1)</script>]]></content:encoded>
			</item>
		</channel>
	</rss>`;

	const rss = mod.parseFeedContent(rssXml, "https://dispatch.example.org/rss.xml");
	assert.equal(rss.title, "Morning Dispatch");
	assert.equal(rss.items.length, 1);
	assert.equal(rss.items[0].title, "Die Rückkehr des Bleisatzes & der Druckkunst");
	assert.equal(rss.items[0].author, "Clara Zetkin");
	assert.equal(rss.items[0].imageUrl, "https://dispatch.example.org/img/press.jpg");
	assert.ok(!rss.items[0].contentHtml.includes("<script>"));

	const atomXml = `<?xml version="1.0" encoding="utf-8"?>
	<feed xmlns="http://www.w3.org/2005/Atom">
		<title>Atom Science</title>
		<link href="https://science.example.org/" rel="alternate" />
		<entry>
			<title>Deep Ocean Optics</title>
			<id>tag:science.example.org,2026:101</id>
			<link href="/articles/ocean-optics" rel="alternate" />
			<updated>2026-11-15T08:00:00Z</updated>
			<author><name>Dr. Nemo</name></author>
			<content type="html">&lt;p&gt;Bioluminescence in abyssal trenches.&lt;/p&gt;&lt;img src="/media/jelly.png" alt="Jellyfish"/&gt;</content>
		</entry>
	</feed>`;

	const atom = mod.parseFeedContent(atomXml, "https://science.example.org/atom.xml");
	assert.equal(atom.title, "Atom Science");
	assert.equal(atom.items.length, 1);
	assert.equal(atom.items[0].url, "https://science.example.org/articles/ocean-optics");
	assert.equal(atom.items[0].imageUrl, "https://science.example.org/media/jelly.png");

	const jsonFeed = JSON.stringify({
		version: "https://jsonfeed.org/version/1.1",
		title: "Design Notes",
		home_page_url: "https://design.example.com",
		items: [
			{
				id: "post-1",
				url: "https://design.example.com/grids",
				title: "Swiss Grids in Digital Print",
				content_html: "<p>Modular systems in editorial design.</p>",
				image: "https://design.example.com/grid.webp",
				date_published: "2026-11-15T06:00:00Z",
			},
		],
	});

	const jf = mod.parseFeedContent(jsonFeed, "https://design.example.com/feed.json");
	assert.equal(jf.title, "Design Notes");
	assert.equal(jf.items[0].title, "Swiss Grids in Digital Print");
	assert.equal(jf.items[0].imageUrl, "https://design.example.com/grid.webp");
});

test("HTML autodiscovery finds alternate RSS and Atom feed links", () => {
	const html = `
		<html><head>
			<link rel="stylesheet" href="/main.css">
			<link rel="alternate" type="application/rss+xml" title="RSS" href="/feeds/main.xml">
			<link rel="alternate" type="application/atom+xml" title="Atom" href="https://blog.example.com/atom.xml">
		</head><body></body></html>
	`;
	const links = mod.extractFeedLinksFromHtml(html, "https://blog.example.com/about");
	assert.deepEqual(links, [
		"https://blog.example.com/feeds/main.xml",
		"https://blog.example.com/atom.xml",
	]);
});

test("OPML import and export preserves desks and Correspondence feeds", () => {
	const paper = mod.createDefaultPaper("en");
	paper.feeds = [
		{
			id: "f1",
			title: "Aeon",
			url: "https://aeon.co/feed.rss",
			siteUrl: "https://aeon.co",
			sectionId: "ideas",
			enabled: true,
			addedAt: 1,
		},
		{
			id: "f2",
			title: "Personal Blog",
			url: "https://friend.example.com/rss",
			sectionId: "correspondence",
			enabled: true,
			addedAt: 2,
		},
	];

	const xml = mod.exportPaperToOpml(paper);
	const parsed = mod.parseOpml(xml);
	assert.equal(parsed.groups.length, 2);
	const ideasGroup = parsed.groups.find((g) => g.title === "Ideas");
	const corrGroup = parsed.groups.find((g) => g.isDefaultCorrespondence);
	assert.equal(ideasGroup.feeds[0].xmlUrl, "https://aeon.co/feed.rss");
	assert.equal(corrGroup.feeds[0].xmlUrl, "https://friend.example.com/rss");
});

test("Press compiler selects illustrated lead, filters muted keywords, tracks topics, and handles Sunday magazine", () => {
	const now = Date.parse("2026-11-15T09:00:00Z"); // 2026-11-15 is a Sunday (day 0)!
	const paper = mod.createDefaultPaper("de");
	paper.magazineDays = [0];
	paper.trackedTopics = ["Architektur"];
	paper.mutedKeywords = ["Kryptoscam"];

	const s1 = { id: "s1", title: "ZEIT", url: "https://zeit.de/rss", sectionId: "dispatches", enabled: true, addedAt: 1 };
	const s2 = { id: "s2", title: "Blog", url: "https://blog.de/rss", sectionId: "correspondence", enabled: true, addedAt: 2 };

	const batches = [
		{
			source: s1,
			parsed: {
				title: "ZEIT",
				items: [
					{
						articleKey: "art_1111111111111111",
						guid: "1",
						title: "Neue Holz-Architektur in den Alpen",
						url: "https://zeit.de/1",
						publishedAt: now - 3600_000,
						contentHtml: "<p>Nachhaltiges Bauen im Gebirge mit lokalem Holz.</p>",
						plainText: "Nachhaltiges Bauen im Gebirge mit lokalem Holz.",
						excerpt: "Nachhaltiges Bauen im Gebirge mit lokalem Holz.",
						imageUrl: "https://zeit.de/alpen.jpg",
						wordCount: 450,
						readingMinutes: 2,
					},
					{
						articleKey: "art_2222222222222222",
						guid: "2",
						title: "Vorsicht vor neuem Kryptoscam",
						url: "https://zeit.de/2",
						publishedAt: now - 1800_000,
						contentHtml: "<p>Spam.</p>",
						plainText: "Spam.",
						excerpt: "Spam.",
						wordCount: 100,
						readingMinutes: 1,
					},
				],
			},
		},
		{
			source: s2,
			parsed: {
				title: "Blog",
				items: [
					{
						articleKey: "art_3333333333333333",
						guid: "3",
						title: "Brief aus Wien",
						url: "https://blog.de/3",
						publishedAt: now - 7200_000,
						contentHtml: "<p>Kaffeehaus-Notizen am Morgen.</p>",
						plainText: "Kaffeehaus-Notizen am Morgen.",
						excerpt: "Kaffeehaus-Notizen am Morgen.",
						wordCount: 250,
						readingMinutes: 1,
					},
				],
			},
		},
	];

	const issue = mod.compileEditionFromBatches(paper, batches, now, 1);
	assert.equal(issue.formatUsed, "magazine"); // Sunday auto-magazine!
	assert.equal(issue.totalArticles, 2); // Muted keyword excluded!
	assert.equal(issue.leadStory.articleKey, "art_1111111111111111");
	assert.ok(issue.sections.some((s) => s.isTrackedTopicSection && s.articles.length === 1));
	assert.ok(issue.sections.some((s) => s.isCorrespondence && s.articles[0].title === "Brief aus Wien"));
});

test("Cross-device LWW Reading Sync merges offline Desktop & Mobile edits without data loss", () => {
	const now = Date.now();
	const desktopState = {
		art_aaaa: {
			articleKey: "art_aaaa",
			status: "read",
			progress: 1,
			paragraphIndex: 14,
			title: "Desktop Read Story",
			updatedAt: now - 5000,
			readAt: now - 5000,
		},
		art_shared: {
			articleKey: "art_shared",
			status: "reading",
			progress: 0.35,
			paragraphIndex: 4,
			title: "Shared Essay",
			url: "https://aeon.co/essay",
			updatedAt: now - 10_000,
		},
	};

	const mobileState = {
		art_bbbb: {
			articleKey: "art_bbbb",
			status: "reading",
			progress: 0.62,
			paragraphIndex: 9,
			title: "Mobile Train Story",
			url: "https://zeit.de/zug",
			updatedAt: now - 2000,
		},
		art_shared: {
			articleKey: "art_shared",
			status: "reading",
			progress: 0.78,
			paragraphIndex: 11,
			title: "Shared Essay",
			url: "https://aeon.co/essay",
			updatedAt: now - 1000, // Newer on mobile!
		},
	};

	const { merged, changed } = mod.mergeReadingStateMaps(desktopState, mobileState, 60, now);
	assert.equal(changed, true);
	assert.equal(merged.art_aaaa.status, "read");
	assert.equal(merged.art_bbbb.progress, 0.62);
	assert.equal(merged.art_shared.progress, 0.78);
	assert.equal(merged.art_shared.paragraphIndex, 11);

	// Test Markdown Sync Ledger round-trip + simulated Obsidian Sync duplicate-line auto-merge
	const ledgerA = mod.serializeSyncLedger(desktopState);
	const ledgerB = mod.serializeSyncLedger(mobileState);
	const concatenatedSyncMerge = `${ledgerA}\n${ledgerB}`;
	const parsedMerged = mod.parseSyncLedger(concatenatedSyncMerge);

	assert.equal(parsedMerged.art_aaaa.status, "read");
	assert.equal(parsedMerged.art_bbbb.paragraphIndex, 9);
	assert.equal(parsedMerged.art_shared.progress, 0.78);
});

test("Vault Clipper builds Web-Clipper-compatible frontmatter and clean Markdown", () => {
	const article = {
		articleKey: "art_clip1",
		id: "1",
		feedId: "f1",
		feedTitle: "Quanta Magazine",
		sectionId: "technology",
		sectionTitle: "Technologie & Wissen",
		title: 'Wie „Quanten-Gitter" funktionieren: Ein Überblick',
		author: "Natalie Wolchover",
		url: "https://www.quantamagazine.org/lattices",
		publishedAt: Date.parse("2026-11-14T10:00:00Z"),
		excerpt: "Eine Einführung in topologische Quantengitter.",
		contentHtml: '<h2>Grundlagen</h2><p>Das ist <strong>wichtig</strong> und <a href="/mehr">weiterführend</a>.</p>',
		plainText: "Grundlagen Das ist wichtig und weiterführend.",
		readingMinutes: 5,
		wordCount: 1000,
		matchedTopics: [],
		score: 1,
	};

	const md = mod.buildClippingMarkdown({
		article,
		createdDate: "2026-11-15",
		selectedQuote: "Topologische Zustände sind erstaunlich robust.",
	});

	assert.match(md, /^---\ntitle: "Wie „Quanten-Gitter\\" funktionieren: Ein Überblick"/);
	assert.match(md, /source: "https:\/\/www\.quantamagazine\.org\/lattices"/);
	assert.match(md, /tags:\n  - "clippings"\n---/);
	assert.match(md, /> Topologische Zustände sind erstaunlich robust\./);
	assert.match(md, /## Grundlagen/);
	assert.match(md, /\*\*wichtig\*\*/);
	assert.match(md, /\[weiterführend\]\(https:\/\/www\.quantamagazine\.org\/mehr\)/);

	const safeName = mod.sanitizeNoteFileName(article.title);
	assert.ok(!safeName.includes(":"));
	assert.ok(!safeName.includes('"'));
});

test("Parser cleans ZEIT 'None' & Tagesschau '[mehr]' artifacts and compiler prefers real prose over empty ticker stubs", () => {
	const zeitRss = `<?xml version="1.0" encoding="UTF-8"?>
	<rss version="2.0">
		<channel>
			<title>ZEIT ONLINE</title>
			<link>https://www.zeit.de</link>
			<item>
				<title>Kurzmeldung ohne Text</title>
				<link>https://www.zeit.de/news/kurz</link>
				<author>DIE ZEIT: News -</author>
				<description><![CDATA[<a href="https://www.zeit.de/news/kurz"><img src="https://img.zeit.de/wide__148x84"></a> None]]></description>
			</item>
			<item>
				<title>Ausführlicher Leitartikel</title>
				<link>https://www.zeit.de/politik/leitartikel</link>
				<description><![CDATA[<p>Dies ist ein echter journalistischer Anriss mit genügend Wörtern für die Titelseite unserer Morgenausgabe. [<a href="https://www.zeit.de/politik/leitartikel">mehr</a>]</p>]]></description>
			</item>
		</channel>
	</rss>`;

	const parsed = mod.parseFeedContent(zeitRss, "https://newsfeed.zeit.de/index");
	assert.equal(parsed.items[0].excerpt, "");
	assert.equal(parsed.items[0].author, "DIE ZEIT: News");
	assert.ok(!parsed.items[1].excerpt.includes("[mehr]"));

	const paper = mod.createDefaultPaper("de");
	const s1 = { id: "s1", title: "ZEIT", url: "https://newsfeed.zeit.de/index", sectionId: "dispatches", enabled: true, addedAt: 1 };
	const issue = mod.compileEditionFromBatches(paper, [{ source: s1, parsed }], Date.now(), 1);
	assert.equal(issue.leadStory.title, "Ausführlicher Leitartikel");
});

test("Cross-device Paper & Feed Sync adopts configured sources on fresh devices, merges concurrent feeds, and honors tombstones", () => {
	const now = Date.now();

	// 1. Device A has configured feeds (including legacy data.json without explicit updatedAt)
	const deviceAPaper = mod.createDefaultPaper("de");
	delete deviceAPaper.updatedAt; // simulate existing pre-upgrade data.json
	deviceAPaper.title = "Meine Morgenpost";
	deviceAPaper.feeds = [
		{
			id: "f-zeit",
			title: "ZEIT ONLINE",
			url: "https://newsfeed.zeit.de/index",
			sectionId: "dispatches",
			enabled: true,
			addedAt: now - 50_000,
		},
		{
			id: "f-tagesschau",
			title: "tagesschau.de",
			url: "https://www.tagesschau.de/xml/rss2/",
			sectionId: "dispatches",
			enabled: true,
			addedAt: now - 40_000,
		},
	];

	// 2. Fresh Device B just installed the plugin (empty default paper, updatedAt: 0)
	const freshDeviceBPaper = mod.createDefaultPaper("de");
	assert.equal(freshDeviceBPaper.updatedAt, 0);
	assert.equal(freshDeviceBPaper.feeds.length, 0);

	const initialSync = mod.mergePaperCollections({
		localPapers: [freshDeviceBPaper],
		incomingPapers: [deviceAPaper],
		retentionDays: 60,
		now,
	});
	assert.equal(initialSync.feedsChanged, true);
	assert.equal(initialSync.papers[0].title, "Meine Morgenpost");
	assert.equal(initialSync.papers[0].feeds.length, 2);

	// 3. Concurrent offline edits: Desktop adds Heise + custom desk, Mobile adds Quanta & deletes tagesschau
	const desktopPaper = structuredClone(initialSync.papers[0]);
	desktopPaper.updatedAt = now - 3000;
	desktopPaper.sections.push({
		id: "desk-ki",
		title: "KI & Forschung",
		order: desktopPaper.sections.length,
		updatedAt: now - 3000,
	});
	desktopPaper.feeds.push({
		id: "f-heise",
		title: "heise online",
		url: "https://www.heise.de/rss/heise-atom.xml",
		sectionId: "desk-ki",
		enabled: true,
		addedAt: now - 3000,
		updatedAt: now - 3000,
	});

	const mobilePaper = structuredClone(initialSync.papers[0]);
	mobilePaper.updatedAt = now - 1000;
	const tsKey = mod.normalizeFeedKey("https://www.tagesschau.de/xml/rss2/");
	mobilePaper.feeds = mobilePaper.feeds.filter((f) => mod.normalizeFeedKey(f.url) !== tsKey);
	mobilePaper.deletedFeeds = { [tsKey]: now - 1000 };
	mobilePaper.feeds.push({
		id: "f-quanta",
		title: "Quanta Magazine",
		url: "https://www.quantamagazine.org/feed/",
		sectionId: "technology",
		enabled: true,
		addedAt: now - 1000,
		updatedAt: now - 1000,
	});

	// Simulate Obsidian Sync concatenating lines from both devices in obsidian-press-sync.md
	const ledgerDesktop = mod.serializeFullSyncLedger({
		papers: [desktopPaper],
		deletedPapers: {},
		clips: {},
		readingState: {},
	});
	const ledgerMobile = mod.serializeFullSyncLedger({
		papers: [mobilePaper],
		deletedPapers: {},
		clips: {},
		readingState: {},
	});

	const parsedCombined = mod.parseFullSyncLedger(`${ledgerDesktop}\n${ledgerMobile}`);
	assert.equal(parsedCombined.papers.length, 1);
	const finalPaper = parsedCombined.papers[0];
	const feedUrls = finalPaper.feeds.map((f) => f.title).sort();

	// Both Heise (Desktop) and Quanta (Mobile) + ZEIT survive, while deleted tagesschau stays deleted!
	assert.deepEqual(feedUrls, ["Quanta Magazine", "ZEIT ONLINE", "heise online"]);
	assert.ok(finalPaper.sections.some((s) => s.id === "desk-ki"));
});

test("Language defaults to English and supports selectable switching + per-paper overrides", () => {
	assert.equal(mod.DEFAULT_SETTINGS.uiLanguage, "en");
	const defaultPaper = mod.createDefaultPaper();
	assert.equal(defaultPaper.language, "en");
	assert.equal(defaultPaper.subtitle, "Morning Edition");
	assert.equal(defaultPaper.sections[0].title, "Dispatches");

	// Follows global uiLanguage by default
	assert.equal(mod.resolvePaperLanguage(defaultPaper, "en"), "en");
	assert.equal(mod.resolvePaperLanguage(defaultPaper, "de"), "de");

	// Factory default labels localize cleanly while custom labels stay untouched
	assert.equal(mod.localizeDefaultLabel("Morgenausgabe", "en"), "Morning Edition");
	assert.equal(mod.localizeDefaultLabel("Nachrichten & Welt", "en"), "Dispatches");
	assert.equal(mod.localizeDefaultLabel("My Custom Desk", "de"), "My Custom Desk");

	// Per-paper languageOverride takes precedence when explicitly chosen
	const germanOverridePaper = { ...defaultPaper, languageOverride: "de" };
	assert.equal(mod.resolvePaperLanguage(germanOverridePaper, "en"), "de");
});

test.after(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});
