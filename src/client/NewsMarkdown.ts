import { BRAND } from "../brand/Brand";

// News posts link to the upstream repository's PRs and compares; shorten
// those to "#123"-style links. Built from BRAND.upstream.url so the regexes
// track the upstream repo, not a hardcoded org.
const UPSTREAM_REPO_PATTERN = BRAND.upstream.url.replace(
  /[.*+?^${}()|[\]\\/]/g,
  "\\$&",
);
const GITHUB_PR_URL_REGEX = new RegExp(
  `(?<!\\()\\b${UPSTREAM_REPO_PATTERN}/pull/(\\d+)\\b`,
  "g",
);
const GITHUB_COMPARE_URL_REGEX = new RegExp(
  `(?<!\\()\\b${UPSTREAM_REPO_PATTERN}/compare/([\\w.-]+)\\b`,
  "g",
);
const GITHUB_MENTION_REGEX =
  /(^|[^\w/[`])@([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)(?![\w-])/gim;

export function normalizeNewsMarkdown(markdown: string): string {
  return (
    markdown
      // Convert bold header lines (e.g. "**Title**") into real Markdown headers.
      // Exclude lines starting with - or * to avoid converting bullet points.
      .replace(/^([^\-*\s].*?) \*\*(.+?)\*\*$/gm, "## $1 $2")
      .replace(
        GITHUB_PR_URL_REGEX,
        (_match, prNumber) =>
          `[#${prNumber}](${BRAND.upstream.url}/pull/${prNumber})`,
      )
      .replace(
        GITHUB_COMPARE_URL_REGEX,
        (_match, comparison) =>
          `[${comparison}](${BRAND.upstream.url}/compare/${comparison})`,
      )
      .replace(
        GITHUB_MENTION_REGEX,
        (_match, prefix, username) =>
          `${prefix}[@${username}](https://github.com/${username})`,
      )
  );
}
