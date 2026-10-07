/**
 * Duplicates marquee list for infinite loop
 */

export function duplicateMarqueeList() {
  const marqueeLists = document.querySelectorAll('[data-el="marquee-list"]');

  marqueeLists.forEach((el) => {
    const marqueeList = el;
    const clone = marqueeList.cloneNode(true) as HTMLElement;

    // Insert the clone as the next sibling
    marqueeList.parentNode?.insertBefore(clone, marqueeList.nextSibling);
  });
}
