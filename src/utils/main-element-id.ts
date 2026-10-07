export default function addMainElementId() {
  const mainElement = document.querySelector('main');
  if (mainElement) {
    mainElement.id = 'main';
  }
}
