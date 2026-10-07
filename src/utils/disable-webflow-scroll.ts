export function disableWebflowAnchorSmoothScroll() {
  window.jQuery?.(document).off('click.wf-scroll');
}
