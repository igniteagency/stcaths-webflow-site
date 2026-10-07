let detailsGroupIndex = 0;

function getDetailsGroupName(group: HTMLElement) {
  let groupName: string;
  do {
    groupName = `details-group-${++detailsGroupIndex}`;
  } while (group.ownerDocument?.getElementsByName(groupName).length);

  return groupName;
}

export function initDetailsGroup(group: HTMLElement, supportsDetailsName = true) {
  const detailsList = group.querySelectorAll<HTMLDetailsElement>(':scope > details');
  if (!detailsList.length) return;

  const groupName = getDetailsGroupName(group);
  detailsList.forEach((details) => {
    details.setAttribute('name', groupName);
    details.setAttribute('data-accordion', 'false');
  });

  if (
    group.classList.contains('tabbed-content_tabs') &&
    !Array.from(detailsList).some((details) => details.open)
  ) {
    detailsList[0].open = true;
  }

  if (!supportsDetailsName) {
    detailsList.forEach((details) => {
      details.addEventListener('toggle', () => {
        if (!details.open) return;

        detailsList.forEach((otherDetails) => {
          if (otherDetails !== details) otherDetails.open = false;
        });
      });
    });
  }
}

export function initDetailsGroups(
  root: ParentNode = document,
  supportsDetailsName = 'name' in document.createElement('details')
) {
  const groups = new Set<HTMLElement>();

  root.querySelectorAll<HTMLDetailsElement>('details').forEach((details) => {
    const group = details.parentElement;
    if (!group || groups.has(group)) return;
    if (group.getAttribute('data-details-group') === 'false') return;
    if (group.querySelectorAll(':scope > details').length < 2) return;

    groups.add(group);
  });

  groups.forEach((group) => initDetailsGroup(group, supportsDetailsName));
}
