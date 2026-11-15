export interface StarterPublication {
	title: string;
	url: string;
	siteUrl: string;
	suggestedDeskId: "dispatches" | "ideas" | "technology" | "design";
	description: string;
	descriptionDe?: string;
}

export interface StarterCategory {
	id: string;
	labelDe: string;
	labelEn: string;
	kind: "region" | "desk";
	publications: StarterPublication[];
}

/**
 * Optional starter feed directory organized by Regions and Editorial Desks,
 * inspired by biblio.ink/times ("Nothing is pre-selected for you").
 */
export const STARTER_CATALOG: StarterCategory[] = [
	{
		id: "region-dach",
		labelDe: "Deutschland, Österreich & Schweiz",
		labelEn: "Germany, Austria & Switzerland",
		kind: "region",
		publications: [
			{
				title: "ZEIT ONLINE",
				url: "https://newsfeed.zeit.de/index",
				siteUrl: "https://www.zeit.de",
				suggestedDeskId: "dispatches",
				description: "Politics, economy, science, and culture from Germany’s weekly.",
				descriptionDe: "Politik, Wirtschaft, Wissen und Feuilleton.",
			},
			{
				title: "tagesschau.de",
				url: "https://www.tagesschau.de/xml/rss2/",
				siteUrl: "https://www.tagesschau.de",
				suggestedDeskId: "dispatches",
				description: "National and international public-service news from ARD.",
				descriptionDe: "Überregionale und internationale Nachrichten der ARD.",
			},
			{
				title: "Süddeutsche Zeitung — Topthemen",
				url: "https://rss.sueddeutsche.de/rss/Topthemen",
				siteUrl: "https://www.sueddeutsche.de",
				suggestedDeskId: "dispatches",
				description: "Editorials, features, and investigative reporting.",
				descriptionDe: "Aktuelle Leitartikel, Reportagen und Analysen.",
			},
			{
				title: "Deutschlandfunk — Nachrichten",
				url: "https://www.deutschlandfunk.de/nachrichten-100.rss",
				siteUrl: "https://www.deutschlandfunk.de",
				suggestedDeskId: "dispatches",
				description: "Concise national and world news dispatches from public radio.",
				descriptionDe: "Kompakte Nachrichtenübersicht aus der Dlf-Redaktion.",
			},
			{
				title: "Neue Zürcher Zeitung — International",
				url: "https://www.nzz.ch/international.rss",
				siteUrl: "https://www.nzz.ch",
				suggestedDeskId: "dispatches",
				description: "International reporting and analysis from Zurich.",
				descriptionDe: "Internationale Berichterstattung und Hintergründe.",
			},
			{
				title: "heise online",
				url: "https://www.heise.de/rss/heise-atom.xml",
				siteUrl: "https://www.heise.de",
				suggestedDeskId: "technology",
				description: "IT news, software engineering, security, and digital policy.",
				descriptionDe: "IT-News, Softwareentwicklung, Sicherheit und Netzwelt.",
			},
			{
				title: "netzpolitik.org",
				url: "https://netzpolitik.org/feed/",
				siteUrl: "https://netzpolitik.org",
				suggestedDeskId: "ideas",
				description: "Digital civil rights, privacy, and technology policy.",
				descriptionDe: "Digitale Freiheitsrechte, Datenschutz und Technologiepolitik.",
			},
			{
				title: "Spektrum.de — Wissenschaft",
				url: "https://www.spektrum.de/alias/rss/spektrum-de-rss-feed/996406",
				siteUrl: "https://www.spektrum.de",
				suggestedDeskId: "technology",
				description: "Research, natural sciences, medicine, and astronomy.",
				descriptionDe: "Forschung, Naturwissenschaften, Medizin und Astronomie.",
			},
			{
				title: "Perlentaucher — Kulturmagazin",
				url: "https://www.perlentaucher.de/rss/perlentaucher.xml",
				siteUrl: "https://www.perlentaucher.de",
				suggestedDeskId: "ideas",
				description: "Daily review of arts sections, book criticism, and essays.",
				descriptionDe: "Feuilleton-Rundschau, Buchkritiken und Essays.",
			},
		],
	},
	{
		id: "region-uk-eu",
		labelDe: "Großbritannien & Europa",
		labelEn: "United Kingdom & Europe",
		kind: "region",
		publications: [
			{
				title: "The Guardian — World",
				url: "https://www.theguardian.com/world/rss",
				siteUrl: "https://www.theguardian.com",
				suggestedDeskId: "dispatches",
				description: "Global reporting, investigations, and commentary.",
			},
			{
				title: "BBC News — World",
				url: "https://feeds.bbci.co.uk/news/world/rss.xml",
				siteUrl: "https://www.bbc.com/news",
				suggestedDeskId: "dispatches",
				description: "International dispatches from BBC correspondents.",
			},
			{
				title: "London Review of Books",
				url: "https://www.lrb.co.uk/feeds/rss",
				siteUrl: "https://www.lrb.co.uk",
				suggestedDeskId: "ideas",
				description: "Literary essays, history, philosophy, and criticism.",
			},
			{
				title: "Le Monde — À la une",
				url: "https://www.lemonde.fr/rss/une.xml",
				siteUrl: "https://www.lemonde.fr",
				suggestedDeskId: "dispatches",
				description: "Actualités internationales, société et culture.",
			},
			{
				title: "Eurozine",
				url: "https://www.eurozine.com/feed/",
				siteUrl: "https://www.eurozine.com",
				suggestedDeskId: "ideas",
				description: "European cultural journals and cross-border essays.",
			},
		],
	},
	{
		id: "region-us-global",
		labelDe: "USA & International",
		labelEn: "United States & International",
		kind: "region",
		publications: [
			{
				title: "NPR News",
				url: "https://feeds.npr.org/1001/rss.xml",
				siteUrl: "https://www.npr.org",
				suggestedDeskId: "dispatches",
				description: "National and international news desk.",
			},
			{
				title: "ProPublica",
				url: "https://www.propublica.org/feeds/propublica/main",
				siteUrl: "https://www.propublica.org",
				suggestedDeskId: "dispatches",
				description: "Independent investigative journalism in the public interest.",
			},
			{
				title: "Rest of World",
				url: "https://restofworld.org/feed/latest/",
				siteUrl: "https://restofworld.org",
				suggestedDeskId: "dispatches",
				description: "Reporting on global technology and culture beyond Silicon Valley.",
			},
			{
				title: "Nippon.com",
				url: "https://www.nippon.com/en/rss-all/",
				siteUrl: "https://www.nippon.com/en/",
				suggestedDeskId: "dispatches",
				description: "Society, politics, architecture, and culture from Japan.",
			},
		],
	},
	{
		id: "desk-ideas",
		labelDe: "Desk: Ideen & Essays",
		labelEn: "Desk: Ideas & Essays",
		kind: "desk",
		publications: [
			{
				title: "Aeon Essays",
				url: "https://aeon.co/feed.rss",
				siteUrl: "https://aeon.co",
				suggestedDeskId: "ideas",
				description: "Deep essays on philosophy, science, psychology, and society.",
			},
			{
				title: "The Marginalian",
				url: "https://www.themarginalian.org/feed/",
				siteUrl: "https://www.themarginalian.org",
				suggestedDeskId: "ideas",
				description: "Literature, art, philosophy, and the search for meaning.",
			},
			{
				title: "Works in Progress",
				url: "https://worksinprogress.co/feed/",
				siteUrl: "https://worksinprogress.co",
				suggestedDeskId: "ideas",
				description: "Longform stories on scientific, civic, and technological progress.",
			},
			{
				title: "Astral Codex Ten",
				url: "https://www.astralcodexten.com/feed",
				siteUrl: "https://www.astralcodexten.com",
				suggestedDeskId: "ideas",
				description: "Essays on science, rationality, medicine, and culture.",
			},
		],
	},
	{
		id: "desk-design",
		labelDe: "Desk: Design, Kunst & Kultur",
		labelEn: "Desk: Design, Art & Culture",
		kind: "desk",
		publications: [
			{
				title: "Colossal",
				url: "https://www.thisiscolossal.com/feed/",
				siteUrl: "https://www.thisiscolossal.com",
				suggestedDeskId: "design",
				description: "Contemporary art, craft, photography, and visual culture.",
			},
			{
				title: "Dezeen",
				url: "https://www.dezeen.com/feed/",
				siteUrl: "https://www.dezeen.com",
				suggestedDeskId: "design",
				description: "Architecture, interiors, and industrial design.",
			},
			{
				title: "It’s Nice That",
				url: "https://www.itsnicethat.com/rss",
				siteUrl: "https://www.itsnicethat.com",
				suggestedDeskId: "design",
				description: "Graphic design, illustration, typography, and creative arts.",
			},
			{
				title: "Kottke.org",
				url: "https://feeds.kottke.org/main",
				siteUrl: "https://kottke.org",
				suggestedDeskId: "design",
				description: "Curated links on art, design, science, and the human web.",
			},
		],
	},
	{
		id: "desk-tech",
		labelDe: "Desk: Technologie & Wissenschaft",
		labelEn: "Desk: Technology & Science",
		kind: "desk",
		publications: [
			{
				title: "Quanta Magazine",
				url: "https://api.quantamagazine.org/feed/",
				siteUrl: "https://www.quantamagazine.org",
				suggestedDeskId: "technology",
				description: "Illuminating basic science, mathematics, physics, and biology.",
			},
			{
				title: "Ars Technica",
				url: "https://feeds.arstechnica.com/arstechnica/index",
				siteUrl: "https://arstechnica.com",
				suggestedDeskId: "technology",
				description: "In-depth technology journalism, hardware, space, and policy.",
			},
			{
				title: "Daring Fireball",
				url: "https://daringfireball.net/feeds/main",
				siteUrl: "https://daringfireball.net",
				suggestedDeskId: "technology",
				description: "John Gruber on Apple, software design, and media.",
			},
			{
				title: "Simon Willison’s Weblog",
				url: "https://simonwillison.net/atom/everything/",
				siteUrl: "https://simonwillison.net",
				suggestedDeskId: "technology",
				description: "AI engineering, open source tools, and web craftsmanship.",
			},
		],
	},
];
