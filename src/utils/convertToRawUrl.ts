/**
 * Converts a GitHub or GitLab URL to its raw content URL.
 * @param {string} url - The URL to be converted.
 * @returns {string} The raw content URL.
 */
export function convertToRawUrl(url: string): string {
  let rawUrl = url;

  // For GitHub URLs
  if (url.includes('github.com')) {
    rawUrl = url.replace('github.com', 'raw.githubusercontent.com');
    rawUrl = rawUrl.replace('/blob/', '/');
  }

  // For GitLab URLs
  if (url.includes('gitlab.com')) {
    rawUrl = url.replace('/-/blob/', '/-/raw/');
  }

  return rawUrl;
}
