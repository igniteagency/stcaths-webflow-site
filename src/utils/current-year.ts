export function setCurrentYear(): void {
  const currentYearElements = document.querySelectorAll('[data-el="current-year"]');
  const currentYear = new Date().getFullYear().toString();

  currentYearElements.forEach((element) => {
    element.textContent = currentYear;
  });
}
