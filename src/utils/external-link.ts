const handleExternalLinks = (): void => {
  // Select all anchor elements with data-external attribute set to "yes", "true", or "1"
  const externalLinks = document.querySelectorAll<HTMLAnchorElement>(
    'a[data-external="yes"], a[data-external="true"], a[data-external="1"]'
  );

  externalLinks.forEach((link) => {
    link.setAttribute('target', '_blank');
  });
};

export default handleExternalLinks;
