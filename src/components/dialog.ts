/**
 * Popups with dialog HTML element
 * Set `data-dialog-id="{unique-number}"` attribute on the dialog element to target it
 * Set `data-dialog-open="{unique-number}"` attribute on open trigger element(s) to open the dialog
 * Set `data-dialog-close="{unique-number}"` attribute on close trigger element(s) to close the dialog. Close triggers should be inside the dialog element
 *
 * TODO: make it work with the new `command` and `commandfor` libraries with fallback polyfill script
 */
class Dialog {
  private readonly DATA_ATTR = 'data-dialog-id';
  private readonly DATA_ATTR_OPEN = 'data-dialog-open';
  private readonly DATA_ATTR_CLOSE = 'data-dialog-close';
  private readonly DATA_COMPONENT_SELECTOR = `dialog[${this.DATA_ATTR}]`;
  private initializedIds = new Set<string>();

  constructor() {
    this.init();
    this.handleBackdropClick();
  }

  private init() {
    const dialogList = document.querySelectorAll<HTMLDialogElement>(this.DATA_COMPONENT_SELECTOR);

    dialogList.forEach((dialogEl) => {
      const id = dialogEl.getAttribute(this.DATA_ATTR);
      if (!id) {
        console.error('No ID found for dialog component', dialogEl);
        return;
      }

      if (this.initializedIds.has(id)) {
        console.warn(`Duplicate dialog ID "${id}" found. Skipping initialization.`, dialogEl);
        return;
      }

      this.initializedIds.add(id);

      const openTriggersList = document.querySelectorAll(`[${this.DATA_ATTR_OPEN}="${id}"]`);
      const closeTriggersList = dialogEl.querySelectorAll(`[${this.DATA_ATTR_CLOSE}="${id}"]`);

      openTriggersList.forEach((openTriggerEl) => {
        openTriggerEl.addEventListener('click', () => {
          this.openDialog(dialogEl);
        });
      });

      closeTriggersList.forEach((closeTriggerEl) => {
        closeTriggerEl.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeDialog(dialogEl);
        });
      });

      // Handle native close event (e.g. when user presses Esc key)
      dialogEl.addEventListener('close', (event) => {
        this.closeDialog(dialogEl, true);
      });
    });
  }

  private openDialog(dialogEl: HTMLDialogElement) {
    dialogEl.showModal();

    // new custom event
    const dialogOpenEvent = new CustomEvent('dialogOpen', {
      detail: { dialogId: dialogEl.getAttribute(this.DATA_ATTR) },
    });
    dialogEl.dispatchEvent(dialogOpenEvent);
  }

  private closeDialog(dialogEl: HTMLDialogElement, isAutoClosing = false) {
    if (!isAutoClosing) {
      dialogEl.close();
    }

    // new custom event
    const dialogCloseEvent = new CustomEvent('dialogClose', {
      detail: { dialogId: dialogEl.getAttribute(this.DATA_ATTR) },
    });
    dialogEl.dispatchEvent(dialogCloseEvent);
  }

  /**
   * Handles backdrop click to close dialog
   * Only closes if the click was directly on the dialog element (backdrop) and not its children
   */
  private handleBackdropClick() {
    const dialogEl = document.querySelectorAll<HTMLDialogElement>('dialog');
    dialogEl.forEach((dialog) => {
      dialog.addEventListener('click', (event) => {
        const dialogEl = event.target as HTMLDialogElement;
        if (!(dialogEl instanceof HTMLDialogElement)) return;

        // Check if click was directly on the dialog element (backdrop)
        const rect = dialogEl.getBoundingClientRect();
        const clickedInDialog =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;

        if (clickedInDialog && event.target === dialogEl) {
          this.closeDialog(dialogEl);
        }
      });
    });
  }
}

export default Dialog;
