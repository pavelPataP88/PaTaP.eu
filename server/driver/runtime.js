const { createLocationRepository } = require("./location");
const { createProfileRepository } = require("./profile");
const { createDriverDirectory } = require("./directory");
const { createPeopleRoutes } = require("../people/routes");
const { createParkingRoutes } = require("../parking/routes");
const { createEventRuntime } = require("../events/factory");
const { createEventRoutes } = require("../events/routes");
const { createAccountRoutes } = require("../account/routes");
const { createRoadReportRepository } = require("../road-reports/repository");

function createDriverRuntime({
  db,
  json,
  requireSession,
  requireCsrf,
  checkRate,
  audit,
  nowIso,
  addMinutes
}) {
  const profiles = createProfileRepository(db);
  const locations = createLocationRepository(db, { addMinutes });
  const directory = createDriverDirectory(db, { addMinutes, nowIso });
  const roadReports = createRoadReportRepository(db, { nowIso });
  const routeOptions = { db, json, requireSession, requireCsrf, checkRate, audit, nowIso, addMinutes };

  // Deterministic schema/bootstrap order. Parking and People initialize the
  // additive domain structures (including Chat/Radio dependencies) required
  // before Event Center projection triggers are created.
  const handleParkingRoute = createParkingRoutes(routeOptions);
  const handlePeopleRoute = createPeopleRoutes(routeOptions);
  const handleAccountRoute = createAccountRoutes(routeOptions);
  const eventRuntime = createEventRuntime({ db, nowIso });
  const handleEventRoute = createEventRoutes({
    ...routeOptions,
    events: eventRuntime.events,
    push: eventRuntime.push
  });

  let started = false;

  function start() {
    if (started) return false;
    eventRuntime.dispatcher.start();
    started = true;
    return true;
  }

  function stop() {
    if (!started) return false;
    eventRuntime.dispatcher.stop();
    started = false;
    return true;
  }

  function state() {
    return { started };
  }

  return {
    profiles,
    locations,
    directory,
    roadReports,
    handleParkingRoute,
    handlePeopleRoute,
    handleAccountRoute,
    handleEventRoute,
    eventRuntime,
    start,
    stop,
    state
  };
}

module.exports = { createDriverRuntime };
