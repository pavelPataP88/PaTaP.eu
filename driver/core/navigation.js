export function createNavigationController({ onChange } = {}) {
  const navigation = document.querySelector("#driver-nav");
  let buttons = [];
  let current = null;
  const views = () => Array.from(document.querySelectorAll("[data-driver-view]"));

  function configure(modules) {
    navigation.replaceChildren();
    buttons = modules.filter((module) => module.view).map((module) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.driverTarget = module.view;
      button.textContent = module.label;
      if (module.requiresProfile) {
        button.disabled = true;
        button.title = "Сначала сохраните профиль";
      }
      navigation.append(button);
      return button;
    });
  }

  function removeModule(module) {
    const button = buttons.find((item) => item.dataset.driverTarget === module.view);
    if (button) button.remove();
    buttons = buttons.filter((item) => item !== button);
    const view = views().find((item) => item.dataset.driverView === module.view);
    if (view) view.hidden = true;
  }

  function setEnabled(viewName, enabled) {
    const button = buttons.find((item) => item.dataset.driverTarget === viewName);
    if (!button) return;
    button.disabled = !enabled;
    button.title = enabled ? "" : "Сначала сохраните профиль";
  }

  function show(name) {
    const currentViews = views();
    if (!currentViews.some((view) => view.dataset.driverView === name)) return false;
    current = name;
    for (const view of currentViews) view.hidden = view.dataset.driverView !== name;
    for (const button of buttons) {
      const active = button.dataset.driverTarget === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    }
    if (onChange) onChange(name);
    return true;
  }

  navigation.addEventListener("click", (event) => {
    const button = event.target.closest("[data-driver-target]");
    if (button && !button.disabled) show(button.dataset.driverTarget);
  });

  return { configure, removeModule, setEnabled, show, current: () => current };
}
