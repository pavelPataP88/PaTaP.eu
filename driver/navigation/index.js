import {createNavigationPanel} from "./panel.mjs?v=20260820-nav1";
import {saveActiveRoute,loadActiveRoute,clearActiveRoute} from "./route-cache.mjs?v=20260820-nav1";
import {projectGuidance,isMoving} from "./guidance.mjs?v=20260820-nav1";

function routeErrorText(error){
  const code=String(error?.message||"");
  if(code==="navigation_vehicle_profile_incomplete")return "Заполните высоту, ширину, длину и полный вес машины. Без этого грузовой маршрут не строится.";
  if(code==="navigation_provider_unavailable")return "Маршрутизатор сейчас недоступен. PaTaP не будет подменять его приблизительным маршрутом.";
  if(code==="navigation_provider_timeout")return "Маршрутизатор не ответил вовремя. Повторите расчёт.";
  if(code==="navigation_no_route")return "Строгий маршрут для этого профиля машины не найден. Маршрут легкового автомобиля автоматически не подставляется.";
  if(code==="navigation_origin_required")return "Нужна свежая GPS-позиция или явная точка старта.";
  if(code==="navigation_destination_required")return "Выберите точку назначения.";
  return "Не удалось рассчитать маршрут.";
}

export function createDriverModule(context){
  let profileReady=false;
  let currentRoute=null;
  let guidanceTimer=null;
  let guidanceActive=false;
  let startupToken=0;

  const mapController=()=>context.getModule?.("map")?.controller;
  const openMap=async()=>{const map=context.getModule?.("map");await map?.activate?.();document.querySelector('[data-driver-target="map"]')?.click();return mapController();};

  const panel=createNavigationPanel({
    async onPickDestination(){
      const map=await openMap();panel.setStateText("Коснитесь точки назначения на карте…");
      try{const point=await map?.pickPoint?.();panel.openPanel("planner");panel.setStateText("Точка выбрана");return point;}catch{context.showError?.("Не удалось выбрать точку на карте.");return null;}
    },
    async onCalculate(request){return calculate(request);},
    async onSaveProfile(payload){return saveProfile(payload);},
    async onSelectAlternative(id){return selectAlternative(id);},
    async onStart(){return startGuidance();},
    async onReroute(){return reroute();},
    async onFinish(){return finish();},
    onFit(){mapController()?.fitRoute?.();},
    async onOpenParking(place){return openParking(place);}
  });

  function stopGuidanceLoop(){if(guidanceTimer!==null){window.clearInterval(guidanceTimer);guidanceTimer=null;}}
  function selectedAlternative(route=currentRoute){return route?.selectedAlternative||route?.alternatives?.find((a)=>a.id===route?.selectedAlternativeId)||route?.alternatives?.[0]||null;}
  function selectedEnrichment(route=currentRoute){return route?.enrichment?.[route?.selectedAlternativeId]||route?.enrichment||{};}

  async function loadStatusAndProfile(){
    if(!profileReady)return;const token=++startupToken;
    try{
      const [statusData,profileData]=await Promise.all([context.api("/api/driver/navigation/status"),context.api("/api/driver/navigation/profile")]);if(token!==startupToken)return;
      panel.setProviderStatus(statusData.status);panel.setProfile(profileData.profile);
    }catch(error){if(error?.status===401)return context.onAuthLost?.();panel.setStateText("Навигация временно недоступна");}
  }

  async function restoreActiveRoute(){
    const cached=loadActiveRoute();if(!cached)return;
    currentRoute=cached;panel.renderRoute(cached);await openMap();await mapController()?.showRoute?.(cached);
    try{const data=await context.api(`/api/driver/navigation/routes/${encodeURIComponent(cached.id)}`);if(data.route){currentRoute=data.route;saveActiveRoute(currentRoute);panel.renderRoute(currentRoute);await mapController()?.showRoute?.(currentRoute);}}
    catch{panel.setStateText("Показан сохранённый маршрут · данные могут быть устаревшими");}
  }

  async function saveProfile(payload){
    try{const data=await context.api("/api/driver/navigation/profile",{method:"PATCH",body:payload});panel.setProfile(data.profile);panel.setStateText("Профиль машины сохранён");return data.profile;}
    catch(error){if(error?.status===401)context.onAuthLost?.();context.showError?.("Проверьте размеры, вес и параметры машины.");return null;}
  }

  async function calculate(request){
    panel.setBusy("Рассчитываем строгий маршрут…");
    try{
      const data=await context.api("/api/driver/navigation/routes",{method:"POST",body:request});currentRoute=data.route;guidanceActive=false;stopGuidanceLoop();clearActiveRoute();panel.renderRoute(currentRoute);await openMap();await mapController()?.showRoute?.(currentRoute);panel.setStateText(`${currentRoute.provider} · ${currentRoute.alternatives?.length||1} вариант(а)`);return currentRoute;
    }catch(error){if(error?.status===401)return context.onAuthLost?.();panel.setStateText("Маршрут не построен");context.showError?.(routeErrorText(error));return null;}
  }

  async function selectAlternative(alternativeId){
    if(!currentRoute)return null;try{const data=await context.api(`/api/driver/navigation/routes/${encodeURIComponent(currentRoute.id)}/select`,{method:"POST",body:{alternativeId}});currentRoute=data.route;panel.renderRoute(currentRoute);await mapController()?.showRoute?.(currentRoute);if(guidanceActive)saveActiveRoute(currentRoute);return currentRoute;}catch(error){if(error?.status===401)context.onAuthLost?.();else context.showError?.("Не удалось выбрать вариант маршрута.");return null;}
  }

  function updateGuidance(){
    if(!guidanceActive||!currentRoute)return;const map=mapController(),location=map?.getOwnLocation?.(),alternative=selectedAlternative();panel.setMoving(isMoving(location));if(!location||!alternative)return;
    const model=projectGuidance(alternative,location);if(model)panel.renderGuidance(model);
  }

  async function startGuidance(){
    if(!currentRoute)return;guidanceActive=true;saveActiveRoute(currentRoute);await openMap();await mapController()?.showRoute?.(currentRoute,{fit:false});mapController()?.recenterOwn?.();panel.startGuidance(currentRoute);stopGuidanceLoop();guidanceTimer=window.setInterval(updateGuidance,1000);updateGuidance();
  }

  async function reroute(){
    if(!currentRoute)return;panel.setStateText("Перестраиваем строгий маршрут…");const location=mapController()?.getOwnLocation?.();try{const data=await context.api(`/api/driver/navigation/routes/${encodeURIComponent(currentRoute.id)}/refresh`,{method:"POST",body:location?{origin:{latitude:location.latitude,longitude:location.longitude,label:"Текущая позиция"}}:{}});if(data.error)throw Object.assign(new Error(data.error),{status:data.status});currentRoute=data.route;saveActiveRoute(currentRoute);await mapController()?.showRoute?.(currentRoute,{fit:false});panel.startGuidance(currentRoute);panel.setStateText("Маршрут перестроен");updateGuidance();}
    catch(error){if(error?.status===401)return context.onAuthLost?.();context.showError?.(routeErrorText(error));panel.setStateText("Не удалось перестроить маршрут");}
  }

  async function finish(){
    if(currentRoute?.id){try{await context.api(`/api/driver/navigation/routes/${encodeURIComponent(currentRoute.id)}/finish`,{method:"POST",body:{state:"COMPLETED"}});}catch(error){if(error?.status===401)context.onAuthLost?.();}}
    guidanceActive=false;stopGuidanceLoop();clearActiveRoute();currentRoute=null;mapController()?.clearRoute?.();panel.reset();
  }

  async function openParking(place){
    const enrichment=selectedEnrichment();let target=place;if(!target)target=enrichment?.parking?.planB?.[0]||enrichment?.parking?.recommendedStops?.[1]||enrichment?.parking?.recommendedStops?.[0];if(!target)return context.showError?.("Подходящего Plan B по текущим данным парковок нет.");await openMap();await mapController()?.showParkingPlace?.(target);panel.setStateText(`${target.name} · ${target.occupancy?.status||"UNKNOWN"}`);
  }

  async function startSession(){await loadStatusAndProfile();await restoreActiveRoute();}
  function reset(){startupToken++;profileReady=false;guidanceActive=false;stopGuidanceLoop();currentRoute=null;clearActiveRoute();panel.reset();mapController()?.clearRoute?.();}

  return {
    async activate(){await openMap();panel.openPanel(currentRoute?(guidanceActive?"guidance":"planner"):"planner");},
    setSession({profile}){profileReady=Boolean(profile);if(profileReady)startSession().catch(()=>{});else reset();},
    setProfileReady(profile){profileReady=Boolean(profile);if(profileReady)loadStatusAndProfile().catch(()=>{});else reset();},
    reset,
    getCurrentRoute(){return currentRoute;},
    async open(){await openMap();panel.openPanel(currentRoute?(guidanceActive?"guidance":"planner"):"planner");}
  };
}
