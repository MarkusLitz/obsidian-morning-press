import { toDateKey, t } from "../i18n";
import {
	CORRESPONDENCE_SECTION_ID,
	CompiledSection,
	EditionIssue,
	FeedSource,
	PaperConfig,
	PaperFormatMode,
	PressArticle,
	TRACKED_TOPICS_SECTION_ID,
} from "../types";
import { ParsedFeed } from "../feeds/parser";

export interface FetchedFeedBatch {
	source: FeedSource;
	parsed?: ParsedFeed;
	error?: string;
}

/**
 * Resolves whether a paper should print as a newspaper or magazine on the given date.
 */
export function resolveEffectiveFormat(paper: PaperConfig, date = new Date()): PaperFormatMode {
	if (paper.formatMode === "magazine") return "magazine";
	if (Array.isArray(paper.magazineDays) && paper.magazineDays.includes(date.getDay())) {
		return "magazine";
	}
	return "newspaper";
}

/**
 * Pure typesetting & editorial layout compiler ("The Press").
 * Filters, deduplicates, scores lead stories, balances front-page source variety,
 * and organizes sections + Correspondence + Tracked Topics.
 */
export function compileEditionFromBatches(
	paper: PaperConfig,
	batches: FetchedFeedBatch[],
	now = Date.now(),
	issueNumber = Math.max(1, paper.issueCounter + 1)
): EditionIssue {
	const compileDate = new Date(now);
	const dateKey = toDateKey(compileDate);
	const formatUsed = resolveEffectiveFormat(paper, compileDate);
	const cutoffMs = now - Math.max(12, paper.lookbackHours) * 3600 * 1000;

	const mutedLower = paper.mutedKeywords
		.map((k) => k.trim().toLowerCase())
		.filter(Boolean);
	const trackedClean = paper.trackedTopics
		.map((k) => k.trim())
		.filter(Boolean);

	const sectionMap = new Map<string, { title: string; order: number }>();
	for (const sec of paper.sections) {
		sectionMap.set(sec.id, { title: sec.title, order: sec.order });
	}
	const correspondenceTitle = t(paper.language, "correspondence");

	const feedErrors: Array<{ feedTitle: string; error: string }> = [];
	const allCandidates: PressArticle[] = [];
	const fallbackCandidates: PressArticle[] = [];
	const seenKeys = new Set<string>();
	const seenTitles = new Set<string>();

	for (const batch of batches) {
		const { source, parsed, error } = batch;
		if (error || !parsed) {
			if (error) {
				feedErrors.push({ feedTitle: source.title || source.url, error });
			}
			continue;
		}

		const feedTitle = source.title?.trim() || parsed.title?.trim() || source.url;
		const hasValidSection = sectionMap.has(source.sectionId);
		const sectionId = hasValidSection ? source.sectionId : CORRESPONDENCE_SECTION_ID;
		const sectionTitle = hasValidSection
			? sectionMap.get(source.sectionId)!.title
			: correspondenceTitle;

		const limitedItems = parsed.items.slice(0, Math.max(1, paper.maxArticlesPerFeed));
		for (const item of limitedItems) {
			if (seenKeys.has(item.articleKey)) continue;
			const normTitle = item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
			if (normTitle.length > 14 && seenTitles.has(normTitle)) continue;

			const searchableText = `${item.title} ${item.subtitle ?? ""} ${item.plainText}`.toLowerCase();
			if (mutedLower.some((kw) => searchableText.includes(kw))) {
				continue;
			}

			const matchedTopics = trackedClean.filter((topic) =>
				searchableText.includes(topic.toLowerCase())
			);

			const ageHours = Math.max(0, (now - item.publishedAt) / (3600 * 1000));
			const recencyScore = Math.max(0.15, 1 - ageHours / Math.max(24, paper.lookbackHours * 1.25));
			const imageBonus = item.imageUrl ? 0.34 : 0;
			const proseBonus =
				item.wordCount >= 180
					? 0.36
					: item.wordCount >= 40
						? 0.24
						: item.wordCount >= 12
							? 0.14
							: -0.35; // Penalize headline-only ticker stubs without summary text
			const topicBonus = matchedTopics.length > 0 ? 0.2 : 0;
			const score = recencyScore + imageBonus + proseBonus + topicBonus;

			const pressArticle: PressArticle = {
				articleKey: item.articleKey,
				id: item.guid,
				feedId: source.id,
				feedTitle,
				sectionId,
				sectionTitle,
				title: item.title,
				subtitle: item.subtitle,
				author: item.author,
				url: item.url,
				publishedAt: item.publishedAt,
				excerpt: item.excerpt,
				contentHtml: item.contentHtml,
				plainText: item.plainText,
				imageUrl: item.imageUrl,
				imageCaption: item.imageCaption,
				readingMinutes: item.readingMinutes,
				wordCount: item.wordCount,
				matchedTopics,
				score,
			};

			seenKeys.add(item.articleKey);
			if (normTitle.length > 14) seenTitles.add(normTitle);

			if (item.publishedAt >= cutoffMs) {
				allCandidates.push(pressArticle);
			} else {
				fallbackCandidates.push(pressArticle);
			}
		}
	}

	// If lookback window yielded very few articles (e.g. weekly/monthly essay blogs),
	// top up gracefully from the freshest recent items so the edition still reads well.
	let workingPool = [...allCandidates];
	if (workingPool.length < 6 && fallbackCandidates.length > 0) {
		fallbackCandidates.sort((a, b) => b.publishedAt - a.publishedAt);
		workingPool = [...workingPool, ...fallbackCandidates.slice(0, 18 - workingPool.length)];
	}

	workingPool.sort((a, b) => b.score - a.score || b.publishedAt - a.publishedAt);

	// Select Front Page stories with source diversity
	let leadStory: PressArticle | null = null;
	const secondaryLeads: PressArticle[] = [];
	const belowFoldStories: PressArticle[] = [];

	if (workingPool.length > 0) {
		// Prefer a top-scoring story with both an image and actual summary prose for the main front-page banner
		const topWithImage = workingPool
			.slice(0, 5)
			.find((a) => Boolean(a.imageUrl) && a.wordCount >= 12);
		leadStory = topWithImage ?? workingPool[0];

		const frontPageUsed = new Set<string>([leadStory.articleKey]);
		const sourceCounts = new Map<string, number>([[leadStory.feedId, 1]]);

		// Pick up to 2 secondary above-the-fold stories preferring distinct publications
		for (const candidate of workingPool) {
			if (frontPageUsed.has(candidate.articleKey)) continue;
			const countForSource = sourceCounts.get(candidate.feedId) ?? 0;
			if (countForSource >= 1 && workingPool.length > 5) continue;
			secondaryLeads.push(candidate);
			frontPageUsed.add(candidate.articleKey);
			sourceCounts.set(candidate.feedId, countForSource + 1);
			if (secondaryLeads.length >= 2) break;
		}
		// Fill secondaryLeads if single-feed paper
		if (secondaryLeads.length < 2) {
			for (const candidate of workingPool) {
				if (frontPageUsed.has(candidate.articleKey)) continue;
				secondaryLeads.push(candidate);
				frontPageUsed.add(candidate.articleKey);
				if (secondaryLeads.length >= 2) break;
			}
		}

		// Pick up to 6 below-the-fold stories across sections
		for (const candidate of workingPool) {
			if (frontPageUsed.has(candidate.articleKey)) continue;
			const countForSource = sourceCounts.get(candidate.feedId) ?? 0;
			if (countForSource >= 2 && workingPool.length > 10) continue;
			belowFoldStories.push(candidate);
			frontPageUsed.add(candidate.articleKey);
			sourceCounts.set(candidate.feedId, countForSource + 1);
			if (belowFoldStories.length >= 6) break;
		}
		if (belowFoldStories.length < 6) {
			for (const candidate of workingPool) {
				if (frontPageUsed.has(candidate.articleKey)) continue;
				belowFoldStories.push(candidate);
				frontPageUsed.add(candidate.articleKey);
				if (belowFoldStories.length >= 6) break;
			}
		}
	}

	// Build Sections (Desks)
	const sections: CompiledSection[] = [];

	// 1. Tracked Topics Desk (if configured and matching articles exist)
	if (trackedClean.length > 0) {
		const topicArticles = workingPool
			.filter((a) => a.matchedTopics.length > 0)
			.sort((a, b) => b.publishedAt - a.publishedAt);
		if (topicArticles.length > 0) {
			sections.push({
				id: TRACKED_TOPICS_SECTION_ID,
				title: t(paper.language, "trackedTopics"),
				isTrackedTopicSection: true,
				articles: topicArticles,
			});
		}
	}

	// 2. Configured Editorial Desks sorted by order
	const sortedDesks = [...paper.sections].sort((a, b) => a.order - b.order);
	for (const desk of sortedDesks) {
		const deskArticles = workingPool
			.filter((a) => a.sectionId === desk.id)
			.sort((a, b) => b.publishedAt - a.publishedAt);
		if (deskArticles.length > 0) {
			sections.push({
				id: desk.id,
				title: desk.title,
				articles: deskArticles,
			});
		}
	}

	// 3. Correspondence Desk (custom feeds without an explicit desk)
	const correspondenceArticles = workingPool
		.filter((a) => a.sectionId === CORRESPONDENCE_SECTION_ID)
		.sort((a, b) => b.publishedAt - a.publishedAt);
	if (correspondenceArticles.length > 0) {
		sections.push({
			id: CORRESPONDENCE_SECTION_ID,
			title: correspondenceTitle,
			isCorrespondence: true,
			articles: correspondenceArticles,
		});
	}

	return {
		id: `${paper.id}_${dateKey}`,
		paperId: paper.id,
		paperTitle: paper.title,
		paperSubtitle: paper.subtitle,
		paperMotto: paper.motto,
		language: paper.language,
		dateKey,
		compiledAt: now,
		issueNumber,
		volumeNumber: paper.volumeNumber,
		formatUsed,
		editionUsed: paper.edition,
		magazineStyleUsed: paper.magazineStyle,
		leadStory,
		secondaryLeads,
		belowFoldStories,
		sections,
		totalArticles: workingPool.length,
		feedErrors,
	};
}
