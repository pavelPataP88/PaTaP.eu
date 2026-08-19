const STYLE_ID = "patap-people-console-v1";

const FILTERS = Object.freeze([
  ["ALL", "Все"],
  ["CONTACTS", "Контакты"],
  ["FAVORITES", "Избранные"],
  ["TRUSTED", "Доверенные"],
  ["NEARBY", "Рядом"],
  ["REQUESTS", "Запросы"],
  ["COMMUNITIES", "Сообщества"],
  ["BLOCKED", "Блокировки"]
]);

function button(text, className = "") {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function iconButton(text, label) {
  const node = button(text, "people-icon-button");
  node.title = label;
  node.setAttribute("aria-label", label);
  return node;
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.people-console{display:flex;min-height:0;height:100%;flex-direction:column;gap:0;overflow:hidden;background:#07110e}.people-head{display:grid;gap:10px;padding:14px;border-bottom:1px solid var(--line);background:#091611}.people-title-row{display:flex;align-items:center;gap:10px}.people-title-row h2{margin:0;flex:1}.people-head-actions{display:flex;gap:7px}.people-icon-button{display:grid;min-width:40px;height:40px;place-items:center;padding:0;border:1px solid var(--line);border-radius:12px;background:#10251d;color:inherit;font-weight:900;cursor:pointer}.people-icon-button:hover,.people-icon-button:focus-visible{border-color:var(--accent);color:var(--accent)}.people-search-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:7px}.people-search-row input,.people-search-row select{min-height:42px;border-radius:12px}.people-filters{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px}.people-filters button{flex:0 0 auto;min-height:34px;padding:5px 10px;border:1px solid transparent;border-radius:999px;background:#0d2019;color:var(--muted);font-size:.76rem;font-weight:850}.people-filters button.active{border-color:var(--accent);color:var(--accent);background:rgba(104,224,173,.08)}.people-body{min-height:0;flex:1;overflow:auto;padding:12px}.people-summary{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:10px}.people-summary span{padding:5px 8px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:.72rem}.people-section{display:grid;gap:8px;margin-bottom:16px}.people-section h3{margin:0;font-size:.88rem;color:#dff8ed}.people-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px}.people-card{display:grid;grid-template-columns:48px minmax(0,1fr);gap:10px;padding:10px;border:1px solid var(--line);border-radius:15px;background:#0a1914}.people-avatar{display:grid;width:48px;height:48px;place-items:center;border-radius:15px;background:#17382d;color:var(--accent);font-weight:950;font-size:1.05rem}.people-card-main{min-width:0}.people-card-title{display:flex;gap:6px;align-items:center;min-width:0}.people-card-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.people-badge{padding:2px 6px;border:1px solid rgba(104,224,173,.26);border-radius:999px;color:var(--accent);font-size:.64rem;font-weight:850}.people-card-meta{display:block;margin-top:4px;color:var(--muted);font-size:.74rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.people-card-note{margin:6px 0 0;color:#c8ded5;font-size:.74rem;overflow-wrap:anywhere}.people-card-actions{grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap}.people-card-actions button{min-height:34px;padding:5px 9px;font-size:.73rem}.people-community-card{display:grid;gap:8px;padding:11px;border:1px solid var(--line);border-radius:15px;background:#0a1914}.people-community-top{display:flex;gap:8px;align-items:flex-start}.people-community-copy{min-width:0;flex:1}.people-community-copy strong{display:block}.people-community-copy small{display:block;margin-top:4px;color:var(--muted)}.people-empty{padding:26px 12px;color:var(--muted);text-align:center}.people-dialog{width:min(680px,calc(100vw - 24px));max-height:min(86vh,800px);padding:0;border:1px solid var(--line);border-radius:20px;background:#0b1814;color:#f4f8f6}.people-dialog::backdrop{background:rgba(0,0,0,.68);backdrop-filter:blur(3px)}.people-dialog-head{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:10px;padding:13px 15px;border-bottom:1px solid var(--line);background:#0b1814}.people-dialog-head h3{margin:0;flex:1}.people-dialog-body{display:grid;gap:10px;padding:14px 15px;overflow:auto}.people-dialog-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px;align-items:center;padding:9px;border:1px solid var(--line);border-radius:12px;background:#091711}.people-dialog-row small{display:block;margin-top:3px;color:var(--muted)}.people-dialog-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.people-form{display:grid;gap:10px}.people-form label{display:grid;gap:5px}.people-form input,.people-form textarea,.people-form select{width:100%}.people-form-actions{display:flex;gap:7px;justify-content:flex-end}.people-danger{border-color:#7a3733!important;color:#ffaaa2!important}.people-help{margin:0;color:var(--muted);font-size:.8rem;line-height:1.45}@media(max-width:720px){.people-body{padding:9px}.people-search-row{grid-template-columns:1fr auto}.people-search-row select{grid-column:1/-1}.people-grid{grid-template-columns:1fr}.people-dialog-row{grid-template-columns:1fr}.people-dialog-actions{justify-content:flex-start}}`;
  document.head.append(style);
}

export function createPeopleConsoleUi({ card, list }) {
  installStyles();
  card.classList.add("people-console");
  card.replaceChildren();

  const head = document.createElement("header"); head.className = "people-head";
  const titleRow = document.createElement("div"); titleRow.className = "people-title-row";
  const title = document.createElement("h2"); title.textContent = "Люди";
  const headActions = document.createElement("div"); headActions.className = "people-head-actions";
  const communitiesButton = iconButton("◎", "Сообщества");
  const settingsButton = iconButton("⚙", "Приватность и настройки");
  headActions.append(communitiesButton, settingsButton); titleRow.append(title, headActions);

  const searchRow = document.createElement("div"); searchRow.className = "people-search-row";
  const searchInput = document.createElement("input"); searchInput.type = "search"; searchInput.placeholder = "Никнейм водителя"; searchInput.maxLength = 32; searchInput.setAttribute("aria-label", "Поиск водителя");
  const searchButton = button("Найти", "primary");
  const typeSelect = document.createElement("select"); typeSelect.setAttribute("aria-label", "Тип водителя");
  for (const [value, label] of [["","Все типы"],["TIR","TIR"],["TAXI","Taxi"],["DELIVERY","Доставка"],["GENERAL","Общий"]]) { const o=document.createElement("option");o.value=value;o.textContent=label;typeSelect.append(o); }
  searchRow.append(searchInput, searchButton, typeSelect);

  const filters = document.createElement("nav"); filters.className = "people-filters"; filters.setAttribute("aria-label", "Фильтры людей");
  const filterButtons = new Map();
  for (const [key, label] of FILTERS) { const node=button(label);node.dataset.peopleFilter=key;filterButtons.set(key,node);filters.append(node); }
  head.append(titleRow, searchRow, filters);

  const summary = document.createElement("div"); summary.className = "people-summary";
  const body = list || document.createElement("div"); body.id ||= "contacts-list"; body.className = "people-body";
  body.replaceChildren(summary);
  card.append(head, body);

  const dialog = document.createElement("dialog"); dialog.className = "people-dialog";
  const dialogHead = document.createElement("div"); dialogHead.className = "people-dialog-head";
  const dialogTitle = document.createElement("h3"); const dialogClose = iconButton("×", "Закрыть"); dialogHead.append(dialogTitle, dialogClose);
  const dialogBody = document.createElement("div"); dialogBody.className = "people-dialog-body"; dialog.append(dialogHead, dialogBody); document.body.append(dialog);
  dialogClose.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });

  let activeFilter = "ALL";
  function setFilter(value) { activeFilter = value; for (const [key,node] of filterButtons) node.classList.toggle("active", key === value); }
  setFilter(activeFilter);

  return {
    controls:{ communitiesButton, settingsButton, searchInput, searchButton, typeSelect, filterButtons },
    body, summary,
    get filter(){ return activeFilter; },
    setFilter,
    clear(){ body.replaceChildren(summary); summary.replaceChildren(); },
    setCounts(counts={}){ summary.replaceChildren(); for(const [label,value] of [["Контакты",counts.contacts],["Входящие",counts.incoming],["Избранные",counts.favorites],["Доверенные",counts.trusted],["Сообщества",counts.communities]]){if(Number(value)>0){const chip=document.createElement("span");chip.textContent=`${label}: ${value}`;summary.append(chip);}} },
    section(titleText){ const section=document.createElement("section");section.className="people-section";const h=document.createElement("h3");h.textContent=titleText;const grid=document.createElement("div");grid.className="people-grid";section.append(h,grid);body.append(section);return grid; },
    empty(text){ const p=document.createElement("p");p.className="people-empty";p.textContent=text;body.append(p); },
    personCard(person,{actions=[]}={}){ const cardNode=document.createElement("article");cardNode.className="people-card";const avatar=document.createElement("span");avatar.className="people-avatar";avatar.textContent=(person.nickname||"?").slice(0,1).toUpperCase();const main=document.createElement("div");main.className="people-card-main";const line=document.createElement("div");line.className="people-card-title";const name=document.createElement("strong");name.textContent=person.nickname;line.append(name);if(person.favorite){const b=document.createElement("span");b.className="people-badge";b.textContent="★";b.title="Избранный контакт";line.append(b);}if(person.trusted){const b=document.createElement("span");b.className="people-badge";b.textContent="Доверенный";line.append(b);}const meta=document.createElement("span");meta.className="people-card-meta";const parts=[person.driverType,person.countryCode,person.vehicle,Number.isFinite(person.distanceKm)?`${person.distanceKm} км`:null,person.gps&&person.gps!=="HIDDEN"?person.gps:null].filter(Boolean);meta.textContent=parts.join(" · ");main.append(line,meta);if(person.privateNote){const note=document.createElement("p");note.className="people-card-note";note.textContent=person.privateNote;main.append(note);}const box=document.createElement("div");box.className="people-card-actions";box.append(...actions);cardNode.append(avatar,main,box);return cardNode; },
    communityCard(community,{actions=[]}={}){ const node=document.createElement("article");node.className="people-community-card";const top=document.createElement("div");top.className="people-community-top";const copy=document.createElement("div");copy.className="people-community-copy";const strong=document.createElement("strong");strong.textContent=`${community.favorite?"★ ":""}${community.title}`;const small=document.createElement("small");small.textContent=[community.category,community.countryCode,`${community.memberCount||0} участников`,community.visibility==="PUBLIC"?"Открытое":"Закрытое"].filter(Boolean).join(" · ");copy.append(strong,small);top.append(copy);const desc=document.createElement("p");desc.className="people-help";desc.textContent=community.description||"Сообщество водителей PaTaP";const actionsBox=document.createElement("div");actionsBox.className="people-card-actions";actionsBox.append(...actions);node.append(top,desc,actionsBox);return node; },
    action(text,handler,{primary=false,danger=false,disabled=false}={}){const node=button(text,primary?"primary":"");node.disabled=disabled;if(danger)node.classList.add("people-danger");node.addEventListener("click",handler);return node;},
    row(titleText,subtitle="",actions=[]){const row=document.createElement("div");row.className="people-dialog-row";const copy=document.createElement("div");const strong=document.createElement("strong");strong.textContent=titleText;copy.append(strong);if(subtitle){const small=document.createElement("small");small.textContent=subtitle;copy.append(small);}const box=document.createElement("div");box.className="people-dialog-actions";box.append(...actions);row.append(copy,box);return row;},
    select(options,current,onChange){const node=document.createElement("select");for(const [value,label] of options){const o=document.createElement("option");o.value=value;o.textContent=label;node.append(o);}node.value=current;node.addEventListener("change",()=>onChange(node.value));return node;},
    showDialog(titleText,content){dialogTitle.textContent=titleText;dialogBody.replaceChildren();if(content instanceof Node)dialogBody.append(content);else if(Array.isArray(content))dialogBody.append(...content);dialog.showModal();return dialog;},
    closeDialog(){dialog.close();},
    form(fields,submitText,onSubmit){const form=document.createElement("form");form.className="people-form";for(const field of fields){const label=document.createElement("label");label.textContent=field.label;let input;if(field.type==="select"){input=document.createElement("select");for(const [value,text] of field.options){const o=document.createElement("option");o.value=value;o.textContent=text;input.append(o);}input.value=field.value??field.options[0]?.[0]??"";}else if(field.type==="textarea"){input=document.createElement("textarea");input.rows=3;input.maxLength=field.maxLength||240;input.value=field.value||"";}else{input=document.createElement("input");input.type=field.type||"text";input.value=field.value||"";if(field.maxLength)input.maxLength=field.maxLength;if(field.minLength)input.minLength=field.minLength;}input.name=field.name;if(field.required)input.required=true;label.append(input);form.append(label);}const actions=document.createElement("div");actions.className="people-form-actions";const cancel=button("Отмена");cancel.addEventListener("click",()=>dialog.close());const submit=document.createElement("button");submit.type="submit";submit.className="primary";submit.textContent=submitText;actions.append(cancel,submit);form.append(actions);form.addEventListener("submit",async(event)=>{event.preventDefault();submit.disabled=true;try{const ok=await onSubmit(Object.fromEntries(new FormData(form).entries()));if(ok!==false)dialog.close();}finally{submit.disabled=false;}});return form;},
    destroy(){dialog.remove();card.classList.remove("people-console");}
  };
}

export { FILTERS as PEOPLE_FILTERS };
