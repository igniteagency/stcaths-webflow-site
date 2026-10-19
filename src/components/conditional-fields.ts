const INITIALIZED = Symbol.for('conditional-fields.initialized');
const WRAPPER_SELECTOR = '[data-conditional-when]';
const CONTROL_SELECTOR = 'input, select, textarea, button';
const CONTROLLER_SELECTOR = '[data-conditional-field]';

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function syncCheckedVisual(control: Control) {
  if (control.type !== 'checkbox' && control.type !== 'radio') return;
  Array.from(control.parentElement?.children || []).forEach((sibling) => {
    if (sibling !== control && sibling.matches(`.w-${control.type}-input`))
      sibling.classList.toggle('w--redirected-checked', (control as HTMLInputElement).checked);
  });
}

function available(control: Control) {
  if (control.matches(':disabled') || control.type === 'hidden') return false;
  const form = control.closest('form');
  for (
    let element: HTMLElement | null = control;
    element && element !== form;
    element = element.parentElement
  ) {
    const style = getComputedStyle(element);
    if (
      element.hidden ||
      element.inert ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    )
      return false;
  }
  return true;
}

function initForm(form: HTMLFormElement) {
  if (Reflect.get(form, INITIALIZED)) return;
  Reflect.set(form, INITIALIZED, true);
  const controllers = Array.from(form.querySelectorAll<Control>(CONTROLLER_SELECTOR)).filter(
    (control) => control.closest('form') === form && control.matches('input, select, textarea')
  );
  const rules = Array.from(form.querySelectorAll(WRAPPER_SELECTOR))
    .filter((wrapper) => wrapper.closest('form') === form)
    .map((wrapper) => ({
      wrapper,
      controllers: controllers.filter(
        (control) =>
          control.getAttribute('data-conditional-field') ===
          wrapper.getAttribute('data-conditional-when')
      ),
      values: wrapper
        .getAttribute('data-conditional-is')
        ?.split('|')
        .map((value) => value.trim()),
      hidden: wrapper.hidden,
      display: wrapper.style.getPropertyValue('display'),
      priority: wrapper.style.getPropertyPriority('display'),
    }))
    .filter((rule) => {
      const first = rule.controllers[0];
      const validControllers =
        first &&
        (first.type === 'radio'
          ? first.name &&
            rule.controllers.every(
              (control) => control.type === 'radio' && control.name === first.name
            )
          : rule.controllers.length === 1);
      if (
        rule.wrapper.getAttribute('data-conditional-when')?.trim() &&
        rule.values?.every(Boolean) &&
        validControllers
      )
        return true;
      console.debug('Conditional fields: ignored missing, malformed or ambiguous rule.');
      return false;
    });
  const controls = Array.from(form.querySelectorAll<Control>(CONTROL_SELECTOR))
    .filter((control) => rules.some(({ wrapper }) => wrapper.contains(control)))
    .map((control) => ({ control, required: control.required, disabled: control.disabled }));
  const conditionalRadioNames = new Set(
    controls.filter(({ control }) => control.type === 'radio').map(({ control }) => control.name)
  );
  const radios = Array.from(form.querySelectorAll<HTMLInputElement>('input'))
    .filter(
      (control) =>
        control.closest('form') === form &&
        control.type === 'radio' &&
        conditionalRadioNames.has(control.name) &&
        control.name
    )
    .map((control) => ({ control, required: control.required }));
  const requiredRadioNames = new Set(
    radios.filter(({ required }) => required).map(({ control }) => control.name)
  );
  const restoreWrapper = (rule: (typeof rules)[number]) => {
    rule.wrapper.hidden = rule.hidden;
    if (rule.display) rule.wrapper.style.setProperty('display', rule.display, rule.priority);
    else rule.wrapper.style.removeProperty('display');
  };
  const update = () => {
    rules.forEach(restoreWrapper);
    radios.forEach(({ control, required }) => {
      control.required = required;
    });
    controls.forEach(({ control, required, disabled }) => {
      control.required = required;
      control.disabled = disabled;
    });
    for (let pass = 0; pass <= rules.length; pass++) {
      let changed = false;
      for (const rule of rules) {
        const { wrapper, controllers, values } = rule;
        const controller =
          controllers[0]?.type === 'radio'
            ? controllers.find(
                (control) => (control as HTMLInputElement).checked && available(control)
              )
            : controllers[0];
        const value =
          controller?.type === 'checkbox'
            ? String((controller as HTMLInputElement).checked)
            : controller?.value;
        const active =
          controller && available(controller) && value !== undefined && values?.includes(value);
        const hidden = !active || rule.hidden;
        changed ||= wrapper.hidden !== hidden;
        wrapper.hidden = hidden;
        if (!active) wrapper.style.setProperty('display', 'none', 'important');
        else if (rule.display) wrapper.style.setProperty('display', rule.display, rule.priority);
        else wrapper.style.removeProperty('display');
      }
      for (const { control, required, disabled } of controls) {
        const inactive = rules.some(({ wrapper }) => wrapper.hidden && wrapper.contains(control));
        control.required = !inactive && required;
        control.disabled = inactive || disabled;
        if (
          !inactive ||
          control.tagName === 'BUTTON' ||
          ['submit', 'reset', 'button'].includes(control.type)
        )
          continue;
        if (control.type === 'checkbox' || control.type === 'radio') {
          (control as HTMLInputElement).checked = false;
          syncCheckedVisual(control);
        } else if (control.tagName === 'SELECT') (control as HTMLSelectElement).selectedIndex = -1;
        else control.value = '';
      }
      if (!changed) break;
    }
    for (const name of requiredRadioNames) {
      const active = radios.filter(({ control }) => control.name === name && available(control));
      if (active.length && !active.some(({ control }) => control.required))
        active[0].control.required = true;
    }
  };
  const restore = () => {
    update();
    controls.forEach(({ control }) => syncCheckedVisual(control));
    radios.forEach(({ control }) => syncCheckedVisual(control));
  };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('reset', () => setTimeout(restore, 0));
  window.addEventListener('pageshow', restore);
  update();
}

const forms = new Set<HTMLFormElement>();
document.querySelectorAll(WRAPPER_SELECTOR).forEach((wrapper) => {
  const form = wrapper.closest('form');
  if (form) forms.add(form);
});
forms.forEach(initForm);
