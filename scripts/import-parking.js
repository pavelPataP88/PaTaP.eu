const fs=require("fs");
const { openDb }=require("../server/auth/db");
const { parsePayload,importParkingPayload }=require("../server/parking/importer");

function args(argv){const out={};for(let i=0;i<argv.length;i++){const part=argv[i];if(!part.startsWith("--"))continue;const [key,inline]=part.slice(2).split("=",2);if(inline!==undefined)out[key]=inline;else if(argv[i+1]&&!argv[i+1].startsWith("--"))out[key]=argv[++i];else out[key]=true;}return out;}
function usage(){console.log("Usage: node scripts/import-parking.js --format osm-json|datex-xml|normalized-json (--file PATH | --url URL) [--source-type OFFICIAL_DATEX|OSM|OPERATOR|OTHER] [--source-name NAME] [--country PL] [--dry-run]");}
async function load(input){if(input.file)return fs.readFileSync(input.file);if(input.url){const response=await fetch(input.url,{headers:{"User-Agent":"Driver-PaTaP-Parking-Importer/1.0"}});if(!response.ok)throw new Error(`parking_source_http_${response.status}`);return Buffer.from(await response.arrayBuffer());}throw new Error("parking_source_required");}

(async()=>{
  const input=args(process.argv.slice(2));if(input.help){usage();return;}
  const format=String(input.format||"");if(!format){usage();process.exitCode=2;return;}
  const bytes=await load(input);let payload;
  if(format.includes("json")){payload=JSON.parse(bytes.toString("utf8"));}else payload=bytes.toString("utf8");
  const source={type:input["source-type"]||undefined,name:input["source-name"]||undefined,url:input["source-url"]||input.url||"",countryCode:input.country||null};
  if(input["dry-run"]){const parsed=parsePayload(format,payload,source);console.log(JSON.stringify({dryRun:true,records:parsed.records.length,occupancy:(parsed.occupancy||[]).length,source},null,2));return;}
  const db=openDb();try{const result=importParkingPayload(db,{format,payload,source,batchSize:Number(input["batch-size"]||500)});console.log(JSON.stringify({ok:true,...result},null,2));}finally{db.close?.();}
})().catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
