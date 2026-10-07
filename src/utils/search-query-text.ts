const SEARCH_QUERY_PARAM = 'query';
const SEARCH_RESULT_TEXT_SELECTOR = '[data-el="search-result-text"]';

export function setSearchResultTextFromQuery(): void {
  const searchTerm = new URLSearchParams(window.location.search).get(SEARCH_QUERY_PARAM);

  if (!searchTerm) return;

  document.querySelectorAll<HTMLElement>(SEARCH_RESULT_TEXT_SELECTOR).forEach((element) => {
    element.textContent = searchTerm;
  });
}
