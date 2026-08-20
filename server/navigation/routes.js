const {createValhallaProvider}=require("./providers/valhalla");
const {createNavigationService}=require("./service");

function createNavigationRoutes(options,{roadReports=null,provider=null}={}){
  const navigation=createNavigationService({db:options.db,provider:provider||createValhallaProvider(),roadReports,nowIso:options.nowIso});
  function respond(res,status,payload){options.json(res,status,payload);return true;}
  function requireUser(req,res){const session=options.requireSession(req,res);if(!session)return null;const profile=navigation.profiles.get(session.user.id);if(!profile){respond(res,409,{error:"driver_profile_required"});return null;}return session;}
  function requireMutation(req,res,key,limit=30,minutes=1){const session=requireUser(req,res);if(!session||!options.requireCsrf(req,res,session))return null;if(!options.checkRate(`navigation:${key}:user:${session.user.id}`,limit,minutes)){respond(res,429,{error:"navigation_rate_limited"});return null;}return session;}
  function serviceError(res,error){const status=Number(error?.status)||500;const payload={error:String(error?.message||"navigation_failed")};if(Array.isArray(error?.missing))payload.missing=error.missing;if(error?.providerStatus)payload.providerStatus=Number(error.providerStatus);if(error?.guard&&typeof error.guard==="object")payload.guard=error.guard;return respond(res,status,payload);}
  function result(res,value,success=200){if(value?.error)return respond(res,value.status||400,value);return respond(res,success,value);}

  return async function handleNavigationRoute(req,res,url,body){
    if(!url.pathname.startsWith("/api/driver/navigation"))return false;
    if(req.method==="GET"&&url.pathname==="/api/driver/navigation/status"){const session=requireUser(req,res);if(!session)return true;return respond(res,200,{status:navigation.status()});}
    if(req.method==="GET"&&url.pathname==="/api/driver/navigation/profile"){const session=requireUser(req,res);if(!session)return true;return respond(res,200,{profile:navigation.profiles.get(session.user.id)});}
    const routeMatch=url.pathname.match(/^\/api\/driver\/navigation\/routes\/([0-9a-f-]{16,80})$/i);
    if(req.method==="GET"&&routeMatch){const session=requireUser(req,res);if(!session)return true;const route=navigation.get(session.user.id,routeMatch[1]);return route?respond(res,200,{route}):respond(res,404,{error:"navigation_route_not_found"});}
    if(body===undefined)return false;

    if(req.method==="PATCH"&&url.pathname==="/api/driver/navigation/profile"){const session=requireMutation(req,res,"profile",20,1);if(!session)return true;const value=navigation.profiles.update(session.user.id,body,options.nowIso());if(!value.error)options.audit(req,"navigation_profile_updated",{userId:session.user.id,success:true,details:{vehicleClass:value.profile.vehicleClass}});return result(res,value);}
    if(req.method==="POST"&&url.pathname==="/api/driver/navigation/routes"){const session=requireMutation(req,res,"calculate",12,1);if(!session)return true;try{const route=await navigation.calculate(session.user.id,body);options.audit(req,"navigation_route_created",{userId:session.user.id,success:true,details:{routeId:route.id,provider:route.provider,strategy:route.strategy}});return respond(res,201,{route});}catch(error){options.audit(req,"navigation_route_create_failed",{userId:session.user.id,success:false,details:{error:String(error?.message||"navigation_failed")}});return serviceError(res,error);}}
    const selectMatch=url.pathname.match(/^\/api\/driver\/navigation\/routes\/([0-9a-f-]{16,80})\/select$/i);
    if(req.method==="POST"&&selectMatch){const session=requireMutation(req,res,"select",30,1);if(!session)return true;return result(res,navigation.select(session.user.id,selectMatch[1],String(body?.alternativeId||"")));}
    const refreshMatch=url.pathname.match(/^\/api\/driver\/navigation\/routes\/([0-9a-f-]{16,80})\/refresh$/i);
    if(req.method==="POST"&&refreshMatch){const session=requireMutation(req,res,"refresh",12,1);if(!session)return true;try{const value=await navigation.refresh(session.user.id,refreshMatch[1],body,options.nowIso());if(!value.error)options.audit(req,"navigation_route_refreshed",{userId:session.user.id,success:true,details:{routeId:refreshMatch[1]}});return result(res,value);}catch(error){return serviceError(res,error);}}
    const finishMatch=url.pathname.match(/^\/api\/driver\/navigation\/routes\/([0-9a-f-]{16,80})\/finish$/i);
    if(req.method==="POST"&&finishMatch){const session=requireMutation(req,res,"finish",30,1);if(!session)return true;const value=navigation.finish(session.user.id,finishMatch[1],String(body?.state||"COMPLETED").toUpperCase(),options.nowIso());if(!value.error)options.audit(req,"navigation_route_finished",{userId:session.user.id,success:true,details:{routeId:finishMatch[1],status:value.route.status}});return result(res,value);}
    return false;
  };
}

module.exports={createNavigationRoutes};
