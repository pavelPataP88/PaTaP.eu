const ALLOWED_RADII = new Set([5, 25, 50, 100]);
const SEND_THROTTLE_MS = 10_000;
const NEARBY_REFRESH_MS = 15_000;

export function createGpsController({ api, map, onAuthLost }) {
  const gpsToggle = document.querySelector("#gps-toggle");
  const nearbyRadius = document.querySelector("#nearby-radius");
  const gpsState = document.querySelector("#gps-state");
  let currentUser = null;
  let hasProfile = false;
  let driverEnabled = false;
  let watchId = null;
  let latestLocation = null;
  let sendTimer = null;
  let nearbyTimer = null;
  let lastSentAt = 0;

  function setState(text, state = "") {
    gpsState.textContent = text;
    gpsState.dataset.state = state;
  }

  function setControlsEnabled(enabled) {
    gpsToggle.disabled = !enabled;
    nearbyRadius.disabled = !enabled || !driverEnabled;
    if (!enabled) setState("Сначала сохраните обязательные поля профиля.");
  }

  function cancelPendingSend() {
    if (sendTimer) window.clearTimeout(sendTimer);
    sendTimer = null;
  }

  function clearRefresh() {
    if (nearbyTimer) window.clearInterval(nearbyTimer);
    nearbyTimer = null;
  }

  function clearLocalPosition() {
    if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    latestLocation = null;
    lastSentAt = 0;
    cancelPendingSend();
    map.clearOwn();
    map.clearNearby();
  }

  async function setPersistedState(enabled) {
    const data = await api("/api/driver/gps", { method: "PUT", body: { enabled } });
    return data.gpsEnabled === true;
  }

  async function refreshNearby() {
    if (!currentUser || !hasProfile || !driverEnabled || !map.isReady()) {
      map.clearNearby();
      return;
    }
    const radius = Number(nearbyRadius.value);
    if (!ALLOWED_RADII.has(radius)) return;
    try {
      const data = await api("/api/driver/nearby", { method: "POST", body: { radius } });
      map.showNearby(Array.isArray(data.drivers) ? data.drivers : []);
    } catch (error) {
      if (error.status === 401) handleLostAuth();
      else if (error.message === "gps_disabled") {
        driverEnabled = false;
        gpsToggle.checked = false;
        nearbyRadius.disabled = true;
        clearLocalPosition();
        setState("Driver выключен. Включите GPS, чтобы видеть других и быть видимым.");
      } else setState("Не удалось обновить ближайших водителей.", "error");
    }
  }

  function startNearbyRefresh() {
    clearRefresh();
    nearbyTimer = window.setInterval(refreshNearby, NEARBY_REFRESH_MS);
  }

  async function sendLatestLocation() {
    if (!driverEnabled || !latestLocation || !hasProfile) return;
    const remaining = SEND_THROTTLE_MS - (Date.now() - lastSentAt);
    if (remaining > 0) {
      if (!sendTimer) {
        sendTimer = window.setTimeout(() => {
          sendTimer = null;
          sendLatestLocation();
        }, remaining);
      }
      return;
    }
    lastSentAt = Date.now();
    try {
      await api("/api/driver/location", { method: "PUT", body: latestLocation });
      setState("Driver включён. Вы видите водителей с GPS и видимы им.", "active");
      await refreshNearby();
    } catch (error) {
      if (error.status === 401) handleLostAuth();
      else if (error.message === "gps_disabled") {
        driverEnabled = false;
        gpsToggle.checked = false;
        nearbyRadius.disabled = true;
        clearLocalPosition();
        setState("Driver выключен на сервере.", "error");
      } else setState("GPS включён, но позицию временно не удалось передать.", "error");
    }
  }

  function onPosition(position) {
    if (!driverEnabled) return;
    const { latitude, longitude, accuracy } = position.coords || {};
    if (![latitude, longitude, accuracy].every((value) => typeof value === "number" && Number.isFinite(value))) {
      setState("Браузер вернул некорректную позицию.", "error");
      return;
    }
    latestLocation = { latitude, longitude, accuracy };
    map.showOwn(latestLocation);
    setState("GPS получен. Включаем Driver…", "active");
    sendLatestLocation();
  }

  async function turnOff({ persist = true, deleteServer = true } = {}) {
    driverEnabled = false;
    gpsToggle.checked = false;
    nearbyRadius.disabled = true;
    clearLocalPosition();
    if (currentUser && hasProfile) {
      if (persist) await setPersistedState(false);
      else if (deleteServer) await api("/api/driver/location", { method: "DELETE", body: {} });
    }
    setState("Driver выключен. Координаты не передаются, другие водители скрыты.");
  }

  function onPositionError(error) {
    if (error?.code === 1) {
      turnOff({ persist: true })
        .then(() => setState("Доступ к геолокации запрещён. Driver выключен.", "error"))
        .catch(() => setState("Доступ к геолокации запрещён. Не удалось сохранить выключение Driver.", "error"));
      return;
    }
    latestLocation = null;
    map.clearOwn();
    map.clearNearby();
    if (currentUser) api("/api/driver/location", { method: "DELETE", body: {} }).catch(() => {});
    setState("GPS временно недоступен. Driver включён и восстановит работу при следующей позиции.", "error");
  }

  async function startGps({ persist = true } = {}) {
    if (!hasProfile || watchId !== null) return;
    if (!navigator.geolocation) {
      await turnOff({ persist }).catch(() => {});
      setState("Этот браузер не поддерживает геолокацию. Driver выключен.", "error");
      return;
    }
    gpsToggle.disabled = true;
    try {
      if (persist) await setPersistedState(true);
      driverEnabled = true;
      gpsToggle.checked = true;
      nearbyRadius.disabled = false;
      setState("Восстанавливаем GPS и ожидаем позицию…");
      watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
        enableHighAccuracy: true,
        maximumAge: 5_000,
        timeout: 20_000
      });
    } catch (error) {
      driverEnabled = false;
      gpsToggle.checked = false;
      nearbyRadius.disabled = true;
      if (error.status === 401) handleLostAuth();
      else setState("Не удалось включить Driver.", "error");
    } finally {
      gpsToggle.disabled = !hasProfile;
    }
  }

  function handleLostAuth() {
    driverEnabled = false;
    gpsToggle.checked = false;
    clearLocalPosition();
    currentUser = null;
    hasProfile = false;
    clearRefresh();
    onAuthLost();
  }

  gpsToggle.addEventListener("change", async () => {
    gpsToggle.disabled = true;
    try {
      if (gpsToggle.checked) await startGps({ persist: true });
      else await turnOff({ persist: true });
    } catch {
      gpsToggle.checked = driverEnabled;
      setState("Не удалось изменить состояние Driver.", "error");
    } finally {
      gpsToggle.disabled = !hasProfile;
    }
  });

  nearbyRadius.addEventListener("change", () => {
    const radius = Number(nearbyRadius.value);
    if (!ALLOWED_RADII.has(radius)) nearbyRadius.value = "25";
    map.setRadius(Number(nearbyRadius.value), { focus: true });
    refreshNearby();
  });

  return {
    setState,
    async setSession({ user, profileReady, gpsEnabled }) {
      currentUser = user;
      hasProfile = Boolean(profileReady);
      driverEnabled = hasProfile && Boolean(gpsEnabled);
      gpsToggle.checked = driverEnabled;
      setControlsEnabled(hasProfile);
      startNearbyRefresh();
      if (driverEnabled) await startGps({ persist: false });
      else if (hasProfile) setState("Driver выключен. Включите GPS, чтобы видеть других и быть видимым.");
    },
    setProfileReady(value) {
      hasProfile = Boolean(value);
      if (!hasProfile) driverEnabled = false;
      setControlsEnabled(hasProfile);
      if (hasProfile && !driverEnabled) {
        setState("Driver выключен. Включите GPS, чтобы видеть других и быть видимым.");
      }
    },
    async resetForLogin() {
      await turnOff({ persist: false, deleteServer: true }).catch(() => {});
      currentUser = null;
      hasProfile = false;
      clearRefresh();
    }
  };
}

export function createDriverModule(context) {
  const controller = createGpsController({
    api: context.api,
    map: context.getModule("map")?.controller,
    onAuthLost: context.onAuthLost
  });
  return {
    controller,
    setSession({ user, profile }) {
      return controller.setSession({ user, profileReady: Boolean(profile), gpsEnabled: profile?.gpsEnabled === true });
    },
    setProfileReady(profile) { controller.setProfileReady(Boolean(profile)); },
    reset() { return controller.resetForLogin(); }
  };
}
